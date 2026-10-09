"""Endurecimento de segurança e I/O externo: comparação em bytes, OIDC em thread com cache de
certificados, erros da Meta sem corpo, teto/retentativa de mídia, Groq com cliente reaproveitado,
boot que exige segredos e correlação de logs. Tudo com dublês — nada fala com a rede."""

import asyncio
import json
import logging

import httpx
import pytest
from fastapi import HTTPException

from app import logctx, security
from app.config import get_settings
from app.main import _JsonFormatter, _checa_producao
from app.services import groq, whatsapp


# ---------------------------------------------------------------- comparações em bytes
def test_comparacao_nao_ascii_recusa_sem_excecao(monkeypatch):
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "segredo")
    get_settings.cache_clear()
    assert security.verify_meta_signature(b"{}", "sha256=çççç") is False
    assert security.verify_shared_secret("açúcar", "segredo-interno") is False
    assert security.verify_shared_secret("segredo-interno", "segredo-interno") is True
    get_settings.cache_clear()


# ---------------------------------------------------------------- OIDC
def test_oidc_cache_de_certificados_e_checagens(monkeypatch):
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token

    chamadas = []

    class _Real:
        def __call__(self, url, method="GET", *a, **k):
            chamadas.append(url)
            return type("R", (), {"status": 200, "data": b"{}", "headers": {}})()

    monkeypatch.setattr(ga_requests, "Request", _Real)
    security._certs_cache.clear()
    visto = []

    def fake_verify(token, request, audience):
        visto.append(request("https://certs"))  # a lib pede os certificados a cada verificação
        return {"email": "sa@p.iam.gserviceaccount.com", "email_verified": True}

    monkeypatch.setattr(id_token, "verify_oauth2_token", fake_verify)
    sa = "sa@p.iam.gserviceaccount.com"
    assert security._verify_oidc("t", "aud", sa)
    assert security._verify_oidc("t", "aud", sa)
    assert len(chamadas) == 1  # a segunda saiu do cache
    assert not security._verify_oidc("t", "aud", "outra@p.iam.gserviceaccount.com")

    monkeypatch.setattr(
        id_token, "verify_oauth2_token", lambda *a, **k: {"email": sa, "email_verified": False}
    )
    assert not security._verify_oidc("t", "aud", sa)


async def test_require_internal_verifica_em_thread(monkeypatch):
    monkeypatch.setenv("OIDC_AUDIENCE", "https://x.run.app")
    monkeypatch.setenv("TASKS_SA_EMAIL", "sa@p.iam.gserviceaccount.com")
    get_settings.cache_clear()
    em_thread = []

    def fake(token, aud, email):
        import threading

        em_thread.append(threading.current_thread() is not threading.main_thread())
        return True

    monkeypatch.setattr(security, "_verify_oidc", fake)

    class _Req:
        headers = {"authorization": "Bearer abc"}

    await security.require_internal(_Req())
    assert em_thread == [True]

    class _Sem:
        headers = {"authorization": "Bearer abc", "x-internal-secret": "ç"}

    monkeypatch.setattr(security, "_verify_oidc", lambda *a: False)
    with pytest.raises(HTTPException) as e:
        await security.require_internal(_Sem())
    assert e.value.status_code == 401
    get_settings.cache_clear()


# ---------------------------------------------------------------- Meta: erro sem corpo
def test_erro_da_meta_sem_corpo():
    res = httpx.Response(
        400,
        json={"error": {"code": 131030, "error_subcode": 7, "message": "tel +5535998744200"}},
    )
    texto = whatsapp._erro_meta(res)
    assert "131030" in texto and "400" in texto and "5535" not in texto
    assert "400" in whatsapp._erro_meta(httpx.Response(400, text="não é json +5535"))


async def test_log_interativo_nao_vaza_spec(monkeypatch, caplog):
    async def falha(*a, **k):
        raise RuntimeError("boom")

    async def ok(*a, **k):
        return True

    monkeypatch.setattr(whatsapp, "send_buttons", falha)
    monkeypatch.setattr(whatsapp, "try_send", ok)
    with caplog.at_level(logging.ERROR):
        await whatsapp.try_send_interactive(
            "5535", {"body": "SEGREDO R$ 99", "buttons": [("a", "x")]}
        )
    assert "SEGREDO" not in caplog.text


