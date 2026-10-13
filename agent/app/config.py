"""Configuração única do serviço. Todo segredo entra por env var."""

import re
from functools import lru_cache
from typing import Literal
from uuid import UUID

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
    # Dimensionados junto com o `--concurrency` e o `--max-instances` do Cloud Run
    # (setup-gcp.sh). Duas forças puxam em sentidos opostos: pool pequeno demais enfileira
    # (PoolTimeout vira retry e paga o LLM de novo); pool grande demais estoura o pooler do
    # Supabase em modo SESSÃO (porta 5432), em que cada conexão do cliente segura uma do
    # servidor e o teto do plano é baixo. O turno passa a maior parte do tempo esperando o
    # Gemini, sem conexão nenhuma, então 5+3 atende os 10 turnos por instância, e 4 instâncias
    # dão no máximo 32 conexões.
    db_pool_max: int = 5
    db_graph_pool_max: int = 3
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
    wa_alert_template: str = "personal_proops_alert"

    # --- IA ---
    gemini_api_key: str = ""
    # Claude (Anthropic): a IA de produção/staging por papel (`services/ia.py`); o Gemini fica
    # com embeddings e com a reserva entre provedores.
    anthropic_api_key: str = ""
    groq_api_key: str = ""
    # Prompts v2 (módulos por sub-intenção + exemplos por recuperação). DESLIGADO por padrão: só
    # liga depois da avaliação com o Gemini real (`scripts/comparar_prompts.py`). Desligado, os
    # prompts e os schemas enviados ao modelo são byte a byte os de antes (`tests/test_prompt_v2.py`).
    agent_prompt_v2: bool = False

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
    # uuids (app_user_id) cujo evento de SANDBOX concede mesmo com a chave acima desligada: a conta de
    # teste da revisão da Apple, que compra em sandbox contra o agente de PRODUÇÃO. Separados por vírgula.
    billing_sandbox_user_ids: str = ""
    # URL do projeto Supabase. Dela sai o JWKS que valida o JWT do app.
    # NÃO é o segredo simétrico legado: este projeto assina com ES256
    # (chave assimétrica), e verificar com HS256 rejeitaria todo token.
    supabase_url: str = ""
    # Chave PÚBLICA (anon/publishable) do mesmo projeto: o painel /admin a entrega ao navegador
    # para o login por e-mail e senha. Nunca a service_role.
    supabase_anon_key: str = ""
    # uuids (auth.users.id) que podem usar o painel /admin, separados por vírgula. Vazio = painel
    # desligado (toda rota /admin responde 404).
    admin_user_ids: str = ""
    # Exige aal2 (TOTP) no JWT do painel /admin. LIGADO por padrão (09/10/2026): esquecer a variável
    # não pode abrir o painel só com senha. O E2E local e o staging passam `false` de forma explícita.
    admin_require_mfa: bool = True

    # Que papel este processo cumpre (13/10/2026). `agente` (padrão): webhook, worker, crons e as rotas
    # do app, e o painel NÃO existe aqui (404), mesmo com ADMIN_USER_IDS. `admin`: SÓ o painel /admin,
    # num serviço próprio do Cloud Run com o IAP na frente; todo o resto responde 404. A mesma imagem
    # serve os dois, e o painel deixa de dividir processo, porta e segredos com o webhook público.
    servico: Literal["agente", "admin"] = "agente"
    # IAP (Identity-Aware Proxy) na frente do painel: toda requisição tem que trazer o
    # `x-goog-iap-jwt-assertion` assinado pelo Google, com este `aud`
    # (`/projects/<número>/locations/<região>/services/<serviço>`). LIGADO por padrão: esquecer a
    # variável fecha o painel em vez de abri-lo. Só o desenvolvimento local passa `false`.
    admin_exige_iap: bool = True
    admin_iap_audience: str = ""
    # E-mails Google que o IAP deixa passar, separados por vírgula. Conferidos DE NOVO aqui: uma
    # permissão do IAP concedida a mais (um grupo, um domínio) não abre o painel sozinha.
    admin_iap_emails: str = ""

    # Consentimento de IA (LGPD): ligado, quem não tem `profiles.ai_consent_at` não chega ao modelo
    # (app: 403 `ai_consent_required`; WhatsApp: um aviso por dia). Desligado = nada muda. Produção
    # fica `false` até o app com a tela de consentimento estar na loja (o app em campo não consegue
    # consentir); o staging liga.
    ai_consent_required: bool = False

    # RLS como segunda camada: ligada, a TOOL roda sob `authenticated` com as claims do dono da
    # conversa (`db.sob_rls`), como o PostgREST faz com o app. Desligada = comportamento antigo.
    agente_rls: bool = False

    # --- regras ---
    hitl_amount_threshold_cents: int = 100_000
    max_parses_per_hour: int = 60
    # Captura de notificações (`kind='capture'`): fora da rajada por hora do chat, com teto próprio de
    # chamadas de modelo por espaço em 24 h, conferido sob o lock de `db.reservar_cota`.
    max_capturas_por_dia: int = 60
    # Aceita notificações de `com.android.shell` (o `adb shell cmd notification post`) como banco de
    # teste. Só no staging: em produção um pacote de teste seria um jeito de mandar texto à IA.
    captura_aceita_teste: bool = False
    pending_ttl_minutes: int = 10
    session_idle_hours: int = 6
    # Quanto tempo um turno do app segura a conversa. Vencido, outro turno pode
    # tomar — senão um container que morre no meio prende a conversa para sempre.
    app_turn_lease_seconds: int = 300
    # Prazo de um turno do WhatsApp. Abaixo dos 300 s do Cloud Run: estourando, o
    # worker devolve o lote à fila (mark_retry) em vez de o container ser morto
    # com a mensagem presa em `processing`.
    worker_turn_timeout_seconds: int = 240
    # SLO do turno do WhatsApp: acima disto o worker loga `alerta=turno_lento`, que a métrica
    # `<serviço>-turno-lento` (`setup-gcp.sh alertas`) conta. Um turno normal leva 3–10 s.
    turno_lento_seconds: int = 30
    # Teto de custo de IA nas últimas 24 h (soma de `ai_events.estimated_cost_usd`); acima, o cron
    # loga `alerta=custo_diario`. US$ 5 ≈ 2.900 turnos de gasto a US$ 0,0017 (06/10/2026).
    custo_diario_alerta_usd: float = 5.0
    # Origens permitidas na aba Agente, separadas por vírgula. Vazio = nenhuma
    # (o app nativo não manda Origin; isto é para o Expo web e o dev server).
    app_cors_origins: str = ""
    # Requisições por minuto, por usuário e por instância, nas rotas do app (`app/ratelimit.py`).
    # 0 desliga. A régua é ABUSO, não uso: a conversa aberta relê o turno a cada 3 s
    # (`POLL_MS` em `src/hooks/use-agent-chat.ts`) = 20/min, e o resto do app soma por cima.
    rate_limit_per_minute: int = 120
    # Idem, só para `/admin/api/*` (por admin): o painel abre cada tela com ~8 chamadas. 0 desliga.
    admin_rate_limit_per_minute: int = 600

    # --- Langfuse ---
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    # Fração dos TRACES enviados (0..1). Amostra por trace id: o turno entra inteiro ou não entra.
    # Produção recomendada 0.1 (docs/CUSTOS-E-PRECOS.md §8); suítes com --langfuse ignoram (100%).
    langfuse_sample_rate: float = Field(1.0, ge=0.0, le=1.0)
    # Aceita os DOIS nomes: a documentação do Langfuse manda copiar
    # LANGFUSE_BASE_URL, e um .env com esse nome caía no default em silêncio —
    # apontando para a região errada e falhando a autenticação sem alarde.
    langfuse_host: str = Field(
        "https://cloud.langfuse.com",
        validation_alias=AliasChoices("LANGFUSE_HOST", "LANGFUSE_BASE_URL"),
    )

    @field_validator("agente_rls", "ai_consent_required", mode="before")
    @classmethod
    def _rls_vazio_e_desligado(cls, v):
        return False if isinstance(v, str) and not re.sub(r"\s+#.*$", "", v).strip() else v

    @field_validator("admin_require_mfa", mode="before")
    @classmethod
    def _mfa_vazio_e_ligado(cls, v):
        # variável vazia = não configurada: vale o default seguro (ligado), nunca "desligado"
        return True if isinstance(v, str) and not re.sub(r"\s+#.*$", "", v).strip() else v

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
    def admin_ids(self) -> set[UUID]:
        ids: set[UUID] = set()
        for bruto in self.admin_user_ids.split(","):
            try:
                ids.add(UUID(bruto.strip()))
            except ValueError:
                continue
        return ids

    @property
    def admin_iap_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_iap_emails.split(",") if e.strip()}

    @property
    def billing_sandbox_ids(self) -> set[str]:
        ids: set[str] = set()
        for bruto in self.billing_sandbox_user_ids.split(","):
            try:
                ids.add(str(UUID(bruto.strip())))
            except ValueError:
                continue
        return ids

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        """Quem emitiu o token. `aud` é `authenticated` em TODO projeto Supabase
        do mundo — sem conferir o issuer, um token de outro projeto entra."""
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def cors_origins(self) -> list[str]:
        """Origens do app que podem chamar a API. Lista fechada, nunca `*`:
        com credencial no header, `*` é a porta aberta para qualquer página."""
        return [o.strip() for o in self.app_cors_origins.split(",") if o.strip()]



@lru_cache
def get_settings() -> Settings:
    return Settings()
