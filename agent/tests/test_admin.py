"""Painel /admin: autorização, LGPD (sem dado financeiro) e cortesia só em `manual`, com auditoria."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import db
from app.config import get_settings
from app.routes import admin

ADMIN = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
OUTRO = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
ALVO = uuid4()
WS = uuid4()
PROIBIDO = ("amount", "balance", "saldo", "transac", "lancamento", "valor", "nota", "note", "account_id", "phone")


@pytest.fixture
def cli(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("ADMIN_USER_IDS", f"lixo, {ADMIN}")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    quem = {"id": ADMIN}

    async def _user(_req):
        if quem["id"] is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return quem["id"]

    monkeypatch.setattr(admin, "current_user", _user)
    app = FastAPI()
    app.include_router(admin.router)
    c = TestClient(app)
    c.quem = quem
    yield c
    get_settings.cache_clear()


@pytest.fixture
def banco(monkeypatch):
    """Dublê de `db`: registra SQL e devolve o que o teste programar."""
    est = {"sql": [], "sub": {"provider": None}, "linhas": [], "eventos": []}

    @asynccontextmanager
    async def _uow():
        yield

    async def fetch(sql, *a):
        est["sql"].append(sql)
        return est["linhas"]

    async def fetch_one(sql, *a):
        est["sql"].append(sql)
        if "from public.workspaces where owner_id" in sql:
            return {"id": WS}
        if "insert into public.subscriptions" in sql:
            return {"workspace_id": WS} if est["sub"]["provider"] in (None, "manual") else None
        if "update public.subscriptions" in sql:
            return {"workspace_id": WS} if est["sub"]["provider"] == "manual" else None
        if "count(*)::int as n" in sql:
            return {"n": len(est["linhas"])}
        if "with prim" in sql:
            return {"contas": 3, "novas_7d": 1, "novas_30d": 2, "pro": 1, "familia": 0, "em_teste": 0,
                    "cortesia": 1, "encerradas": 0, "nunca": 1, "turnos_ia_mes": 5, "respostas_mes": 2,
                    "avisos_mes": 1, "custo_ia_usd_mes": 0.12}
        return None

    async def execute(sql, *a):
        est["eventos"].append(a)
        return 1

    monkeypatch.setattr(db, "unidade_de_trabalho", _uow)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "execute", execute)
    return est


def _linha():
    agora = datetime(2026, 10, 1, tzinfo=timezone.utc)
    return {"id": ALVO, "email": "a@b.com", "display_name": "Ana", "created_at": agora,
            "last_sign_in_at": agora, "plan": "pro", "status": "active", "access": "subscriber",
            "is_trial": False, "current_period_end": None, "provider": "manual",
            "ai_messages_month": 3, "max_ai_messages_month": 400,
            "whatsapp_replies_month": 1, "max_whatsapp_replies_month": 150,
            # colunas que a função devolve e que NÃO podem sair
            "members": 1, "can_import": True, "phone": "5511999999999", "amount_cents": 100}


def test_desligado_e_404(cli, monkeypatch):
    monkeypatch.setenv("ADMIN_USER_IDS", "")
    get_settings.cache_clear()
    assert cli.get("/admin").status_code == 404
    assert cli.get("/admin/api/overview").status_code == 404


def test_sem_token_401_e_nao_admin_403(cli, banco):
    cli.quem["id"] = None
    assert cli.get("/admin/api/overview").status_code == 401
    cli.quem["id"] = OUTRO
    for r in (cli.get("/admin/api/overview"), cli.get("/admin/api/accounts"),
              cli.post("/admin/api/courtesy/grant", json={"user_id": str(ALVO), "plan": "pro"}),
              cli.post("/admin/api/courtesy/revoke", json={"user_id": str(ALVO)})):
        assert r.status_code == 403
    assert banco["sql"] == []  # nem tocou no banco


def test_admin_ve_dados_sem_campo_financeiro(cli, banco):
    banco["linhas"] = [_linha()]
    o = cli.get("/admin/api/overview")
    a = cli.get("/admin/api/accounts?q=a_b%")
    assert o.status_code == a.status_code == 200
    assert o.json()["contas"] == 3 and a.json()["contas"][0]["email"] == "a@b.com"
    assert a.headers["cache-control"] == "no-store" and "noindex" in a.headers["x-robots-tag"]
    texto = (json.dumps(o.json()) + json.dumps(a.json())).lower()
    for palavra in PROIBIDO:
        assert palavra not in texto, palavra
    assert "5511" not in texto


def test_pagina_traz_csp_e_so_chave_publica(cli):
    r = cli.get("/admin")
    assert r.status_code == 200
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert "__NONCE__" not in r.text and "__CONFIG__" not in r.text


def test_cortesia_so_em_manual_e_audita(cli, banco):
    corpo = {"user_id": str(ALVO), "plan": "family"}
    assert cli.post("/admin/api/courtesy/grant", json={**corpo, "plan": "free"}).status_code == 400
    banco["sub"]["provider"] = "apple"
    assert cli.post("/admin/api/courtesy/grant", json=corpo).status_code == 409
    assert cli.post("/admin/api/courtesy/revoke", json={"user_id": str(ALVO)}).status_code == 409
    assert banco["eventos"] == []
    banco["sub"]["provider"] = None
    assert cli.post("/admin/api/courtesy/grant", json=corpo).status_code == 200
    banco["sub"]["provider"] = "manual"
    assert cli.post("/admin/api/courtesy/revoke", json={"user_id": str(ALVO)}).status_code == 200
    (id1, tipo1, ws1, p1), (id2, tipo2, _w, p2) = [(e[0], e[1], e[2], e[3].obj) for e in banco["eventos"]]
    assert id1.startswith("admin:") and tipo1 == "ADMIN_COURTESY_GRANT" and ws1 == WS
    assert p1["admin_id"] == str(ADMIN) and p1["plan"] == "family" and p1["workspace_id"] == str(WS)
    assert tipo2 == "ADMIN_COURTESY_REVOKE" and p2["admin_id"] == str(ADMIN)
    sqls = " ".join(banco["sql"])
    assert "provider is null or public.subscriptions.provider = 'manual'" in sqls
    assert "provider = 'manual' and plan <> 'free'" in sqls
