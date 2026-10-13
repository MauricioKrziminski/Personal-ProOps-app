"""O painel num serviço próprio: asserção do IAP, fronteira entre `agente` e `admin`, HSTS e boot."""

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app import iap
from app import main as main_mod
from app.config import get_settings

AUD = "/projects/123456/locations/southamerica-east1/services/painel"
ADMIN = "00000000-0000-0000-0000-00000000ad01"
CHAVE = ec.generate_private_key(ec.SECP256R1())
OUTRA = ec.generate_private_key(ec.SECP256R1())


def _assercao(chave=CHAVE, aud=AUD, iss=iap.EMISSOR, email="gestao@exemplo.com", exp=None, alg="ES256"):
    agora = int(time.time())
    corpo = {"aud": aud, "iss": iss, "sub": "accounts.google.com:1", "email": email,
             "iat": agora, "exp": exp if exp is not None else agora + 600}
    return jwt.encode(corpo, chave if alg == "ES256" else "segredo", algorithm=alg, headers={"kid": "k1"})


@pytest.fixture(autouse=True)
def _ambiente(monkeypatch):
    monkeypatch.setattr(iap, "_jwks", lambda: SimpleNamespace(
        get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=CHAVE.public_key())))
    monkeypatch.setenv("ADMIN_USER_IDS", ADMIN)
    monkeypatch.setenv("ADMIN_IAP_AUDIENCE", AUD)
    monkeypatch.setenv("ADMIN_IAP_EMAILS", "Gestao@Exemplo.com")
    monkeypatch.delenv("K_SERVICE", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _servico(monkeypatch, nome):
    monkeypatch.setenv("SERVICO", nome)
    get_settings.cache_clear()
    return TestClient(main_mod.app)  # sem `with`: o lifespan (banco) não roda


async def test_assercao_valida_devolve_o_email():
    assert await iap.email_autorizado(_assercao(), AUD, {"gestao@exemplo.com"}) == "gestao@exemplo.com"


@pytest.mark.parametrize("assercao", [
    _assercao(aud="/projects/123456/locations/southamerica-east1/services/agente"),  # outro serviço
    _assercao(iss="https://accounts.google.com"),
    _assercao(exp=int(time.time()) - 3600),
    _assercao(chave=OUTRA),          # assinada por quem não é o Google
    _assercao(alg="HS256"),          # algoritmo trocado
    _assercao(email="intruso@exemplo.com"),
    _assercao(email="accounts.google.com:gestao@exemplo.com"),  # prefixo não é recortado
    "", "lixo",
])
async def test_assercao_invalida_nao_passa(assercao):
    assert await iap.email_autorizado(assercao, AUD, {"gestao@exemplo.com"}) is None


async def test_sem_audiencia_ou_sem_lista_fecha():
    assert await iap.email_autorizado(_assercao(), "", {"gestao@exemplo.com"}) is None
    assert await iap.email_autorizado(_assercao(), AUD, set()) is None


def test_agente_nao_tem_painel_e_manda_hsts(monkeypatch):
    c = _servico(monkeypatch, "agente")
    for caminho in ("/admin", "/admin/api/me", "/admin/api/overview"):
        r = c.get(caminho, headers={"x-goog-iap-jwt-assertion": _assercao(), "Authorization": "Bearer x"})
        assert r.status_code == 404, caminho
    assert c.get("/termos").headers["strict-transport-security"].startswith("max-age=63072000")


def test_painel_so_responde_pelo_painel(monkeypatch):
    c = _servico(monkeypatch, "admin")
    for metodo, caminho in (("post", "/whatsapp-inbound"), ("post", "/worker/process-thread"),
                            ("post", "/cron/reminders"), ("post", "/internal/finance/draft"),
                            ("get", "/termos"), ("post", "/hooks/billing"), ("get", "/openapi.json"),
                            ("get", "//admin"), ("get", "/Admin"), ("post", "/internal/captures/notifications")):
        r = getattr(c, metodo)(caminho, headers={"x-goog-iap-jwt-assertion": _assercao()})
        assert r.status_code == 404, caminho
        assert "strict-transport-security" in r.headers


def test_painel_exige_a_assercao_do_iap(monkeypatch):
    c = _servico(monkeypatch, "admin")
    assert c.get("/admin").status_code == 403
    assert c.get("/admin/api/me", headers={"Authorization": "Bearer x"}).status_code == 403
    assert c.get("/admin", headers={"x-goog-iap-jwt-assertion": _assercao(chave=OUTRA)}).status_code == 403
    # os erros que o próprio SPA captura também passam pelo IAP
    assert c.post("/internal/errors", json={"errors": []}).status_code == 403
    # com a asserção certa a requisição chega ao painel (o build do SPA pode faltar no teste: 200 ou 503)
    r = c.get("/admin", headers={"x-goog-iap-jwt-assertion": _assercao()})
    assert r.status_code in (200, 503)
    assert r.headers["strict-transport-security"]


def _painel_completo(monkeypatch):
    for nome, valor in (("K_SERVICE", "painel"), ("SERVICO", "admin"), ("SUPABASE_URL", "https://x.supabase.co"),
                        ("SUPABASE_ANON_KEY", "anon"), ("ADMIN_USER_IDS", ADMIN), ("ADMIN_IAP_AUDIENCE", AUD),
                        ("ADMIN_IAP_EMAILS", "gestao@exemplo.com"), ("ADMIN_EXIGE_IAP", "true"),
                        ("ADMIN_REQUIRE_MFA", "true")):
        monkeypatch.setenv(nome, valor)


@pytest.mark.parametrize("nome, valor", [
    ("ADMIN_EXIGE_IAP", "false"), ("ADMIN_IAP_AUDIENCE", "painel"), ("ADMIN_IAP_EMAILS", ""), ("ADMIN_USER_IDS", ""),
    ("ADMIN_REQUIRE_MFA", "false"),
])
def test_painel_no_cloud_run_recusa_subir_incompleto(monkeypatch, nome, valor):
    _painel_completo(monkeypatch)
    monkeypatch.setenv(nome, valor)
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match=nome):
        main_mod._checa_admin()


def test_painel_de_staging_pode_subir_sem_mfa(monkeypatch):
    _painel_completo(monkeypatch)
    monkeypatch.setenv("K_SERVICE", "painel-staging")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "false")
    get_settings.cache_clear()
    main_mod._checa_admin()


def test_painel_no_cloud_run_completo_sobe(monkeypatch):
    _painel_completo(monkeypatch)
    get_settings.cache_clear()
    main_mod._checa_admin()
