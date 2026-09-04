"""O boot recusa configuração que só faz sentido no laptop.

Falhar no boot é barulhento e barato. Subir e funcionar "quase certo" — com o
salt de dev derivando todo thread_id, ou sem OIDC nas rotas internas — é o que
gera bug que ninguém acha.
"""

import pytest

from app.config import DEV_SALT, get_settings
from app.main import _checa_producao

PROD = {
    "DEBOUNCE_BACKEND": "cloud_tasks",
    # tamanho real: `openssl rand -hex 32` devolve 64 caracteres
    "THREAD_SALT": "9f" * 32,
    "WORKER_URL": "https://agente-x.run.app/worker/process-thread",
    "GCP_PROJECT": "proj",
    "TASKS_SA_EMAIL": "agente-runner@proj.iam.gserviceaccount.com",
    "OIDC_AUDIENCE": "https://agente-x.run.app",
    "DATABASE_URL": "postgresql://x/y",
}


def _config(monkeypatch, **override):
    for k, v in {**PROD, **override}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()


def test_producao_completa_sobe(monkeypatch):
    _config(monkeypatch)
    _checa_producao()
    get_settings.cache_clear()


def test_dev_local_nao_e_barrado(monkeypatch):
    # com DEBOUNCE_BACKEND=inline nada disso é exigido
    _config(monkeypatch, DEBOUNCE_BACKEND="inline", THREAD_SALT=DEV_SALT, WORKER_URL="")
    _checa_producao()
    get_settings.cache_clear()


@pytest.mark.parametrize(
    "campo,valor",
    [
        ("THREAD_SALT", DEV_SALT),   # thread_id derivado de constante pública
        ("WORKER_URL", ""),          # debounce não teria para onde apontar
        ("GCP_PROJECT", ""),
        ("TASKS_SA_EMAIL", ""),
    ],
)
def test_producao_incompleta_falha(monkeypatch, campo, valor):
    _config(monkeypatch, **{campo: valor})
    with pytest.raises(RuntimeError, match=campo.split()[0]):
        _checa_producao()
    get_settings.cache_clear()


def test_sem_oidc_nem_segredo_falha(monkeypatch):
    # /worker e /cron devolveriam 401 para todo mundo e nada seria processado
    _config(monkeypatch, OIDC_AUDIENCE="", INTERNAL_SECRET="")
    with pytest.raises(RuntimeError, match="OIDC_AUDIENCE"):
        _checa_producao()
    get_settings.cache_clear()


def test_segredo_compartilhado_serve_no_lugar_do_oidc(monkeypatch):
    # é o que mantém a portabilidade para VPS
    _config(monkeypatch, OIDC_AUDIENCE="", INTERNAL_SECRET="a" * 64)
    _checa_producao()
    get_settings.cache_clear()


def test_a_aba_agente_esta_no_ar(monkeypatch):
    """As rotas do chat precisam estar montadas no app de verdade.

    O router existir e nunca ser incluído em `main.py` é um erro invisível: todo
    teste de rota monta o próprio FastAPI mínimo e passa igual, enquanto o app
    publicado devolve 404 em tudo.
    """
    from app.main import app

    # Pelo OpenAPI, não por `app.routes`: esta versão do FastAPI guarda os
    # routers incluídos em `_IncludedRouter`, que não expõe `.path` — varrer a
    # lista crua devolve vazio e o teste "passaria" ao contrário.
    caminhos = app.openapi()["paths"]
    assert "/internal/chat/conversations" in caminhos
    assert "/internal/chat/conversations/{session_id}/messages" in caminhos
    assert "/internal/chat/conversations/{session_id}/actions/{pending_id}" in caminhos
    assert {"get", "post"} <= set(caminhos["/internal/chat/conversations"])
    assert {"patch", "delete"} <= set(
        caminhos["/internal/chat/conversations/{session_id}"]
    )


def test_cors_nunca_e_curinga(monkeypatch):
    """`*` com credencial no header é a porta aberta para qualquer página. A
    lista é enumerada, e vazia significa NENHUMA — não todas."""
    from app.config import get_settings

    monkeypatch.setenv("APP_CORS_ORIGINS", "http://localhost:8081, http://localhost:19006")
    get_settings.cache_clear()
    origens = get_settings().cors_origins
    assert origens == ["http://localhost:8081", "http://localhost:19006"]
    assert "*" not in origens

    monkeypatch.setenv("APP_CORS_ORIGINS", "")
    get_settings.cache_clear()
    assert get_settings().cors_origins == []
    get_settings.cache_clear()
