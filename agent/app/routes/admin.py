"""Painel /admin: contas e assinaturas, servido pelo próprio agente.

Separado do app da loja (página própria, sem build). Segurança:

- Identidade = `sub` do JWT do Supabase (`current_user`), que precisa estar em `ADMIN_USER_IDS`.
  Lista vazia = painel desligado: toda rota responde 404. Nada do corpo decide quem é o admin.
- LGPD: só cadastro, plano/assinatura e CONTAGENS de uso. Cada resposta é montada campo a campo
  (nunca `**row`): lançamento, saldo, conta e nota não passam por aqui.
- Escrita (cortesia) é auditada em `billing_events` na MESMA transação. Só mexe em `provider`
  nulo ou `manual`: assinatura de loja nunca é tocada.
"""

from __future__ import annotations

import json
import secrets
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app import db
from app.auth import current_user
from app.config import get_settings

router = APIRouter(prefix="/admin", tags=["admin"])

_HTML = Path(__file__).resolve().parent.parent / "static" / "admin.html"
_MES = "(date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')"
# um dono = um espaço principal (o mais antigo); é o que o app abre e o que a assinatura vale
_PRIM = """select distinct on (owner_id) owner_id, id as ws
           from public.workspaces order by owner_id, created_at, id"""
PAGINA = 25


def _no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


def _ligado() -> None:
    if not get_settings().admin_ids:
        raise HTTPException(status_code=404, detail="not found")


async def admin_user(request: Request) -> UUID:
    _ligado()
    uid = await current_user(request)
    if uid not in get_settings().admin_ids:
        raise HTTPException(status_code=403, detail="forbidden")
    return uid


def _json(dados: dict, status: int = 200) -> JSONResponse:
    return _no_store(JSONResponse(dados, status_code=status))


@router.get("")
async def pagina(request: Request):
    """A página é estática e pública (sem dado); quem protege é a API. Desligado = 404."""
    _ligado()
    s = get_settings()
    nonce = secrets.token_urlsafe(16)
    cfg = json.dumps({"url": s.supabase_url, "anon": s.supabase_anon_key}).replace("<", "\\u003c")
    html = _HTML.read_text(encoding="utf-8").replace("__NONCE__", nonce).replace("__CONFIG__", cfg)
    resp = HTMLResponse(html)
    resp.headers["Content-Security-Policy"] = (
        f"default-src 'none'; script-src 'nonce-{nonce}' https://cdn.jsdelivr.net; "
        f"style-src 'nonce-{nonce}'; connect-src 'self' {s.supabase_url.rstrip('/')}; "
        "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    )
    resp.headers["X-Frame-Options"] = "DENY"
    return _no_store(resp)


@router.get("/api/overview")
async def overview(_admin: UUID = Depends(admin_user)):
    r = await db.fetch_one(
        f"""
        with prim as ({_PRIM}),
        c as (
          select private.effective_plan(p.ws) as ep, s.provider, coalesce(s.is_trial, false) as trial
          from prim p left join public.subscriptions s on s.workspace_id = p.ws
        )
        select
          (select count(*) from public.profiles)::int as contas,
          (select count(*) from public.profiles where created_at >= now() - interval '7 days')::int as novas_7d,
          (select count(*) from public.profiles where created_at >= now() - interval '30 days')::int as novas_30d,
          count(*) filter (where ep = 'pro' and not trial and provider is distinct from 'manual')::int as pro,
          count(*) filter (where ep = 'family' and not trial and provider is distinct from 'manual')::int as familia,
          count(*) filter (where ep <> 'free' and trial and provider is distinct from 'manual')::int as em_teste,
          count(*) filter (where ep <> 'free' and provider = 'manual')::int as cortesia,
          count(*) filter (where ep = 'free' and provider is not null)::int as encerradas,
          count(*) filter (where ep = 'free' and provider is null)::int as nunca,
          (select count(*) from public.ai_events where kind = 'turn' and created_at >= {_MES})::int as turnos_ia_mes,
          (select count(*) from public.whatsapp_sends where kind = 'reply' and created_at >= {_MES})::int as respostas_mes,
          (select count(*) from public.whatsapp_sends where kind = 'notice' and created_at >= {_MES})::int as avisos_mes,
          (select coalesce(sum(estimated_cost_usd), 0) from public.ai_events where created_at >= {_MES})::float as custo_ia_usd_mes
        from c
        """
    ) or {}
    chaves = ("contas", "novas_7d", "novas_30d", "pro", "familia", "em_teste", "cortesia",
              "encerradas", "nunca", "turnos_ia_mes", "respostas_mes", "avisos_mes", "custo_ia_usd_mes")
    return _json({k: r.get(k, 0) for k in chaves})


@router.get("/api/accounts")
async def accounts(
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1, le=100_000),
    _admin: UUID = Depends(admin_user),
):
    termo = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    filtro = "%" + termo + "%" if termo else None
    total = await db.fetch_one(
        """select count(*)::int as n from public.profiles p join auth.users u on u.id = p.id
           where (%s::text is null or u.email ilike %s::text)""",
        filtro, filtro,
    )
    linhas = await db.fetch(
        f"""
        with prim as ({_PRIM})
        select p.id, u.email, p.display_name, p.created_at, u.last_sign_in_at, ps.*
        from public.profiles p
        join auth.users u on u.id = p.id
        left join prim on prim.owner_id = p.id
        left join lateral private.plan_status_for(prim.ws) ps on true
        where (%s::text is null or u.email ilike %s::text)
        order by p.created_at desc, p.id
        limit %s offset %s
        """,
        filtro, filtro, PAGINA, (page - 1) * PAGINA,
    )

    def conta(r: dict) -> dict:
        return {
            "user_id": str(r["id"]),
            "email": r["email"],
            "nome": r["display_name"],
            "criada_em": r["created_at"].isoformat() if r["created_at"] else None,
            "ultimo_acesso": r["last_sign_in_at"].isoformat() if r["last_sign_in_at"] else None,
            "plano": r.get("plan"),
            "status": r.get("status"),
            "acesso": r.get("access"),
            "teste": bool(r.get("is_trial")),
            "ate": r["current_period_end"].isoformat() if r.get("current_period_end") else None,
            "origem": r.get("provider"),
            "turnos_ia": r.get("ai_messages_month"),
            "limite_ia": r.get("max_ai_messages_month"),
            "respostas_whatsapp": r.get("whatsapp_replies_month"),
            "limite_whatsapp": r.get("max_whatsapp_replies_month"),
        }

    return _json({"total": (total or {}).get("n", 0), "pagina": page, "por_pagina": PAGINA,
                  "contas": [conta(r) for r in linhas]})


