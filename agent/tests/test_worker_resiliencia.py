"""Turno do WhatsApp que morre, estoura o prazo ou é cancelado volta à fila; borda e lembretes."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import conversation, db, worker
from app.config import get_settings
from app.jobs import reminders
from app.routes import inbound
from app.routes import worker as rota_worker


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _sessao():
    return {
        "id": "s", "channel": "whatsapp", "thread_id": "T", "session_epoch": 0,
        "user_id": "u", "workspace_id": "w",
    }


def _preparar(monkeypatch, lote, *, run_turn, recover=None):
    devolvidos: list[tuple] = []

    async def claim_batch(_t):
        return lote

    async def ensure_session(_p, _t):
        return _sessao()

    async def sem_limite(_s):
        return None

    async def mark_retry(ids, erro):
        devolvidos.append((ids, erro))
        return [{"id": i, "status": "pending", "retry_count": 1} for i in ids]

    async def mark_done(_ids):
        return None

    async def sem_envio(*_a, **_k):
        return None

    async def sem_historico(_s):
        return []

    async def extract(_lote):
        return {"text": "oi", "media": None, "raw_texts": ["oi"], "clicked_id": None}

    monkeypatch.setattr(worker.db, "claim_batch", claim_batch)
    monkeypatch.setattr(worker.db, "ensure_session", ensure_session)
    monkeypatch.setattr(worker.db, "mark_retry", mark_retry)
    monkeypatch.setattr(worker.db, "mark_done", mark_done)

    async def sem_falha(_t):
        return None

    async def nada_pendente(_t):
        return False

    monkeypatch.setattr(worker.db, "falhas_a_avisar", sem_falha)
    monkeypatch.setattr(worker.db, "tem_pendente", nada_pendente)
    monkeypatch.setattr(worker.whatsapp, "try_send", sem_envio)
    monkeypatch.setattr(worker.whatsapp, "try_mark_read", sem_envio)
    monkeypatch.setattr(worker, "_extract_batch", extract)
    monkeypatch.setattr(conversation, "check_limits", sem_limite)
    monkeypatch.setattr(conversation, "load_prompt_history", sem_historico)
    monkeypatch.setattr(conversation, "run_turn", run_turn)
    if recover is not None:
        monkeypatch.setattr(conversation, "recover_turn", recover)
    return devolvidos


async def test_falha_definitiva_do_claim_avisa_uma_vez(monkeypatch):
    """A mensagem presa que estoura o teto vira `failed` DENTRO do claim: o lote volta vazio e,
    mesmo assim, a pessoa é avisada — e uma vez só (a consulta marca como avisada)."""
    _preparar(monkeypatch, [], run_turn=None)
    enviados: list[tuple] = []
    falhas = ["5551"]

    async def falhas_a_avisar(_t):
        return falhas.pop() if falhas else None

    async def envia(phone, texto):
        enviados.append((phone, texto))

    monkeypatch.setattr(worker.db, "falhas_a_avisar", falhas_a_avisar)
    monkeypatch.setattr(worker.whatsapp, "try_send", envia)
    assert await worker.process_thread("t1") == {"claimed": 0}
    assert await worker.process_thread("t1") == {"claimed": 0}
    assert enviados == [("5551", worker.FALHOU)]


def _msg(retry=0):
    return {"id": 1, "wa_message_id": "wamid.1", "phone": "5551", "payload": {}, "retry_count": retry}


async def test_prazo_do_turno_devolve_o_lote_a_fila(monkeypatch):
    async def lento(*_a, **_k):
        await asyncio.sleep(5)

    monkeypatch.setenv("WORKER_TURN_TIMEOUT_SECONDS", "0")
    get_settings.cache_clear()
    devolvidos = _preparar(monkeypatch, [_msg()], run_turn=lento)

    with pytest.raises(TimeoutError):
        await worker.process_thread("T")
    assert devolvidos == [([1], "prazo do turno estourou")]


async def test_cancelamento_devolve_o_lote_mesmo_cancelado(monkeypatch):
    comecou = asyncio.Event()

    async def trava(*_a, **_k):
        comecou.set()
        await asyncio.sleep(30)

    devolvidos = _preparar(monkeypatch, [_msg()], run_turn=trava)

    tarefa = asyncio.create_task(worker.process_thread("T"))
    await comecou.wait()
    tarefa.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarefa
    await asyncio.sleep(0)  # a devolução roda desacoplada (shield)
    assert devolvidos == [([1], "turno cancelado")]


async def test_retentativa_recupera_o_checkpoint_em_vez_de_refazer_o_turno(monkeypatch):
    chamadas = []

    async def run_turn(*_a, **_k):
        chamadas.append("run_turn")
        return "novo"

    async def recover(_s, *, source_message_id):
        chamadas.append(("recover", source_message_id))
        return "✅ já estava feito"

    _preparar(monkeypatch, [_msg(retry=1)], run_turn=run_turn, recover=recover)
    assert (await worker.process_thread("T"))["status"] == "ok"
    assert chamadas == [("recover", "wamid.1")]


async def test_retentativa_sem_checkpoint_roda_o_turno(monkeypatch):
    chamadas = []

    async def run_turn(*_a, **_k):
        chamadas.append("run_turn")
        return "novo"

    async def recover(_s, *, source_message_id):
        return None

    _preparar(monkeypatch, [_msg(retry=2)], run_turn=run_turn, recover=recover)
    await worker.process_thread("T")
    assert chamadas == ["run_turn"]


async def test_primeira_tentativa_nao_consulta_o_checkpoint(monkeypatch):
    async def run_turn(*_a, **_k):
        return "ok"

    async def recover(*_a, **_k):
        raise AssertionError("recover_turn só vale em retentativa")

    _preparar(monkeypatch, [_msg(retry=0)], run_turn=run_turn, recover=recover)
    await worker.process_thread("T")


async def test_mensagem_que_chegou_durante_o_turno_ganha_o_proximo_lote_ja(monkeypatch):
    """Sem isto ela esperava o sweep (até 1 min): o claim dela saiu vazio com a conversa ocupada."""
    async def run_turn(*_a, **_k):
        return "ok"

    _preparar(monkeypatch, [_msg()], run_turn=run_turn)
    agendados: list[str] = []

    async def pendente(_t):
        return True

    async def agenda(t):
        agendados.append(t)

    monkeypatch.setattr(worker.db, "tem_pendente", pendente)
    monkeypatch.setattr(worker.tasks, "schedule_debounce", agenda)
    await worker.process_thread("T")
    assert agendados == ["T"]

    # nada pendente: nenhuma task; falha ao agendar: o turno não cai (o sweep pega)
    agendados.clear()

    async def nada(_t):
        return False

    monkeypatch.setattr(worker.db, "tem_pendente", nada)
    await worker.process_thread("T")
    assert agendados == []

    async def quebra(_t):
        raise RuntimeError("tasks fora")

    monkeypatch.setattr(worker.db, "tem_pendente", pendente)
    monkeypatch.setattr(worker.tasks, "schedule_debounce", quebra)
    assert (await worker.process_thread("T"))["claimed"] == 1


# --- A2: borda do webhook -----------------------------------------------------


def _cliente(monkeypatch, *, enqueue, ensure_session=None):
    monkeypatch.setattr(inbound, "verify_meta_signature", lambda *_: True)

    async def sessao(*_a):
        return {"debounce_task_name": None}

    async def cancela(_n):
        return None

    async def agenda(_t):
        return "task"

    async def set_task(*_a):
        return None

    monkeypatch.setattr(inbound.db, "enqueue", enqueue)
    monkeypatch.setattr(inbound.db, "ensure_session", ensure_session or sessao)
    monkeypatch.setattr(inbound.db, "set_debounce_task", set_task)
    monkeypatch.setattr(inbound.tasks, "cancel", cancela)
    monkeypatch.setattr(inbound.tasks, "schedule_debounce", agenda)
    app = FastAPI()
    app.include_router(inbound.router)
    return TestClient(app)


CORPO = {"entry": [{"changes": [{"value": {"messages": [
    {"from": "5551999999999", "id": "wamid.X", "type": "text", "text": {"body": "oi"}}
]}}]}]}


def test_enqueue_que_falha_devolve_5xx(monkeypatch):
    async def enqueue(**_k):
        raise RuntimeError("banco fora")

    r = _cliente(monkeypatch, enqueue=enqueue).post("/whatsapp-inbound", json=CORPO)
    assert r.status_code >= 500


def test_falha_depois_do_enqueue_continua_200(monkeypatch):
    async def enqueue(**_k):
        return True

    async def quebra(*_a):
        raise RuntimeError("sessão")

    r = _cliente(monkeypatch, enqueue=enqueue, ensure_session=quebra).post(
        "/whatsapp-inbound", json=CORPO
    )
    assert r.status_code == 200


def test_verify_token_nao_ascii_e_recusado_sem_erro(monkeypatch):
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", "segredo")
    get_settings.cache_clear()
    c = _cliente(monkeypatch, enqueue=None)
    params = {"hub.mode": "subscribe", "hub.challenge": "42"}
    assert c.get("/whatsapp-inbound", params={**params, "hub.verify_token": "sêgredo"}).status_code == 403
    assert c.get("/whatsapp-inbound", params={**params, "hub.verify_token": "segredo"}).text == "42"


# --- rota do worker -------------------------------------------------------------


def test_500_do_worker_nao_vaza_o_erro(monkeypatch):
    async def quebra(_t):
        raise RuntimeError("postgresql://user:senha@host")

    monkeypatch.setattr(rota_worker.worker, "process_thread", quebra)
    app = FastAPI()
    app.include_router(rota_worker.router)
    app.dependency_overrides[rota_worker.require_internal] = lambda: None
    r = TestClient(app).post("/worker/process-thread", json={"thread_id": "T"})
    assert r.status_code == 500
    assert "senha" not in r.text


# --- pools ----------------------------------------------------------------------


def test_pool_fechado_da_erro_previsto():
    db._pool = None
    db._graph_pool = None
    with pytest.raises(RuntimeError, match="graph_pool"):
        db.graph_pool()
    with pytest.raises(RuntimeError, match="pool não aberto"):
        db.pool()


# --- M8: lembretes ----------------------------------------------------------------


async def test_lembrete_com_trava_de_outra_rodada_nao_e_enviado(monkeypatch):
    at = datetime(2026, 9, 28, 12, tzinfo=timezone.utc)
    row = {
        "id": "r", "user_id": "u", "title": "x", "recurrence": None, "channel": "push",
        "next_run_at": at, "skip_run_at": None, "parent_reminder_id": None,
        "timezone": "UTC", "send_attempts": 0, "phone": None, "expo_push_token": "t",
        "alerts_whatsapp_enabled": False,
    }
    enviados = []

    async def fetch(_sql, *_a):
        return [row]

    async def entregar(_l):
        enviados.append(1)
        return ["push"]

    @asynccontextmanager
    async def ocupada(_chave):
        yield False

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "trava_de_sessao", ocupada)
    monkeypatch.setattr(reminders, "_entregar", entregar)
    monkeypatch.setattr(reminders, "now_utc", lambda: at)

    assert await reminders.run() == {"due": 1, "sent": 0, "given_up": 0}
    assert enviados == []


async def test_turno_sem_modelo_devolve_a_vaga_da_cota(monkeypatch):
    """Ilegível, arquivo grande, resposta do checkpoint e erro não chamam o modelo: a vaga que o
    `check_limits` reservou volta, senão a cota da hora fica presa por minutos."""
    soltas: list[int] = []

    async def soltar():
        soltas.append(1)

    async def nada(_lote):
        return None

    async def grande(_lote):
        return {"text": "", "media": None, "raw_texts": [], "clicked_id": None, "grande_demais": True}

    async def do_checkpoint(_s, **_k):
        return "já respondido"

    for extract, retry, recover in ((nada, 0, None), (grande, 0, None), (nada, 1, do_checkpoint)):
        _preparar(monkeypatch, [_msg(retry)], run_turn=None, recover=recover)
        monkeypatch.setattr(worker, "_extract_batch", extract)
        monkeypatch.setattr(conversation, "soltar_reserva", soltar)
        await worker.process_thread("t1")
    assert len(soltas) == 3
