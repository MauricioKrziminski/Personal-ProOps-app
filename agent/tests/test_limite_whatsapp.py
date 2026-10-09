"""Limite de uso do WhatsApp: a unidade é a RESPOSTA ENVIADA (o que a Meta cobra)."""

from __future__ import annotations

import pytest

from app import conversation, db, worker
from app.config import get_settings
from app.jobs import alerts, reminders

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class Mundo:
    """Dublê do banco e da Meta: o que foi contado, enviado e marcado."""

    def __init__(self, monkeypatch, *, sessao, respostas=0, max_respostas=150, avisos=0, max_avisos=1):
        self.contados: list[str] = []
        self.enviados: list[str] = []
        self.avisos_do_dia: set[str] = set()
        self.ia_chamada = False
        self.vaga_solta = 0
        self.ja_respondido = False
        self.respostas, self.avisos = respostas, avisos
        mundo = self

        async def claim_batch(_t):
            return [{"id": 1, "wa_message_id": "w1", "phone": "5551", "payload": {}, "retry_count": 0}]

        async def ensure_session(_p, _t):
            return sessao

        async def nada(*_a, **_k):
            return None

        async def falhas(_t):
            return None

        async def pendente(_t):
            return False

        async def registrar(_ws, _u, kind):
            mundo.contados.append(kind)

        async def cota(_ws):
            return {"whatsapp_replies_month": mundo.respostas, "max_whatsapp_replies_month": max_respostas,
                    "whatsapp_notices_today": mundo.avisos, "max_whatsapp_notices_day": max_avisos}

        async def aviso(_u, _w, _tz, kind="limite_do_plano"):
            if kind in mundo.avisos_do_dia:
                return False
            mundo.avisos_do_dia.add(kind)
            return True

        async def ja_respondido(_p, _ids):
            return mundo.ja_respondido

        async def send(_to, body):
            mundo.enviados.append(body)
            return True

        async def sem_limite(_s):
            return None

        async def solta():
            mundo.vaga_solta += 1

        async def extrai(_l):
            return {"text": "oi", "media": None, "raw_texts": ["oi"], "clicked_id": None}

        async def roda(*_a, **_k):
            mundo.ia_chamada = True
            return "✅ Registrado"

        for nome, fn in [("claim_batch", claim_batch), ("ensure_session", ensure_session),
                         ("mark_done", nada), ("falhas_a_avisar", falhas), ("tem_pendente", pendente),
                         ("registrar_envio", registrar), ("cota_whatsapp", cota),
                         ("reservar_aviso_de_limite", aviso), ("telefone_ja_respondido", ja_respondido)]:
            monkeypatch.setattr(db, nome, fn)
        monkeypatch.setattr(worker.whatsapp, "try_send", send)
        monkeypatch.setattr(worker.whatsapp, "try_mark_read", nada)
        monkeypatch.setattr(worker, "_extract_batch", extrai)
        monkeypatch.setattr(worker, "_run_graph", roda)
        monkeypatch.setattr(conversation, "check_limits", sem_limite)
        monkeypatch.setattr(conversation, "soltar_reserva", solta)


SESSAO = {"id": "s", "channel": "whatsapp", "thread_id": "T", "session_epoch": 0,
          "user_id": "u", "workspace_id": "w", "timezone": "America/Sao_Paulo"}


async def test_resposta_enviada_conta(monkeypatch):
    m = Mundo(monkeypatch, sessao=SESSAO)
    assert (await worker.process_thread("T"))["status"] == "ok"
    assert m.enviados == ["✅ Registrado"] and m.contados == ["reply"]


async def test_mes_estourado_avisa_uma_vez_e_depois_silencio(monkeypatch):
    m = Mundo(monkeypatch, sessao=SESSAO, respostas=150)
    r1 = await worker.process_thread("T")
    r2 = await worker.process_thread("T")
    assert r1["status"] == r2["status"] == "limite_whatsapp"
    assert m.enviados == [worker.LIMITE_WHATSAPP]  # 1x por dia; a 2ª fica calada
    assert m.contados == ["reply"]                  # o próprio aviso conta
    assert not m.ia_chamada and m.vaga_solta == 2   # sem IA, e a vaga reservada volta


async def test_chat_do_app_nao_passa_pela_cota_do_whatsapp():
    """A cota vive só no worker: `app_chat` nunca chama `cota_whatsapp` nem o ponto de envio."""
    import inspect

    from app import app_chat

    fonte = inspect.getsource(app_chat)
    assert "cota_whatsapp" not in fonte and "registrar_envio" not in fonte


async def test_numero_sem_conta_responde_uma_vez_por_telefone(monkeypatch):
    m = Mundo(monkeypatch, sessao={**SESSAO, "user_id": None, "workspace_id": None})
    await worker.process_thread("T")
    m.ja_respondido = True  # a fila já tem mensagem deste telefone nas últimas 24 h
    await worker.process_thread("T")
    assert m.enviados == [worker.SEM_CONTA] and m.contados == []  # sem workspace, nada a contar


async def test_teto_diario_de_template_pula_whatsapp_e_mantem_push(monkeypatch):
    m = Mundo(monkeypatch, sessao=SESSAO, avisos=1, max_avisos=1)
    push, wa = [], []

    async def push_fake(token, titulo, corpo, canal):
        push.append(corpo)

    async def wa_fake(tel, template, params):
        wa.append(params[0])

    monkeypatch.setattr(reminders.push, "send", push_fake)
    monkeypatch.setattr(reminders.whatsapp, "send_template", wa_fake)
    lembrete = {"id": 1, "workspace_id": "w", "user_id": "u", "title": "aluguel", "channel": "both",
                "phone": "5551", "expo_push_token": "tok", "alerts_whatsapp_enabled": True}
    assert await reminders._entregar(lembrete) == ["push"]
    assert wa == [] and push == ["aluguel"] and m.contados == []

    m.avisos = 0  # abaixo do teto: vai, e conta como aviso
    assert await reminders._entregar(lembrete) == ["push", "whatsapp"]
    assert wa == ["aluguel"] and m.contados == ["notice"]


async def test_alerta_acima_do_teto_pula_whatsapp(monkeypatch):
    m = Mundo(monkeypatch, sessao=SESSAO, avisos=1, max_avisos=1)
    enviados = []

    async def candidatos(_sql):
        return [{"workspace_id": "w", "user_id": "u", "phone": "5551", "expo_push_token": None,
                 "alerts_push_enabled": False, "alerts_whatsapp_enabled": True,
                 "kind": "k", "ref": "r", "title": "T", "body": "B"}]

    async def wa_fake(*a):
        enviados.append(a)

    monkeypatch.setattr(db, "fetch", candidatos)
    monkeypatch.setattr(alerts.whatsapp, "send_template", wa_fake)
    r = await alerts.run()
    assert r["enviados"] == 0 and enviados == [] and m.contados == []
