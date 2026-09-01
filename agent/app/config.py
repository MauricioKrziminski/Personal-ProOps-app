"""Configuração única do serviço. Todo segredo entra por env var."""

import re
from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SALT = "dev-salt-trocar-em-producao"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # --- banco ---
    # Sem valor obrigatório de propósito: script que não toca no banco
    # (validador de schema, por exemplo) não pode ser barrado por isto. Quem
    # exige de verdade é `db.open_pools()`, com mensagem própria.
    database_url: str = ""
    db_pool_min: int = 1
    db_pool_max: int = 4
    # Vazio = deixa o psycopg decidir (session pooler / conexão direta).
    # "0" desliga prepared statements, obrigatório atrás do transaction pooler.
    db_prepare_threshold: str = ""

    # --- WhatsApp ---
    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""
    wa_otp_template: str = "personal_proops_login_otp"
    wa_reminder_template: str = "personal_proops_reminder"

    # --- IA ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.7-flash"
    groq_api_key: str = ""

    # --- Cloud Tasks ---
    gcp_project: str = ""
    gcp_location: str = "southamerica-east1"
    tasks_queue: str = "wa-debounce"
    worker_url: str = ""
    tasks_sa_email: str = ""
    debounce_seconds: int = 3
    # cloud_tasks | inline (dev: chama o worker no mesmo processo)
    debounce_backend: str = "cloud_tasks"

    # --- segurança ---
    # O default só serve para teste local. `main.py` recusa subir com ele quando
    # a config é de produção: derivar todo thread_id de uma constante pública
    # tornaria os identificadores de conversa adivinháveis.
    thread_salt: str = DEV_SALT
    oidc_audience: str = ""
    internal_secret: str = ""
    send_sms_hook_secret: str = ""
    revenuecat_webhook_secret: str = ""
    # 'true' SÓ durante os testes de sandbox da loja. TEM que sair antes de publicar.
    billing_allow_sandbox: str = ""
    # URL do projeto Supabase. Dela sai o JWKS que valida o JWT do app.
    # NÃO é o segredo simétrico legado: este projeto assina com ES256
    # (chave assimétrica), e verificar com HS256 rejeitaria todo token.
    supabase_url: str = ""

    # --- regras ---
    hitl_amount_threshold_cents: int = 100_000
    max_parses_per_hour: int = 60
    pending_ttl_minutes: int = 10
    session_idle_hours: int = 6

    # --- Langfuse ---
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    # Aceita os DOIS nomes: a documentação do Langfuse manda copiar
    # LANGFUSE_BASE_URL, e um .env com esse nome caía no default em silêncio —
    # apontando para a região errada e falhando a autenticação sem alarde.
    langfuse_host: str = Field(
        "https://cloud.langfuse.com",
        validation_alias=AliasChoices("LANGFUSE_HOST", "LANGFUSE_BASE_URL"),
    )

    @field_validator("*", mode="before")
    @classmethod
    def _sem_comentario(cls, v):
        """Corta comentário de fim de linha e espaço em volta.

        O parser de .env NÃO remove `# comentário` quando o valor está vazio: a
        linha `OIDC_AUDIENCE=   # a URL do serviço` vira o comentário INTEIRO
        como valor. Isso não é cosmético — campo com lixo é "não vazio", e a
        checagem de produção do main.py passava achando que estava configurado.
        O serviço subia e devolvia 401 em /worker e /cron.

        Só corta quando há espaço antes do `#`, que é a convenção do dotenv:
        senha com `#` no meio (sem espaço) continua intacta.
        """
        if not isinstance(v, str):
            return v
        limpo = re.sub(r"\s+#.*$", "", v).strip()
        return "" if limpo.startswith("#") else limpo

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"



@lru_cache
def get_settings() -> Settings:
    return Settings()
