"""Upload de áudio do app: apenas texto revisável, sem turno de conversa."""

from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import app_chat
from app.config import get_settings
from app.routes import chat as chat_routes
from app.services import groq

USER = UUID("11111111-1111-1111-1111-111111111111")
M4A = b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 32


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _cliente(authenticated=True):
    app = FastAPI()
    app.include_router(chat_routes.router)
    chat_routes.install_error_handlers(app)
    if authenticated:
        app.dependency_overrides[chat_routes.current_user] = lambda: USER
    return TestClient(app)


def _upload(cliente, data=M4A, filename="gravacao.m4a", mime="audio/mp4"):
    return cliente.post(
        "/internal/chat/transcriptions",
        files={"file": (filename, data, mime)},
    )


def test_transcricao_devolve_apenas_texto_para_revisao_sem_criar_turno(monkeypatch):
    async def falha_se_criar(**kwargs):
        raise AssertionError("transcrição não pode criar turno")

    async def transcribe(audio, filename="audio.ogg"):
        assert audio == M4A
        assert filename == "audio.m4a"
        return "  Gastei 45 no mercado  "

    monkeypatch.setattr(app_chat, "create_conversation", falha_se_criar)
    monkeypatch.setattr(app_chat, "send_message", falha_se_criar)
    monkeypatch.setattr(groq, "transcribe", transcribe)
    response = _upload(_cliente())
    assert response.status_code == 200
    assert response.json() == {"text": "Gastei 45 no mercado"}


def test_m4a_do_android_com_mime_inferido_como_mpeg(monkeypatch):
    async def transcribe(audio, filename="audio.ogg"):
        assert audio == M4A
        return "corrigir o vencimento"

    monkeypatch.setattr(groq, "transcribe", transcribe)
    response = _upload(_cliente(), mime="audio/mpeg")
    assert response.status_code == 200
    assert response.json() == {"text": "corrigir o vencimento"}


def test_transcricao_exige_token(monkeypatch):
    async def falha_se_transcrever(*args, **kwargs):
        raise AssertionError("sem token não envia ao provedor")

    monkeypatch.setattr(groq, "transcribe", falha_se_transcrever)
    response = _upload(_cliente(authenticated=False))
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.parametrize("kind,filename,mime,status", [
    ("empty", "audio.m4a", "audio/mp4", 422),
    ("garbage", "audio.m4a", "audio/mp4", 422),
    ("valid", "audio.txt", "text/plain", 415),
    ("valid", "audio.m4a", "text/plain", 415),
    ("valid", "audio.m4a", "audio/ogg", 415),
    ("oversized", "audio.m4a", "audio/mp4", 413),
])
def test_upload_invalido_e_rejeitado_antes_do_provedor(
    monkeypatch, kind, filename, mime, status
):
    async def falha_se_transcrever(*args, **kwargs):
        raise AssertionError("upload inválido não envia ao provedor")

    monkeypatch.setattr(groq, "transcribe", falha_se_transcrever)
    data = {"empty": b"", "garbage": b"lixo de texto", "valid": M4A}.get(kind)
    if kind == "oversized":
        data = M4A + b"\x00" * 20_000_000
    response = _upload(_cliente(), data, filename, mime)
    assert response.status_code == status
    assert set(response.json()) == {"code", "message"}


@pytest.mark.parametrize("provider_result", ["", "  \n  ", ".", "...", "。"])
def test_transcricao_sem_fala_util_e_rejeitada(monkeypatch, provider_result):
    async def transcribe(*args, **kwargs):
        return provider_result

    monkeypatch.setattr(groq, "transcribe", transcribe)
    response = _upload(_cliente())
    assert response.status_code == 422
    assert response.json()["code"] == "empty_transcription"


def test_transcricao_maior_que_mensagem_permitida_pede_audio_menor(monkeypatch):
    async def transcribe(*args, **kwargs):
        return "a" * 4_001

    monkeypatch.setattr(groq, "transcribe", transcribe)
    response = _upload(_cliente())
    assert response.status_code == 422
    assert response.json()["code"] == "transcription_too_long"


def test_falha_do_provedor_nao_expoe_corpo_ou_chave(monkeypatch):
    async def transcribe(*args, **kwargs):
        raise RuntimeError("Groq falhou (401): provider-secret-body")

    monkeypatch.setattr(groq, "transcribe", transcribe)
    response = _upload(_cliente())
    assert response.status_code == 502
    assert response.json()["code"] == "transcription_failed"
    assert "provider-secret-body" not in response.text
