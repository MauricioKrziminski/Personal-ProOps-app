"""Consentimento de IA (`AI_CONSENT_REQUIRED`): um ponto só, `conversation.check_limits`.

Flag desligada = nada muda (nem toca no banco). Ligada e sem `profiles.ai_consent_at`: nenhuma entrada de IA
chega ao modelo — app: 403 `ai_consent_required`; WhatsApp: um aviso por dia; importação: segue sem a IA.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import conversation, db, worker
from app.config import Settings, get_settings
from app.jobs import importer
from app.routes import chat as chat_routes
from app.routes import finance_draft
from app.services import groq
from tests.test_limite_whatsapp import SESSAO, Mundo

USER = UUID("11111111-1111-1111-1111-111111111111")
WS = UUID("22222222-2222-2222-2222-222222222222")
# o `check_limits` REAL, guardado antes de qualquer fixture o trocar por dublê
_CHECK_REAL = conversation.check_limits


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    monkeypatch.delenv("AI_CONSENT_REQUIRED", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _flag(monkeypatch, valor: bool):
    monkeypatch.setenv("AI_CONSENT_REQUIRED", "true" if valor else "false")
    get_settings.cache_clear()


class Banco:
    """Dublê do que `check_limits` toca: o consentimento e a reserva de cota."""

    def __init__(self, monkeypatch, *, consentiu: bool):
        self.consultas = 0
        self.reservas: list[str] = []
        banco = self

        async def ia_consentida(_u):
            banco.consultas += 1
            return consentiu

        async def reservar(*, user_id, workspace_id, channel, max_por_hora, kind, max_capturas_por_dia=0):
            banco.reservas.append(kind)
            return {"barrado": None, "plano": {}, "reserva_id": "r1"}

        monkeypatch.setattr(db, "ia_consentida", ia_consentida)
        monkeypatch.setattr(db, "reservar_cota", reservar)


SESSAO_APP = {"user_id": USER, "workspace_id": WS, "channel": "app"}


# ── o ponto único ─────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_flag_desligada_e_o_default_e_nada_muda(monkeypatch):
    assert Settings().ai_consent_required is False
    b = Banco(monkeypatch, consentiu=False)
    assert await _CHECK_REAL(SESSAO_APP) is None
    assert b.consultas == 0 and b.reservas == ["turn"]  # nem consultou o perfil


@pytest.mark.asyncio
async def test_flag_vazia_no_env_e_desligada(monkeypatch):
    monkeypatch.setenv("AI_CONSENT_REQUIRED", "   # nada")
    get_settings.cache_clear()
    assert get_settings().ai_consent_required is False


@pytest.mark.asyncio
async def test_ligada_e_sem_consentimento_recusa_antes_de_reservar_cota(monkeypatch):
    _flag(monkeypatch, True)
    b = Banco(monkeypatch, consentiu=False)
    assert await _CHECK_REAL(SESSAO_APP) == conversation.SEM_CONSENTIMENTO_IA
    assert b.reservas == [], "recusar não pode gastar vaga"
    assert conversation.SEM_CONSENTIMENTO_IA == (
        "Para usar o assistente, autorize o uso de IA no app: Perfil → Privacidade e dados.")


@pytest.mark.asyncio
async def test_ligada_e_com_consentimento_segue(monkeypatch):
    _flag(monkeypatch, True)
    b = Banco(monkeypatch, consentiu=True)
    assert await _CHECK_REAL(SESSAO_APP) is None
    assert b.reservas == ["turn"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["turn", "transcription"])
async def test_voz_e_transcricao_tambem_exigem(monkeypatch, kind):
    _flag(monkeypatch, True)
    Banco(monkeypatch, consentiu=False)
    assert await _CHECK_REAL(SESSAO_APP, kind=kind) == conversation.SEM_CONSENTIMENTO_IA


@pytest.mark.asyncio
async def test_importacao_nao_e_barrada_no_check_limits(monkeypatch):
    _flag(monkeypatch, True)
    b = Banco(monkeypatch, consentiu=False)
    assert await _CHECK_REAL(SESSAO_APP, kind="import") is None
    assert b.reservas == ["import"] and b.consultas == 0


# ── rotas do app: 403 {"error": "ai_consent_required"} ─────────────────────────────────────────────────
def _cliente(*routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    chat_routes.install_error_handlers(app)
    app.dependency_overrides[chat_routes.current_user] = lambda: USER
    app.dependency_overrides[finance_draft.current_user] = lambda: USER
    return TestClient(app)


@pytest.fixture
def com_perfil(monkeypatch):
    async def perfil(user_id):
        return {"id": user_id, "workspace_id": WS, "timezone": "America/Sao_Paulo"}

    monkeypatch.setattr(db, "chat_profile", perfil)
    # o que ESCREVE ou chama modelo explode: o 403 vem antes de tudo
    async def proibido(*_a, **_k):
        raise AssertionError("não pode chegar ao modelo nem ao banco")

    monkeypatch.setattr(finance_draft.nodes, "finance_node", proibido)
    monkeypatch.setattr(groq, "transcribe", proibido)
    monkeypatch.setattr(db, "record_ai_event", proibido)


def test_voz_do_financeiro_responde_403(monkeypatch, com_perfil):
    _flag(monkeypatch, True)
    Banco(monkeypatch, consentiu=False)
    r = _cliente(finance_draft.router).post(
        "/internal/finance/draft", json={"text": "gastei 45 no mercado", "today": "2026-10-05", "timezone": "America/Sao_Paulo"})
    assert r.status_code == 403 and r.json()["error"] == "ai_consent_required"


def test_transcricao_de_audio_responde_403_sem_chamar_o_groq(monkeypatch, com_perfil):
    _flag(monkeypatch, True)
    Banco(monkeypatch, consentiu=False)
    m4a = b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 32
    r = _cliente(chat_routes.router).post(
        "/internal/chat/transcriptions", files={"file": ("g.m4a", m4a, "audio/mp4")})
    assert r.status_code == 403 and r.json()["error"] == "ai_consent_required"


def test_flag_desligada_a_voz_nao_e_barrada(monkeypatch, com_perfil):
    Banco(monkeypatch, consentiu=False)
    r = _cliente(finance_draft.router).post(
        "/internal/finance/draft", json={"text": "gastei 45", "today": "2026-10-05", "timezone": "America/Sao_Paulo"})
    assert r.status_code != 403  # chegou ao motor (o dublê `proibido` derruba depois: 502)


# ── WhatsApp: um aviso por dia, sem modelo, sem ai_events ────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_whatsapp_avisa_uma_vez_por_dia_e_nao_chama_modelo(monkeypatch):
    m = Mundo(monkeypatch, sessao=SESSAO)
    _flag(monkeypatch, True)
    Banco(monkeypatch, consentiu=False)
    monkeypatch.setattr(conversation, "check_limits", _CHECK_REAL)  # o real, não o dublê do Mundo
    async def sem_evento(*_a, **_k):
        raise AssertionError("não grava ai_events")

    monkeypatch.setattr(db, "record_ai_event", sem_evento)
    r1 = await worker.process_thread("T")
    r2 = await worker.process_thread("T")
    assert r1["status"] == r2["status"] == "sem_consentimento_ia"
    assert m.enviados == [conversation.SEM_CONSENTIMENTO_IA]  # a 2ª fica calada
    assert m.avisos_do_dia == {"sem_consentimento_ia"}
    assert not m.ia_chamada


@pytest.mark.asyncio
async def test_whatsapp_com_consentimento_responde_normal(monkeypatch):
    m = Mundo(monkeypatch, sessao=SESSAO)
    _flag(monkeypatch, True)
    Banco(monkeypatch, consentiu=True)
    monkeypatch.setattr(conversation, "check_limits", _CHECK_REAL)
    assert (await worker.process_thread("T"))["status"] == "ok"
    assert m.ia_chamada and m.enviados == ["✅ Registrado"]


# ── importação: segue, sem a camada de IA ────────────────────────────────────────────────────────────────
CSV = "Data;Descrição;Valor\n15/08/2026;Mercado;-45,90\n20/08/2026;Salário;1.500,00\n"


class Importacao:
    def __init__(self, monkeypatch):
        self.classificou = self.julgou = self.auditou = 0
        self.vaga_solta = 0
        imp = self

        async def fetch_one(sql, *a):
            if "_plan_status" in sql:
                return {"can_import": True}
            if "from public.accounts" in sql:
                return {"id": a[0], "type": "checking"}
            if "insert into public.import_batches" in sql:
                return {"id": uuid4()}
            if "display_name" in sql:
                return {"display_name": "Fulano"}
            return None

        async def fetch(sql, *a):
            return []

        async def execute(sql, *a):
            return 1

        async def classifica(linhas, cartao=False):
            imp.classificou += 1
            return [("mercado", "gasto")] * len(linhas)

        async def julga(pares):
            imp.julgou += 1
            return []

        async def evento(**_k):
            imp.auditou += 1

        async def solta():
            imp.vaga_solta += 1

        monkeypatch.setattr(db, "fetch_one", fetch_one)
        monkeypatch.setattr(db, "fetch", fetch)
        monkeypatch.setattr(db, "execute", execute)
        monkeypatch.setattr(db, "record_ai_event", evento)
        monkeypatch.setattr(importer, "classify_statement_lines", classifica)
        monkeypatch.setattr(importer, "judge_statement_pairs", julga)
        monkeypatch.setattr(conversation, "soltar_reserva", solta)


async def _importa():
    return await importer.run(user_id=USER, workspace_id=WS, content=CSV, source="csv", account_id=uuid4())


@pytest.mark.asyncio
async def test_importacao_sem_consentimento_segue_sem_ia(monkeypatch):
    _flag(monkeypatch, True)
    Banco(monkeypatch, consentiu=False)
    imp = Importacao(monkeypatch)
    monkeypatch.setattr(conversation, "check_limits", _CHECK_REAL)
    r = await _importa()
    assert r["items"] == 2 and r["categorized"] == 0
    assert (imp.classificou, imp.julgou, imp.auditou) == (0, 0, 0)
    assert imp.vaga_solta == 1, "nenhum modelo foi chamado: a vaga volta"


@pytest.mark.asyncio
async def test_importacao_com_consentimento_usa_a_ia(monkeypatch):
    _flag(monkeypatch, True)
    Banco(monkeypatch, consentiu=True)
    imp = Importacao(monkeypatch)
    monkeypatch.setattr(conversation, "check_limits", _CHECK_REAL)
    r = await _importa()
    assert r["categorized"] == 2 and imp.classificou == 1 and imp.auditou == 1


def test_rota_de_mensagem_do_chat_responde_403_do_contrato(monkeypatch):
    """O chat é o consumidor principal: a exceção passa pelas rotas (que só pegam `ChatError`) até o handler."""
    from app import app_chat

    async def sem_consentimento(**_k):
        raise conversation.ConsentimentoNecessario()

    monkeypatch.setattr(app_chat, "send_message", sem_consentimento)
    r = _cliente(chat_routes.router).post(
        f"/internal/chat/conversations/{uuid4()}/messages",
        json={"client_message_id": str(uuid4()), "content": "gastei 45"})
    assert r.status_code == 403 and r.json()["error"] == "ai_consent_required"