# ---------------------------------------------------------------- mídia: teto e retentativa
def _cliente(monkeypatch, handler):
    c = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(whatsapp, "_client", c)
    monkeypatch.setattr(whatsapp, "_BACKOFF", 0)
    monkeypatch.setenv("WHATSAPP_TOKEN", "t")
    get_settings.cache_clear()


async def test_download_media_ok_com_retentativa(monkeypatch):
    estado = {"meta": 0}

    def handler(req):
        if req.url.path.endswith("/m1"):
            estado["meta"] += 1
            if estado["meta"] == 1:
                return httpx.Response(503)
            return httpx.Response(200, json={"url": "https://cdn/x", "mime_type": "audio/ogg"})
        return httpx.Response(200, content=b"abc")

    _cliente(monkeypatch, handler)
    assert await whatsapp.download_media("m1") == (b"abc", "audio/ogg")
    assert estado["meta"] == 2


async def test_download_media_acima_do_teto(monkeypatch):
    def handler(req):
        if req.url.path.endswith("/m1"):
            return httpx.Response(200, json={"url": "https://cdn/x"})
        return httpx.Response(200, content=b"x" * 50)

    _cliente(monkeypatch, handler)
    with pytest.raises(whatsapp.MidiaGrandeDemais):
        await whatsapp.download_media("m1", max_bytes=10)


async def test_download_media_erro_4xx_nao_retenta(monkeypatch):
    n = []

    def handler(req):
        n.append(1)
        return httpx.Response(404)

    _cliente(monkeypatch, handler)
    with pytest.raises(RuntimeError):
        await whatsapp.download_media("m1")
    assert len(n) == 1


def test_lida_mostra_digitando_e_desliga_por_env(monkeypatch):
    corpos = []

    def handler(req):
        corpos.append(json.loads(req.content))
        return httpx.Response(200, json={})

    _cliente(monkeypatch, handler)
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "1")
    get_settings.cache_clear()
    monkeypatch.delenv("WHATSAPP_TYPING_INDICATOR", raising=False)
    asyncio.run(whatsapp.mark_as_read("wamid"))
    assert corpos[0]["typing_indicator"] == {"type": "text"}
    assert corpos[0]["status"] == "read"
    monkeypatch.setenv("WHATSAPP_TYPING_INDICATOR", "false")
    _cliente(monkeypatch, handler)
    asyncio.run(whatsapp.mark_as_read("wamid"))
    assert "typing_indicator" not in corpos[1]


# ---------------------------------------------------------------- Groq
async def test_groq_retenta_e_reaproveita_cliente(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    get_settings.cache_clear()
    respostas = [httpx.Response(429), httpx.Response(200, json={"text": "oi"})]
    c = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: respostas.pop(0)))
    monkeypatch.setattr(groq, "_client", c)
    monkeypatch.setattr(groq, "_BACKOFF", 0)
    assert await groq.transcribe(b"a") == "oi"
    assert groq.client() is c
    await groq.close_client()
    assert groq._client is None


async def test_groq_erro_nao_vaza_corpo(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    get_settings.cache_clear()
    c = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(400, text="SEGREDO")))
    monkeypatch.setattr(groq, "_client", c)
    with pytest.raises(RuntimeError) as e:
        await groq.transcribe(b"a")
    assert "SEGREDO" not in str(e.value)
    await groq.close_client()


# ---------------------------------------------------------------- boot e logs
@pytest.mark.parametrize("campo", ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET"])
def test_cloud_run_sem_segredo_recusa_mesmo_com_backend_inline(monkeypatch, campo):
    from tests.test_boot import PROD

    for k, v in {**PROD, "DEBOUNCE_BACKEND": "inline", campo: ""}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("K_SERVICE", "agente")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match=campo):
        _checa_producao()
    get_settings.cache_clear()


def test_log_json_com_correlacao():
    rec = logging.LogRecord("x", logging.WARNING, "f", 1, "olá %s", ("mundo",), None)
    with logctx.bind(thread_id="t1", message_id="m1"):
        linha = _JsonFormatter().format(rec)
    dados = json.loads(linha)
    assert dados["severity"] == "WARNING" and dados["message"] == "olá mundo"
    assert dados["thread_id"] == "t1" and dados["message_id"] == "m1"
    assert "thread_id" not in json.loads(_JsonFormatter().format(rec))  # restaurou ao sair
    with pytest.raises(ValueError):
        with logctx.bind(typo="x"):
            pass
