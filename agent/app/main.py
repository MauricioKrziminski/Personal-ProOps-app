"""Serviço único: webhook do WhatsApp, worker do agente, crons e rotas do app.

Um processo só, um container só. É isso que mantém a promessa de portabilidade:
o mesmo build roda no Cloud Run hoje e num VPS com docker compose amanhã, sem
tocar em lógica de negócio.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db, logctx
from app.config import DEV_SALT, get_settings
from app.graph import build as graph_build
from app.routes import chat, cron, finance_draft, hooks, inbound, internal, worker
from app.services import ia, groq, telemetry, whatsapp

CAMPOS_EXTRAS = ("alerta", "pendentes", "falhas", "shadow", "duracao_s", "custo_usd")


class _JsonFormatter(logging.Formatter):
    """Uma linha JSON por evento, no formato que o Cloud Logging indexa (`severity`, `message`).

    Os níveis do stdlib (DEBUG, INFO, WARNING, ERROR, CRITICAL) são nomes válidos de severity.
    """

    def format(self, record: logging.LogRecord) -> str:
        entrada = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            **logctx.atuais(),
        }
        # campos de `log.x(..., extra=...)` que o Cloud Logging precisa indexar (alertas, sombra)
        for campo in CAMPOS_EXTRAS:
            if hasattr(record, campo):
                entrada[campo] = getattr(record, campo)
        if record.exc_info:
            entrada["exception"] = self.formatException(record.exc_info)
        return json.dumps(entrada, ensure_ascii=False, default=str)


def _configura_logs() -> None:
    """JSON no Cloud Run (`K_SERVICE` presente); texto legível no laptop."""
    handler = logging.StreamHandler()
    if os.getenv("K_SERVICE"):
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)


_configura_logs()
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _checa_producao()
    ia.avisar_sombras()
    await db.open_pools()
    await graph_build.setup()
    log.info("pronto")
    yield
    await whatsapp.close_client()
    await groq.close_client()
    await _fecha_telemetria()
    await db.close_pools()


async def _fecha_telemetria() -> None:
    """Esvazia o buffer do Langfuse: com scale-to-zero, o trace do último turno morreria junto."""
    try:
        telemetry.shutdown()
    except Exception:  # noqa: BLE001 — fechar não pode impedir o resto do shutdown
        log.warning("telemetria não fechou limpo", exc_info=True)


def _checa_producao() -> None:
    """Recusa subir com configuração que só faz sentido no laptop.

    Falhar no boot é barulhento e barato. Subir e funcionar "quase certo" é o
    que gera bug que ninguém acha.
    """
    s = get_settings()
    # Produção = backend de fila real OU rodando no Cloud Run (`K_SERVICE`). Olhar só o backend
    # deixava passar um deploy com DEBOUNCE_BACKEND=inline sem NENHUMA checagem.
    if s.debounce_backend != "cloud_tasks" and not os.getenv("K_SERVICE"):
        return  # dev local: DEBOUNCE_BACKEND=inline
    # Valida FORMA, não só presença. Presença sozinha já foi enganada uma vez:
    # um comentário de .env virou valor, o campo ficou "não vazio" e esta função
    # aprovou uma configuração que devolvia 401 em toda rota interna.
    faltando = [
        nome
        for nome, ok in (
            ("THREAD_SALT", s.thread_salt != DEV_SALT and len(s.thread_salt) >= 32),
            ("WORKER_URL", s.worker_url.startswith("https://") and "/worker/" in s.worker_url),
            ("GCP_PROJECT", bool(s.gcp_project) and " " not in s.gcp_project),
            ("ANTHROPIC_API_KEY", bool(s.anthropic_api_key)),
            # embeddings e reserva entre provedores
            ("GEMINI_API_KEY", bool(s.gemini_api_key)),
            ("WHATSAPP_TOKEN", bool(s.whatsapp_token)),
            # sem ele a rota recusa TODA mensagem (HMAC) e a Meta reentrega em loop
            ("WHATSAPP_APP_SECRET", bool(s.whatsapp_app_secret)),
            ("TASKS_SA_EMAIL", "@" in s.tasks_sa_email and s.tasks_sa_email.endswith(".iam.gserviceaccount.com")),
        )
        if not ok
    ]
    # OIDC ou segredo compartilhado: sem nenhum dos dois, /worker e /cron
    # devolvem 401 para todo mundo e nada é processado.
    tem_oidc = s.oidc_audience.startswith("https://")
    tem_segredo = len(s.internal_secret) >= 16
    if not (tem_oidc or tem_segredo):
        faltando.append("OIDC_AUDIENCE (ou INTERNAL_SECRET)")
    if faltando:
        raise RuntimeError(
            "configuração de produção incompleta: " + ", ".join(faltando)
        )


app = FastAPI(title="ProOps — agente", lifespan=lifespan)

app.include_router(inbound.router)
app.include_router(worker.router)
app.include_router(cron.router)
app.include_router(hooks.router)
app.include_router(internal.router)
app.include_router(chat.router)
app.include_router(finance_draft.router)
chat.install_error_handlers(app)

# CORS só para as origens ENUMERADAS. Nunca `*`: a requisição carrega o JWT no
# header, e `*` com credencial é a porta aberta para qualquer página do mundo.
# O app nativo não manda `Origin` — isto existe para o Expo web e o dev server.
_origens = get_settings().cors_origins
if _origens:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origens,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["authorization", "content-type"],
    )


@app.get("/health")
async def health() -> dict:
    """Sonda do Cloud Run. Toca o banco de propósito: um processo que subiu mas
    não fala com o Postgres não está saudável, está pronto para falhar em
    silêncio."""
    await db.fetch_one("select 1 as ok")
    return {"status": "ok"}
