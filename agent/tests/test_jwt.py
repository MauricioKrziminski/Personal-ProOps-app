"""Verificação do JWT do app — comportamento, não texto do arquivo.

O projeto assina com **ES256** (chave assimétrica publicada em jwks.json), não
com o segredo simétrico legado. Verificar com HS256 rejeitaria todo token — e o
sintoma seria um 401 que parece problema de permissão, não de algoritmo.
Descoberto em 31/08/2026, checando o endpoint jwks.json do projeto.

⚠️ Este arquivo checava o CÓDIGO-FONTE (`'algorithms=["ES256"]' in fonte`). Isso
prova que a string existe, não que um token HS256 seja recusado — e passaria
igual se alguém acrescentasse um segundo `jwt.decode` sem trava logo abaixo.
Agora os tokens são assinados de verdade, com uma chave EC de teste, e o que se
mede é quem entra.
"""

from __future__ import annotations

import datetime as dt

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth
from app.config import get_settings

ISSUER = "https://exemplo.supabase.co/auth/v1"
SUB = "11111111-1111-1111-1111-111111111111"

CHAVE = ec.generate_private_key(ec.SECP256R1())
OUTRA_CHAVE = ec.generate_private_key(ec.SECP256R1())
SEGREDO_HS = "segredo-simetrico-legado-com-32-bytes-ou-mais"


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _jwks(monkeypatch):
    """O JWKS do Supabase, servido pela chave de teste — sem rede.

    Substitui a função inteira, não só o cache: `PyJWKClient` buscaria a chave
    por HTTP e o teste passaria a depender da internet.
    """
    from types import SimpleNamespace

    monkeypatch.setattr(
        auth,
        "_jwks",
        lambda: SimpleNamespace(
            get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=CHAVE.public_key())
        ),
    )


def _token(chave=CHAVE, alg="ES256", **overrides) -> str:
    agora = dt.datetime.now(dt.timezone.utc)
    corpo = {
        "sub": SUB,
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": int(agora.timestamp()),
        "exp": int((agora + dt.timedelta(hours=1)).timestamp()),
    }
    for k, v in overrides.items():
        if v is None:
            corpo.pop(k, None)
        else:
            corpo[k] = v
    return jwt.encode(corpo, chave, algorithm=alg)


# ---------------------------------------------------------------------------
# quem entra
# ---------------------------------------------------------------------------


def test_token_correto_entra():
    assert str(auth.decode_token(_token())["sub"]) == SUB


# ---------------------------------------------------------------------------
# quem não entra
# ---------------------------------------------------------------------------


def test_issuer_de_outro_projeto_e_recusado():
    """Sem a checagem de issuer, um token válido de OUTRO projeto Supabase
    passaria — o `aud` é `authenticated` em todos eles."""
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(_token(iss="https://outro.supabase.co/auth/v1"))


def test_audience_errada_e_recusada():
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(_token(aud="anon"))


def test_token_expirado_e_recusado():
    agora = dt.datetime.now(dt.timezone.utc)
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(
            _token(exp=int((agora - dt.timedelta(minutes=1)).timestamp()))
        )


def test_token_sem_exp_e_recusado():
    """Token sem validade é token eterno: um vazamento nunca deixaria de valer."""
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(_token(exp=None))


def test_token_sem_sub_e_recusado():
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(_token(sub=None))


def test_token_sem_iss_e_recusado():
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(_token(iss=None))


def test_assinatura_de_outra_chave_e_recusada():
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(_token(chave=OUTRA_CHAVE))


def test_HS256_e_recusado():
    """A confusão de algoritmo clássica: assinar com HS256 usando a chave PÚBLICA
    como segredo. Se `algorithms` aceitasse HS256, este token entraria."""
    agora = dt.datetime.now(dt.timezone.utc)
    forjado = jwt.encode(
        {"sub": SUB, "aud": "authenticated", "iss": ISSUER,
         "exp": int((agora + dt.timedelta(hours=1)).timestamp())},
        SEGREDO_HS,
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(forjado)


def test_alg_none_e_recusado():
    agora = dt.datetime.now(dt.timezone.utc)
    forjado = jwt.encode(
        {"sub": SUB, "aud": "authenticated", "iss": ISSUER,
         "exp": int((agora + dt.timedelta(hours=1)).timestamp())},
        key="",
        algorithm="none",
    )
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_token(forjado)


# ---------------------------------------------------------------------------
# configuração
# ---------------------------------------------------------------------------


def test_issuer_sai_da_url_do_projeto():
    assert get_settings().jwt_issuer == ISSUER


def test_url_do_jwks():
    assert get_settings().jwks_url == "https://exemplo.supabase.co/auth/v1/.well-known/jwks.json"


def test_barra_no_fim_nao_duplica(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co/")
    get_settings.cache_clear()
    assert "co//auth" not in get_settings().jwks_url
    assert get_settings().jwt_issuer == ISSUER


def test_langfuse_aceita_os_dois_nomes_de_host(monkeypatch):
    """A documentação do Langfuse manda copiar `LANGFUSE_BASE_URL`. Aceitar só
    `LANGFUSE_HOST` fazia um .env correto cair no default em silêncio — região
    errada, autenticação falhando sem alarde. Aconteceu em 31/08/2026."""
    monkeypatch.delenv("LANGFUSE_HOST", raising=False)
    monkeypatch.setenv("LANGFUSE_BASE_URL", "https://us.cloud.langfuse.com")
    get_settings.cache_clear()
    assert get_settings().langfuse_host == "https://us.cloud.langfuse.com"

    # e LANGFUSE_HOST continua ganhando quando os dois existem
    monkeypatch.setenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    get_settings.cache_clear()
    assert get_settings().langfuse_host == "https://cloud.langfuse.com"
