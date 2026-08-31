"""Verificação do JWT do app.

O projeto assina com **ES256** (chave assimétrica publicada em jwks.json), não
com o segredo simétrico legado. Verificar com HS256 rejeitaria todo token — e o
sintoma seria um 401 que parece problema de permissão, não de algoritmo.
Descoberto em 31/08/2026, checando o endpoint jwks.json do projeto.
"""

import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_url_do_jwks():
    assert get_settings().jwks_url == "https://exemplo.supabase.co/auth/v1/.well-known/jwks.json"


def test_barra_no_fim_nao_duplica(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co/")
    get_settings.cache_clear()
    assert "co//auth" not in get_settings().jwks_url


def test_algoritmo_e_es256():
    """Trava o algoritmo. Aceitar HS256 aqui abriria a porta para um token
    forjado com o segredo público — o clássico ataque de confusão de algoritmo."""
    import inspect

    from app.routes import internal

    fonte = inspect.getsource(internal._decode)
    assert 'algorithms=["ES256"]' in fonte
    assert "HS256" not in fonte


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