class Alvo(BaseModel):
    user_id: UUID


class Cortesia(Alvo):
    plan: str


async def _espaco_do(user_id: UUID) -> UUID:
    r = await db.fetch_one(
        "select id from public.workspaces where owner_id = %s order by created_at, id limit 1", user_id
    )
    if r is None:
        raise HTTPException(status_code=404, detail="conta sem espaço")
    return r["id"]


async def _auditar(admin: UUID, tipo: str, ws: UUID, alvo: UUID, extra: dict) -> None:
    await db.execute(
        """insert into public.billing_events (id, type, provider, workspace_id, result, payload)
           values (%s, %s, 'manual', %s, 'ok', %s)""",
        f"admin:{uuid4()}", tipo, ws,
        Jsonb({"admin_id": str(admin), "user_id": str(alvo), "workspace_id": str(ws), **extra}),
    )


@router.post("/api/courtesy/grant")
async def dar_cortesia(body: Cortesia, admin: UUID = Depends(admin_user)):
    if body.plan not in ("pro", "family"):
        raise HTTPException(status_code=400, detail="plano tem que ser pro ou family")
    ws = await _espaco_do(body.user_id)
    async with db.unidade_de_trabalho():
        # só cria/atualiza se não há assinatura de loja: a cláusula `where` do conflito segura
        r = await db.fetch_one(
            """insert into public.subscriptions (workspace_id, plan, status, provider, is_trial,
                                                 current_period_end, canceled_at)
               values (%s, %s, 'active', 'manual', false, null, null)
               on conflict (workspace_id) do update
                 set plan = excluded.plan, status = 'active', provider = 'manual', is_trial = false,
                     current_period_end = null, canceled_at = null
                 where public.subscriptions.provider is null or public.subscriptions.provider = 'manual'
               returning workspace_id""",
            ws, body.plan,
        )
        if r is None:
            raise HTTPException(status_code=409, detail="a conta tem assinatura de loja; não mexo nela")
        await _auditar(admin, "ADMIN_COURTESY_GRANT", ws, body.user_id, {"plan": body.plan})
    return _json({"ok": True})


@router.post("/api/courtesy/revoke")
async def tirar_cortesia(body: Alvo, admin: UUID = Depends(admin_user)):
    ws = await _espaco_do(body.user_id)
    async with db.unidade_de_trabalho():
        r = await db.fetch_one(
            """update public.subscriptions
               set plan = 'free', status = 'canceled', canceled_at = now()
               where workspace_id = %s and provider = 'manual' and plan <> 'free'
               returning workspace_id""",
            ws,
        )
        if r is None:
            raise HTTPException(status_code=409, detail="a conta não tem cortesia ativa")
        await _auditar(admin, "ADMIN_COURTESY_REVOKE", ws, body.user_id, {})
    return _json({"ok": True})
