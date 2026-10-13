"""API do painel /admin (docs/ADMIN-API.md): autorização, MFA, formato de cada rota, LGPD e auditoria."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
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
AGORA = datetime(2026, 10, 1, tzinfo=timezone.utc)
# chaves e valores que NUNCA podem sair (os dublês as injetam nas linhas para provar que a montagem é campo a campo)
CHAVES_PROIBIDAS = {"amount", "amount_cents", "balance", "balance_cents", "saldo", "description", "content",
                    "merchant", "title", "valor", "note_text", "account_id"}
SENTINELAS = ("SEGREDO-FINANCEIRO", "987654")


def _linha_base(**kw):
    return {"user_id": ALVO, "workspace_id": WS, "email": "a@b.com", "name": "Ana", "created_at": AGORA,
            "last_sign_in_at": AGORA, "suspended": False, "whatsapp_linked": True, "plan": "pro",
            "status": "active", "access": "subscriber", "is_trial": False, "period_end": None,
            "provider": "manual", "ai_used": 3, "ai_max": 400, "wa_used": 1, "wa_max": 150,
            "notices_today": 0, "notices_max": 1,
            # o que a base poderia carregar e que NÃO pode sair
            "amount_cents": 987654, "description": "SEGREDO-FINANCEIRO", **kw}


@pytest.fixture
def cli(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("ADMIN_USER_IDS", f"lixo, {ADMIN}")
    monkeypatch.setenv("SERVICO", "admin")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "false")  # o default é ligado; os testes de MFA ligam de volta
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-publica")
    estado = {"id": ADMIN, "aal": "aal1"}

    async def _user(_req):
        if estado["id"] is None:
            raise HTTPException(status_code=401, detail="token inválido")
        return estado["id"]

    monkeypatch.setattr(admin, "current_user", _user)
    monkeypatch.setattr(admin, "decode_token", lambda _t: {"aal": estado["aal"]})
    app = FastAPI()
    app.include_router(admin.router)
    c = TestClient(app, headers={"Authorization": "Bearer x"})
    c.estado = estado
    yield c
    get_settings.cache_clear()


@pytest.fixture
def banco(monkeypatch):
    """Dublê de `db`: devolve linhas fixas por trecho de SQL e registra o que foi escrito."""
    est = {"sql": [], "escritas": [], "provider": None, "phone": "5511999999999", "lista": [_linha_base()]}

    @asynccontextmanager
    async def _uow():
        est["escritas"].append(("BEGIN",))
        yield
        est["escritas"].append(("COMMIT",))

    async def fetch_one(sql, *a):
        est["sql"].append(sql)
        if "w.owner_id = p.id" in sql:  # _alvo
            return {"id": ALVO, "email": "a@b.com", "phone": est["phone"], "ws": WS}
        if "for update" in sql:
            return {"plan": "pro", "provider": est["provider"]}
        if "count(*)::int as total" in sql:
            return {k: 1 for k in ("total", "new_7d", "new_30d", "subscriber", "trialing", "lapsed", "never",
                                   "courtesy", "suspended", "pro", "family", "trial_ending_48h", "near_limit",
                                   "inactive_subscribers_30d", "lapsed_7d", "ai_turns", "replies", "notices")
                    } | {"cost": Decimal("1.5"), "amount_cents": 987654}
        if "count(*)::int as n" in sql:
            return {"n": 1}
        if "from base where user_id" in sql:
            return _linha_base()
        if "as onboarding" in sql:
            return {"phone": est["phone"], "email_confirmed_at": AGORA, "banned_until": None,
                    "onboarding": True, "sessoes": 2}
        if "from public.subscriptions where workspace_id" in sql:
            return {"plan": "pro", "status": "active", "provider": est["provider"], "external_id": "ext",
                    "product_id": "p", "environment": "production", "is_trial": False,
                    "current_period_end": None, "canceled_at": None, "amount_cents": 987654}
        if "as c from public.ai_events" in sql:
            return {"c": Decimal("0.5")}
        if "as transactions" in sql:
            return {k: 2 for k in ("transactions", "accounts", "cards", "notes", "reminders", "goals", "debts",
                                   "recurring")} | {"description": "SEGREDO-FINANCEIRO"}
        if "as pending" in sql:
            return {"pending": 1, "processing": 0, "failed_24h": 2, "oldest": 30, "c24": Decimal("0.1"),
                    "c7": Decimal("0.7"), "replies": 4, "notices": 1}
        if "select email::text as email from auth.users" in sql:
            return {"email": "admin@x.com"}
        return None

    async def fetch(sql, *a):
        est["sql"].append(sql)
        if "from public.admin_audit_events e" in sql:
            return [{"id": uuid4(), "created_at": AGORA, "action": "suspended", "admin_user_id": ADMIN,
                     "admin_email": "admin@x.com", "target_user_id": ALVO, "target_email": "a@b.com",
                     "payload": {"reason": "x"}}]
        if "'YYYY-MM-DD'" in sql:
            return [{"day": "2026-10-01", "usd": Decimal("0.2")}]
        if "from public.profiles p" in sql and "'YYYY-MM'" in sql:
            return [{"month": "2026-10", "n": 3}]
        if "'YYYY-MM'" in sql:
            return [{"month": "2026-10", "ai_turns": 5, "replies": 2, "cost": Decimal("0.3")}]
        if "from public.workspace_members" in sql:
            return [{"user_id": ALVO, "email": "a@b.com", "display_name": "Ana", "role": "owner"}]
        if "from public.workspace_invites" in sql:
            return [{"id": "11111111-1111-1111-1111-111111111111", "phone": "5511", "status": "pending", "created_at": AGORA}]
        if "from public.billing_events" in sql or "from (select id, received_at" in sql:
            return [{"id": "ev1", "type": "INITIAL_PURCHASE", "result": "ok", "received_at": AGORA,
                     "provider": "app_store", "app_user_id": str(ALVO), "email": "a@b.com",
                     "product_id": "p", "environment": "PRODUCTION"}]
        if "from public.messages_queue where status = 'failed'" in sql:
            return [{"created_at": AGORA, "status": "failed", "last_error": "boom"}]
        if "from base where" in sql:
            return est["lista"]
        return []

    async def execute(sql, *a):
        est["escritas"].append((sql, a))
        return 1

    monkeypatch.setattr(db, "unidade_de_trabalho", _uow)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "execute", execute)
    return est


def _auditorias(banco):
    return [e for e in banco["escritas"] if len(e) == 2 and "admin_audit_events" in e[0]]


def _chaves(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _chaves(v)
    elif isinstance(o, list):
        for v in o:
            yield from _chaves(v)


GETS = ["/admin/api/me", "/admin/api/overview", "/admin/api/accounts", f"/admin/api/accounts/{ALVO}",
        "/admin/api/audit", "/admin/api/billing-events", "/admin/api/system"]
POSTS = [("plan", {"plan": "pro"}), ("suspend", {"reason": "x"}), ("reactivate", {}), ("sign-out", {}),
         ("password-reset", {}), ("unlink-whatsapp", {}), ("delete", {"confirm_email": "a@b.com"})]


# ── autorização ───────────────────────────────────────────────────────────────────────────────────────
def test_desligado_e_404_inclusive_config(cli, monkeypatch):
    monkeypatch.setenv("ADMIN_USER_IDS", "")
    monkeypatch.setenv("SERVICO", "admin")
    get_settings.cache_clear()
    for rota in GETS + ["/admin/api/config"]:
        r = cli.get(rota)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, rota


def test_sem_token_401_nao_admin_403_e_nem_toca_no_banco(cli, banco):
    cli.estado["id"] = None
    r = cli.get("/admin/api/overview")
    assert r.status_code == 401 and r.json() == {"error": "unauthorized"}
    cli.estado["id"] = OUTRO
    for rota in GETS:
        r = cli.get(rota)
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, rota
    for sufixo, corpo in POSTS:
        assert cli.post(f"/admin/api/accounts/{ALVO}/{sufixo}", json=corpo).status_code == 403
    assert banco["sql"] == [] and banco["escritas"] == []


def test_mfa_exigido_so_com_a_flag(cli, banco, monkeypatch):
    assert cli.get("/admin/api/me").json()["mfa_required"] is False
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "true")
    get_settings.cache_clear()
    r = cli.get("/admin/api/overview")
    assert r.status_code == 403 and r.json() == {"error": "mfa_required"}
    assert cli.post(f"/admin/api/accounts/{ALVO}/sign-out", json={}).status_code == 403
    cli.estado["aal"] = "aal2"
    assert cli.get("/admin/api/overview").status_code == 200
    me = cli.get("/admin/api/me").json()
    assert me["aal"] == "aal2" and me["mfa_required"] is True


def test_config_sem_auth_so_chave_publica(cli):
    cli.estado["id"] = None
    r = cli.get("/admin/api/config")
    assert r.status_code == 200
    assert r.json() == {"supabase_url": "https://x.supabase.co", "supabase_anon_key": "anon-publica",
                        "revenuecat_dashboard_url": "https://app.revenuecat.com"}
    assert r.headers["cache-control"] == "no-store"


# ── formato e LGPD ────────────────────────────────────────────────────────────────────────────────────
def test_formato_das_rotas_get(cli, banco):
    j = {rota: cli.get(rota) for rota in GETS}
    assert all(r.status_code == 200 for r in j.values())
    assert j["/admin/api/me"].json() == {"user_id": str(ADMIN), "email": "admin@x.com", "aal": "aal1",
                                         "mfa_required": False}
    o = j["/admin/api/overview"].json()
    assert set(o) == {"accounts", "access", "plans", "usage_month", "signups_by_month", "ai_cost_by_day", "signals",
                    "observability", "versions"}
    assert set(o["access"]) == {"subscriber", "trialing", "lapsed", "never", "courtesy", "suspended"}
    assert o["usage_month"]["ai_cost_usd"] == "1.50" and o["ai_cost_by_day"] == [{"day": "2026-10-01", "usd": "0.2000"}]
    assert o["signups_by_month"] == [{"month": "2026-10", "count": 3}]
    lista = j["/admin/api/accounts"].json()
    assert set(lista) == {"items", "total", "page", "page_size"} and lista["page_size"] == 25
    assert set(lista["items"][0]) == {"user_id", "workspace_id", "email", "name", "created_at", "last_sign_in_at",
                                      "suspended", "plan", "status", "access", "is_trial", "period_end", "origin",
                                      "ai_used", "ai_max", "wa_used", "wa_max", "whatsapp_linked", "last_app_version",
                                      "last_seen_at"}
    d = j[f"/admin/api/accounts/{ALVO}"].json()
    assert set(d) == {"account", "profile", "subscription", "usage", "counts", "members", "invites",
                      "billing_events", "admin_events"}
    assert set(d["usage"]) == {"current", "months"} and d["usage"]["current"]["ai_cost_usd"] == "0.5000"
    assert set(d["counts"]) == {"transactions", "accounts", "cards", "notes", "reminders", "goals", "debts",
                                "recurring"}
    assert d["subscription"]["store_managed"] is False and d["profile"]["sessions"] == 2
    assert set(d["admin_events"][0]) == {"id", "created_at", "action", "admin_user_id", "admin_email",
                                         "target_user_id", "target_email", "payload"}
    assert set(j["/admin/api/billing-events"].json()["items"][0]) == {
        "id", "created_at", "type", "provider", "result", "app_user_id", "email", "product_id", "environment"}
    s = j["/admin/api/system"].json()
    assert s["queue"] == {"pending": 1, "processing": 0, "failed_24h": 2, "oldest_pending_seconds": 30}
    assert s["ai_cost"] == {"last_24h_usd": "0.1000", "last_7d_usd": "0.7000"}
    assert s["recent_failures"][0]["last_error"] == "boom"
    for r in j.values():
        assert r.headers["cache-control"] == "no-store" and "noindex" in r.headers["x-robots-tag"]


def test_nenhuma_rota_vaza_dado_financeiro(cli, banco, monkeypatch):
    """Os dublês injetam `amount_cents`/`description` em cada linha; nenhuma resposta (GET ou ação) os carrega."""
    class Http:
        def __init__(self, **_k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *_a): ...
        async def post(self, *_a, **_k):
            return type("R", (), {"raise_for_status": lambda s: None})()

    monkeypatch.setattr(admin.httpx, "AsyncClient", Http)
    respostas = [cli.get(r) for r in GETS]
    for sufixo, corpo in POSTS[:-1]:  # `delete` devolve só {"deleted": true}
        respostas.append(cli.post(f"/admin/api/accounts/{ALVO}/{sufixo}", json=corpo))
    for r in respostas:
        assert r.status_code == 200, (r.url, r.text)
        texto = json.dumps(r.json())
        assert not (set(_chaves(r.json())) & CHAVES_PROIBIDAS), r.url
        assert not any(s in texto for s in SENTINELAS), r.url


def test_filtros_e_ordem_vao_no_sql_parametrizado(cli, banco):
    r = cli.get("/admin/api/accounts?q=a_b%25&access=trialing&plan=pro&origin=apple&sort=email_asc&page=3&page_size=10")
    assert r.status_code == 200 and r.json()["page"] == 3
    lista = [s for s in banco["sql"] if "order by lower(email)" in s][0]
    assert "limit %s offset %s" in lista and "a_b" not in lista  # termo nunca vai concatenado
    for ruim in ("sort=drop", "access=x", "plan=x", "origin=x", "page=0", "page_size=101"):
        assert cli.get(f"/admin/api/accounts?{ruim}").status_code == 422, ruim


# ── ações e auditoria ─────────────────────────────────────────────────────────────────────────────────
def test_plano_de_loja_exige_force_e_grava_plan_forced(cli, banco):
    url = f"/admin/api/accounts/{ALVO}/plan"
    banco["provider"] = "app_store"
    r = cli.post(url, json={"plan": "family"})
    assert r.status_code == 409 and r.json()["error"] == "store_managed" and r.json()["message"]
    assert _auditorias(banco) == []
    assert cli.post(url, json={"plan": "family", "force": True}).status_code == 200
    (sql, args), = _auditorias(banco)
    assert args[1] == "plan_forced" and args[0] == ADMIN and args[2] == ALVO and args[3] == WS
    assert args[4].obj["from_provider"] == "app_store" and args[4].obj["to_plan"] == "family"
    upsert = [e for e in banco["escritas"] if len(e) == 2 and "insert into public.subscriptions" in e[0]]
    assert upsert and "provider = 'manual'" in upsert[0][0]


def test_plano_manual_free_e_period_end_passado(cli, banco):
    url = f"/admin/api/accounts/{ALVO}/plan"
    ontem = (date.today() - timedelta(days=2)).isoformat()
    assert cli.post(url, json={"plan": "pro", "period_end": ontem}).status_code == 422
    assert banco["escritas"] == []
    amanha = (date.today() + timedelta(days=30)).isoformat()
    assert cli.post(url, json={"plan": "pro", "period_end": amanha}).status_code == 200
    up = [e for e in banco["escritas"] if len(e) == 2 and "insert into public.subscriptions" in e[0]][0][1]
    assert up[1:3] == ("pro", "active") and up[3] == date.fromisoformat(amanha)
    assert cli.post(url, json={"plan": "free"}).status_code == 200
    up = [e for e in banco["escritas"] if len(e) == 2 and "insert into public.subscriptions" in e[0]][1][1]
    assert up[1:3] == ("free", "canceled")
    assert [a[1][1] for a in _auditorias(banco)] == ["plan_changed", "plan_changed"]
    assert cli.post(url, json={"plan": "gold"}).status_code == 422


def test_cada_acao_grava_auditoria_na_mesma_transacao(cli, banco, monkeypatch):
    class Http:
        chamadas = []

        def __init__(self, **_k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *_a): ...
        async def post(self, url, headers, json):
            Http.chamadas.append((url, headers, json))
            return type("R", (), {"raise_for_status": lambda s: None})()

    monkeypatch.setattr(admin.httpx, "AsyncClient", Http)
    esperado = {"suspend": "suspended", "reactivate": "reactivated", "sign-out": "signed_out",
                "password-reset": "password_reset_sent", "unlink-whatsapp": "whatsapp_unlinked",
                "delete": "account_deleted"}
    for sufixo, corpo in POSTS[1:]:
        banco["escritas"].clear()
        r = cli.post(f"/admin/api/accounts/{ALVO}/{sufixo}", json=corpo)
        assert r.status_code == 200, (sufixo, r.text)
        e = banco["escritas"]
        assert e[0] == ("BEGIN",) and e[-1] == ("COMMIT",), sufixo
        (aud,) = _auditorias(banco)
        assert aud[1][1] == esperado[sufixo] and aud[1][2] == ALVO and aud[1][0] == ADMIN
        dentro = [x[0] for x in e if len(x) == 2]
        if sufixo == "suspend":
            assert "banned_until = now() + interval '100 years'" in dentro[0] and "auth.sessions" in dentro[1]
        if sufixo == "reactivate":
            assert "banned_until = null" in dentro[0]
        if sufixo == "sign-out":
            assert "delete from auth.sessions" in dentro[0]
        if sufixo == "unlink-whatsapp":
            assert "phone = null" in dentro[0] and "user_sessions" in dentro[1]
        if sufixo == "delete":
            assert "private.apagar_conta" in dentro[1] and cli.post(
                f"/admin/api/accounts/{ALVO}/delete", json={"confirm_email": "A@B.com "}).json() == {"deleted": True}
    (url, headers, corpo), = Http.chamadas
    assert url == "https://x.supabase.co/auth/v1/recover" and headers == {"apikey": "anon-publica"}
    assert corpo == {"email": "a@b.com"}


def test_delete_exige_confirm_email_e_nao_apaga_a_si_mesmo(cli, banco):
    r = cli.post(f"/admin/api/accounts/{ALVO}/delete", json={"confirm_email": "outro@x.com"})
    assert r.status_code == 409 and r.json()["error"] == "email_mismatch"
    assert cli.post(f"/admin/api/accounts/{ALVO}/delete", json={}).status_code == 422
    assert banco["escritas"] == []
    # o admin não suspende nem apaga a si mesmo
    for sufixo, corpo in (("suspend", {}), ("delete", {"confirm_email": "a@b.com"})):
        r = cli.post(f"/admin/api/accounts/{ADMIN}/{sufixo}", json=corpo)
        assert r.status_code == 409 and r.json()["error"] == "self_target"
    assert banco["escritas"] == []


def test_password_reset_com_erro_do_supabase_e_502_sem_auditoria(cli, banco, monkeypatch):
    class Quebrado:
        def __init__(self, **_k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *_a): ...
        async def post(self, *_a, **_k): raise RuntimeError("rede")

    monkeypatch.setattr(admin.httpx, "AsyncClient", Quebrado)
    r = cli.post(f"/admin/api/accounts/{ALVO}/password-reset", json={})
    assert r.status_code == 502 and r.json()["error"] == "recover_failed" and r.json()["message"]
    assert banco["escritas"] == []


def test_unlink_sem_whatsapp_e_conta_inexistente(cli, banco):
    banco["phone"] = None
    r = cli.post(f"/admin/api/accounts/{ALVO}/unlink-whatsapp", json={})
    assert r.status_code == 409 and r.json()["error"] == "not_linked"
    assert banco["escritas"] == []


def test_auditoria_filtra_e_pagina_no_servidor(cli, banco):
    r = cli.get(f"/admin/api/audit?action=suspended&target_user_id={ALVO}&page=2&page_size=10")
    assert r.status_code == 200 and r.json()["page"] == 2 and r.json()["page_size"] == 10
    sql = [s for s in banco["sql"] if "order by e.created_at desc, e.id" in s][0]
    assert "e.action = %s" in sql and "e.target_user_id = %s" in sql and "limit %s offset %s" in sql


# ── correções do E2E (D1, D3, D5, D8, 422, 429) ───────────────────────────────────────────────────────
@pytest.mark.parametrize("sinal", ["trial_ending_48h", "lapsed_7d", "near_limit", "inactive_subscribers_30d"])
def test_sinal_filtra_a_lista_com_o_mesmo_criterio_da_contagem(cli, banco, sinal):
    assert cli.get("/admin/api/overview").status_code == 200
    r = cli.get(f"/admin/api/accounts?signal={sinal}")
    assert r.status_code == 200
    crit = admin._SINAIS[sinal]
    sqls = [s for s in banco["sql"] if crit in s]
    # o MESMO texto de critério na contagem do overview e na lista (total e página)
    assert any("count(*) filter" in s for s in sqls) and sum("from base where" in s for s in sqls) >= 2


def test_sinal_desconhecido_e_422_no_formato_do_contrato(cli, banco):
    r = cli.get("/admin/api/accounts?signal=qualquer")
    assert r.status_code == 422 and r.json()["error"] == "invalid_request" and r.json()["message"]


def test_motivo_da_suspensao_aceita_300_e_recusa_301(cli, banco):
    assert cli.post(f"/admin/api/accounts/{ALVO}/suspend", json={"reason": "x" * 300}).status_code == 200
    r = cli.post(f"/admin/api/accounts/{ALVO}/suspend", json={"reason": "x" * 301})
    assert r.status_code == 422 and r.json()["error"] == "invalid_request"


def test_detalhe_devolve_a_origem_normalizada_igual_a_da_lista(cli, banco):
    banco["provider"] = "app_store"
    d = cli.get(f"/admin/api/accounts/{ALVO}").json()
    assert d["subscription"]["origin"] == "apple"
    assert admin._linha(_linha_base(provider="app_store"))["origin"] == "apple"
    banco["provider"] = None
    assert cli.get(f"/admin/api/accounts/{ALVO}").json()["subscription"]["origin"] is None


def test_password_reset_sem_email_e_409_no_email_sem_chamar_a_rede(cli, banco, monkeypatch):
    async def sem_email(sql, *a):
        return {"id": ALVO, "email": None, "phone": None, "ws": WS}

    monkeypatch.setattr(admin, "_alvo", lambda _u: sem_email("", ()))
    r = cli.post(f"/admin/api/accounts/{ALVO}/password-reset", json={})
    assert r.status_code == 409 and r.json()["error"] == "no_email" and r.json()["message"]
    assert banco["escritas"] == []


def test_429_do_painel_tem_codigo_e_frase(cli, banco, monkeypatch):
    from fastapi import HTTPException as H

    async def estoura(_req):
        raise H(status_code=429, detail="muitas requisições", headers={"Retry-After": "5"})

    monkeypatch.setattr(admin, "current_user", estoura)
    r = cli.get("/admin/api/overview")
    assert r.status_code == 429 and r.headers["retry-after"] == "5"
    assert r.json() == {"error": "rate_limited", "message": "Muitas ações seguidas; tente em alguns segundos."}
