"""Serviço único: webhook do WhatsApp, worker do agente, crons e rotas do app.

Um processo só, um container só. É isso que mantém a promessa de portabilidade:
o mesmo build roda no Cloud Run hoje e num VPS com docker compose amanhã, sem
tocar em lógica de negócio.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db
from app.config import DEV_SALT, get_settings
from app.graph import build as graph_build
from app.routes import cron, hooks, inbound, internal, worker
from app.services import whatsapp

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s %(message)s",  # Cloud Logging parseia isto
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _checa_producao()
    await db.open_pools()
    await graph_build.setup()
    log.info("pronto")
    yield
    await whatsapp.close_client()
    await db.close_pools()


def _checa_producao() -> None:
    """Recusa subir com configuração que só faz sentido no laptop.

    Falhar no boot é barulhento e barato. Subir e funcionar "quase certo" é o
    que gera bug que ninguém acha.
    """
    s = get_settings()
    if s.debounce_backend != "cloud_tasks":
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


app = FastAPI(title="Personal ProOps — agente", lifespan=lifespan)

app.include_router(inbound.router)
app.include_router(worker.router)
app.include_router(cron.router)
app.include_router(hooks.router)
app.include_router(internal.router)


@app.get("/health")
async def health() -> dict:
    """Sonda do Cloud Run. Toca o banco de propósito: um processo que subiu mas
    não fala com o Postgres não está saudável, está pronto para falhar em
    silêncio."""
    await db.fetch_one("select 1 as ok")
    return {"status": "ok"}
