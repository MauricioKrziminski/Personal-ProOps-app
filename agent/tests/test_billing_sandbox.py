"""Sandbox em /hooks/billing: só concede por chave global, lista da revisão da Apple ou Test Store + chave."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db
from app.config import get_settings
from app.domain import billing
from app.routes import hooks

REVISOR = "11111111-1111-1111-1111-111111111111"
OUTRO = "22222222-2222-2222-2222-222222222222"


def _chama(monkeypatch, *, user, store="APP_STORE", env="SANDBOX", allow="", lista=""):
    monkeypatch.setenv("REVENUECAT_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("BILLING_ALLOW_SANDBOX", allow)
    monkeypatch.setenv("BILLING_SANDBOX_USER_IDS", lista)
    get_settings.cache_clear()
    visto = {}

    async def fake(sql, *args):
        visto["args"] = args
        return {"resultado": "ok"}

    monkeypatch.setattr(db, "fetch_one", fake)
    app = FastAPI()
    app.include_router(hooks.router)
    ev = {"id": "e1", "type": "INITIAL_PURCHASE", "app_user_id": user, "store": store,
          "environment": env, "product_id": "proops.personal.pro.monthly"}
    r = TestClient(app).post("/hooks/billing", json={"event": ev}, headers={"authorization": "s"})
    assert r.status_code == 200
    get_settings.cache_clear()
    return visto["args"]


def test_lista_concede_sandbox_so_para_quem_esta_nela(monkeypatch):
    assert _chama(monkeypatch, user=REVISOR, lista=REVISOR)[6] == "production"
    assert _chama(monkeypatch, user=OUTRO, lista=REVISOR)[6] == "sandbox"


def test_producao_sem_lista_nem_chave_recusa(monkeypatch):
    assert _chama(monkeypatch, user=REVISOR)[6] == "sandbox"


def test_test_store_e_sandbox(monkeypatch):
    a = _chama(monkeypatch, user=OUTRO, store="TEST_STORE")
    assert a[2] == "test_store" and a[6] == "sandbox"
    assert _chama(monkeypatch, user=OUTRO, store="TEST_STORE", allow="true")[6] == "production"


def test_evento_de_producao_nao_depende_da_lista(monkeypatch):
    assert _chama(monkeypatch, user=OUTRO, env="PRODUCTION")[6] == "production"


def test_sandbox_permitido_ignora_caixa_e_espaco():
    assert billing.sandbox_permitido(f" {REVISOR.upper()} ", False, {REVISOR})
