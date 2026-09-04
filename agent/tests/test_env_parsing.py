"""O .env e o comentário que virou valor.

Descoberto em 31/08/2026, ao conectar pela primeira vez: a linha
`DB_PREPARE_THRESHOLD=   # deixe vazio no session pooler` fez o parser entregar
o COMENTÁRIO como valor. Seis campos foram contaminados, e três deles
(`WORKER_URL`, `TASKS_SA_EMAIL`, `OIDC_AUDIENCE`) enganaram a checagem de
produção do main.py — que só olhava presença. O serviço subiria com config
inválida e devolveria 401 em toda rota interna.
"""

import pytest

from app.config import DEV_SALT, get_settings
from app.main import _checa_producao

PROD = {
    "DEBOUNCE_BACKEND": "cloud_tasks",
    "DATABASE_URL": "postgresql://x/y",
    "THREAD_SALT": "a" * 64,
    "WORKER_URL": "https://agente-x.run.app/worker/process-thread",
    "GCP_PROJECT": "personal-proops-agent",
    "TASKS_SA_EMAIL": "agente-runner@proj.iam.gserviceaccount.com",
    "OIDC_AUDIENCE": "https://agente-x.run.app",
}


def _cfg(monkeypatch, **over):
    for k, v in {**PROD, **over}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()


def test_comentario_no_fim_da_linha_e_removido(monkeypatch):
    _cfg(monkeypatch, GCP_PROJECT="meu-projeto   # comentário atrás do valor")
    assert get_settings().gcp_project == "meu-projeto"
    get_settings.cache_clear()


def test_valor_que_e_so_comentario_vira_vazio(monkeypatch):
    _cfg(monkeypatch, OIDC_AUDIENCE="   # a URL do serviço no Cloud Run")
    assert get_settings().oidc_audience == ""
    get_settings.cache_clear()


def test_cerquilha_colada_no_valor_sobrevive(monkeypatch):
    """Senha com `#` no meio não pode ser mutilada — só corta com espaço antes."""
    _cfg(monkeypatch, INTERNAL_SECRET="abc#def#ghi-com-tamanho-suficiente")
    assert get_settings().internal_secret == "abc#def#ghi-com-tamanho-suficiente"
    get_settings.cache_clear()


@pytest.mark.parametrize(
    "campo,lixo",
    [
        ("WORKER_URL", "# https://<cloud-run>/worker/process-thread"),
        ("TASKS_SA_EMAIL", "# service account que assina o token OIDC"),
        ("GCP_PROJECT", "   # o projeto"),
        ("THREAD_SALT", DEV_SALT),
    ],
)
def test_producao_recusa_valor_de_mentira(monkeypatch, campo, lixo):
    _cfg(monkeypatch, **{campo: lixo})
    with pytest.raises(RuntimeError):
        _checa_producao()
    get_settings.cache_clear()


def test_producao_recusa_url_de_worker_sem_a_rota(monkeypatch):
    # presença não basta: tem que ser a rota certa
    _cfg(monkeypatch, WORKER_URL="https://agente-x.run.app")
    with pytest.raises(RuntimeError, match="WORKER_URL"):
        _checa_producao()
    get_settings.cache_clear()


def test_producao_completa_passa(monkeypatch):
    _cfg(monkeypatch)
    _checa_producao()
    get_settings.cache_clear()


def test_template_de_alerta_e_independente_do_lembrete(monkeypatch):
    _cfg(
        monkeypatch,
        WA_ALERT_TEMPLATE="alerta_aprovado",
        WA_REMINDER_TEMPLATE="lembrete_aprovado",
    )
    settings = get_settings()
    assert settings.wa_alert_template == "alerta_aprovado"
    assert settings.wa_reminder_template == "lembrete_aprovado"
    get_settings.cache_clear()
