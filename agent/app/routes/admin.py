"""API do painel /admin (contrato: docs/ADMIN-API.md). O SPA é servido por `admin_web`.

Segurança:

- Só existe no serviço `SERVICO=admin` (Cloud Run próprio, IAP na frente, asserção do IAP conferida
  em `main._fronteira`); no agente público toda rota responde 404.
- Identidade = `sub` do JWT do Supabase (`current_user`), que precisa estar em `ADMIN_USER_IDS`.
  Lista vazia = painel desligado: toda rota responde 404. Nada do corpo decide quem é o admin.
  `ADMIN_REQUIRE_MFA=true` exige `aal: "aal2"` no JWT.
- LGPD: só cadastro, assinatura, uso e CONTAGENS. Cada resposta é montada campo a campo
  (nunca `**row`): lançamento, saldo, nota e lembrete não passam por aqui.
- Toda escrita grava `admin_audit_events` na MESMA transação da mudança.
- Filtro, ordenação e paginação no SQL (parametrizado; `sort` por allowlist).
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import db
from app.auth import current_user, decode_token
from app.config import get_settings
from app.services import push

log = logging.getLogger(__name__)

_FUSO = ZoneInfo("America/Sao_Paulo")
_MES = "(date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')"
# um dono = um espaço principal (o mais antigo); é o que o app abre e o que a assinatura vale
_PRIM = """select distinct on (owner_id) owner_id, id as ws
           from public.workspaces order by owner_id, created_at, id"""
# uma linha por conta, com o plano que o app enxerga (plan_status_for) — base de lista, detalhe e visão geral
# ponytail: plan_status_for roda por conta antes dos filtros; com milhares de contas, materializar.
_BASE = f"""
prim as ({_PRIM}),
base as (
  select p.id as user_id, prim.ws as workspace_id, u.email::text as email, p.display_name as name,
         p.created_at, u.last_sign_in_at, coalesce(u.banned_until > now(), false) as suspended,
         (p.phone is not null) as whatsapp_linked, p.phone, p.last_app_version, p.last_seen_at,
         (p.marketing_opt_out_at is null) as contact_ok,
         coalesce(ps.plan, 'free') as plan, coalesce(ps.status, 'active') as status,
         coalesce(ps.access, 'never') as access, coalesce(ps.is_trial, false) as is_trial,
         ps.current_period_end as period_end, ps.provider,
         coalesce(ps.ai_messages_month, 0) as ai_used, coalesce(ps.max_ai_messages_month, 0) as ai_max,
         coalesce(ps.whatsapp_replies_month, 0) as wa_used, coalesce(ps.max_whatsapp_replies_month, 0) as wa_max,
         coalesce(ps.whatsapp_notices_today, 0) as notices_today,
         coalesce(ps.max_whatsapp_notices_day, 0) as notices_max
  from public.profiles p
  join auth.users u on u.id = p.id
  left join prim on prim.owner_id = p.id
  left join lateral private.plan_status_for(prim.ws) ps on true
)"""
_ASSINANTE = "access = 'subscriber' and not is_trial and provider is distinct from 'manual'"
_TESTE = "access = 'subscriber' and is_trial and provider is distinct from 'manual'"
_CORTESIA = "access = 'subscriber' and provider = 'manual'"
_ACESSO = {
    "subscriber": _ASSINANTE, "trialing": _TESTE, "courtesy": _CORTESIA,
    "lapsed": "access = 'lapsed'", "never": "access = 'never'", "suspended": "suspended",
}
# Sinais da Visão geral: UM critério, usado pela contagem (overview) e pela lista (`/accounts?signal=`).
_SINAIS = {
    "trial_ending_48h": """access = 'subscriber' and is_trial and period_end is not null
        and period_end between (now() at time zone 'America/Sao_Paulo')::date
                           and (now() at time zone 'America/Sao_Paulo')::date + 2""",
    "lapsed_7d": """exists (select 1 from public.subscriptions s where s.workspace_id = base.workspace_id
        and private.effective_plan(base.workspace_id) = 'free' and s.provider is not null
        and coalesce(s.canceled_at, s.updated_at) >= now() - interval '7 days')""",
    "near_limit": """access = 'subscriber' and ((ai_max > 0 and ai_used >= 0.8 * ai_max)
        or (wa_max > 0 and wa_used >= 0.8 * wa_max))""",
    "inactive_subscribers_30d": """access = 'subscriber'
        and (coalesce(last_seen_at, last_sign_in_at) is null
             or coalesce(last_seen_at, last_sign_in_at) < now() - interval '30 days')""",
}
_ORIGEM_SQL = {"apple": "app_store", "google": "play_store", "manual": "manual", "test_store": "test_store"}
_ORIGEM_API = {v: k for k, v in _ORIGEM_SQL.items()}
_ORDEM = {
    "created_desc": "created_at desc, user_id",
    "created_asc": "created_at, user_id",
    "last_sign_in_desc": "last_sign_in_at desc nulls last, user_id",
    "last_sign_in_asc": "last_sign_in_at nulls first, user_id",
    "ai_used_desc": "ai_used desc, user_id",
    "email_asc": "lower(email), user_id",
    "last_seen_desc": "last_seen_at desc nulls last, user_id",
    "last_seen_asc": "last_seen_at nulls first, user_id",
}


# ── infraestrutura: erros no formato do contrato, headers, autorização ────────────────────────────────
def _no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


class _Rota(APIRoute):
    """Erro vira `{"error": codigo[, "message": frase]}` e toda resposta da API sai no-store."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                return _no_store(await original(request))
            except RequestValidationError:
                return _no_store(JSONResponse({"error": "invalid_request", "message": "Esse pedido não está no formato esperado."},
                                              status_code=422))
            except HTTPException as e:
                if e.status_code == 401:
                    corpo = {"error": "unauthorized"}
                elif e.status_code == 429:
                    corpo = {"error": "rate_limited", "message": "Muitas ações seguidas; tente em alguns segundos."}
                elif isinstance(e.detail, dict):
                    corpo = e.detail
                else:
                    corpo = {"error": str(e.detail)}
                resp = JSONResponse(corpo, status_code=e.status_code, headers=e.headers)
                return _no_store(resp)

        return handler


router = APIRouter(prefix="/admin/api", tags=["admin"], route_class=_Rota)


def _erro(status: int, codigo: str, mensagem: str | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"error": codigo, **({"message": mensagem} if mensagem else {})})


def _ligado() -> None:
    s = get_settings()
    if s.servico != "admin" or not s.admin_ids:
        raise _erro(404, "not_found")


async def _claims(request: Request) -> dict:
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    try:
        return await asyncio.to_thread(decode_token, token)
    except Exception as err:  # noqa: BLE001 — já validado por current_user; aqui só lemos o aal
        raise _erro(401, "unauthorized") from err


async def admin_user(request: Request) -> UUID:
    _ligado()
    uid = await current_user(request)
    s = get_settings()
    if uid not in s.admin_ids:
        raise _erro(403, "forbidden")
    aal = (await _claims(request)).get("aal") or "aal1"
    request.state.aal = aal
    if s.admin_require_mfa and aal != "aal2":
        raise _erro(403, "mfa_required")
    return uid


def _json(dados, status: int = 200) -> JSONResponse:
    return JSONResponse(dados, status_code=status)


def _iso(v) -> str | None:
    return v.isoformat() if v is not None else None


def _usd(v, casas: int = 4) -> str:
    return f"{Decimal(v or 0):.{casas}f}"


def _pagina(page: int, page_size: int) -> tuple[int, int]:
    return page_size, (page - 1) * page_size


# ── rotas sem conta ───────────────────────────────────────────────────────────────────────────────────
@router.get("/config")
async def config():
    _ligado()
    s = get_settings()
    return _json({"supabase_url": s.supabase_url, "supabase_anon_key": s.supabase_anon_key,
                  "revenuecat_dashboard_url": "https://app.revenuecat.com"})


@router.get("/me")
async def me(request: Request, admin: UUID = Depends(admin_user)):
    r = await db.fetch_one("select email::text as email from auth.users where id = %s", admin)
    return _json({"user_id": str(admin), "email": (r or {}).get("email") or "",
                  "aal": request.state.aal, "mfa_required": get_settings().admin_require_mfa})


@router.get("/overview")
async def overview(_admin: UUID = Depends(admin_user)):
    r = await db.fetch_one(
        f"""
        with {_BASE}
        select
          count(*)::int as total,
          count(*) filter (where created_at >= now() - interval '7 days')::int as new_7d,
          count(*) filter (where created_at >= now() - interval '30 days')::int as new_30d,
          count(*) filter (where {_ASSINANTE})::int as subscriber,
          count(*) filter (where {_TESTE})::int as trialing,
          count(*) filter (where access = 'lapsed')::int as lapsed,
          count(*) filter (where access = 'never')::int as never,
          count(*) filter (where {_CORTESIA})::int as courtesy,
          count(*) filter (where suspended)::int as suspended,
          count(*) filter (where plan = 'pro')::int as pro,
          count(*) filter (where plan = 'family')::int as family,
          count(*) filter (where {_SINAIS['trial_ending_48h']})::int as trial_ending_48h,
          count(*) filter (where {_SINAIS['near_limit']})::int as near_limit,
          count(*) filter (where {_SINAIS['inactive_subscribers_30d']})::int as inactive_subscribers_30d,
          count(*) filter (where {_SINAIS['lapsed_7d']})::int as lapsed_7d,
          (select count(*) from public.ai_events where kind = 'turn' and created_at >= {_MES})::int as ai_turns,
          (select count(*) from public.whatsapp_sends where kind = 'reply' and created_at >= {_MES})::int as replies,
          (select count(*) from public.whatsapp_sends where kind = 'notice' and created_at >= {_MES})::int as notices,
          (select coalesce(sum(estimated_cost_usd), 0) from public.ai_events where created_at >= {_MES}) as cost
        from base
        """
    ) or {}
    n = lambda k: int(r.get(k) or 0)  # noqa: E731
    obs = await db.fetch_one(
        """select (select count(*) from public.error_issues where status = 'open')::int as open,
                  (select count(*) from public.error_events where created_at >= now() - interval '24 hours')::int as ev,
                  (select count(*) from public.error_issues where status = 'open' and severity = 'critical')::int as crit"""
    ) or {}
    versoes = await db.fetch(
        """select last_app_platform as platform, last_app_version as version, count(*)::int as users
           from public.profiles
           where last_seen_at >= now() - interval '30 days' and last_app_version is not null
           group by 1, 2 order by 3 desc, 1, 2"""
    )
    meses = await db.fetch(
        """
        select to_char(m, 'YYYY-MM') as month,
               (select count(*) from public.profiles p
                 where date_trunc('month', p.created_at at time zone 'America/Sao_Paulo') = m)::int as n
        from generate_series(date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '11 months',
                             date_trunc('month', now() at time zone 'America/Sao_Paulo'), interval '1 month') m
        order by m
        """
    )
    dias = await db.fetch(
        """
        select to_char(d, 'YYYY-MM-DD') as day,
               (select coalesce(sum(e.estimated_cost_usd), 0) from public.ai_events e
                 where (e.created_at at time zone 'America/Sao_Paulo')::date = d::date) as usd
        from generate_series((now() at time zone 'America/Sao_Paulo')::date - 29,
                             (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') d
        order by d
        """
    )
    return _json({
        "accounts": {"total": n("total"), "new_7d": n("new_7d"), "new_30d": n("new_30d")},
        "access": {k: n(k) for k in ("subscriber", "trialing", "lapsed", "never", "courtesy", "suspended")},
        "plans": {"pro": n("pro"), "family": n("family")},
        "usage_month": {"ai_turns": n("ai_turns"), "whatsapp_replies": n("replies"),
                        "notices": n("notices"), "ai_cost_usd": _usd(r.get("cost"), 2)},
        "signups_by_month": [{"month": m["month"], "count": m["n"]} for m in meses],
        "ai_cost_by_day": [{"day": d["day"], "usd": _usd(d["usd"])} for d in dias],
        "signals": {k: n(k) for k in ("trial_ending_48h", "lapsed_7d", "near_limit", "inactive_subscribers_30d")},
        "observability": {"open": obs.get("open", 0), "events_24h": obs.get("ev", 0),
                          "critical_open": obs.get("crit", 0)},
        "versions": [{"platform": v["platform"], "version": v["version"], "users": v["users"]} for v in versoes],
    })


# ── contas ────────────────────────────────────────────────────────────────────────────────────────────
def _linha(r: dict) -> dict:
    prov = r.get("provider")
    return {
        "user_id": str(r["user_id"]),
        "workspace_id": str(r["workspace_id"]) if r.get("workspace_id") else None,
        "email": r["email"], "name": r.get("name"),
        "created_at": _iso(r.get("created_at")), "last_sign_in_at": _iso(r.get("last_sign_in_at")),
        "suspended": bool(r.get("suspended")),
        "plan": r.get("plan") or "free", "status": r.get("status") or "active",
        "access": r.get("access") or "never", "is_trial": bool(r.get("is_trial")),
        "period_end": _iso(r.get("period_end")),
        "origin": _ORIGEM_API.get(prov, prov) if prov else None,
        "ai_used": r.get("ai_used") or 0, "ai_max": r.get("ai_max") or 0,
        "wa_used": r.get("wa_used") or 0, "wa_max": r.get("wa_max") or 0,
        "whatsapp_linked": bool(r.get("whatsapp_linked")),
        # aceita novidades e ofertas (Política §2-A); quem pediu para sair fica de fora de toda campanha
        "contact_ok": r.get("contact_ok") is not False,
        "last_app_version": r.get("last_app_version"), "last_seen_at": _iso(r.get("last_seen_at")),
    }


def _like(q: str) -> str:
    return "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


Acesso = Literal["subscriber", "trialing", "lapsed", "never", "courtesy", "suspended"]
Plano = Literal["free", "pro", "family"]
Origem = Literal["apple", "google", "manual", "test_store", "none"]
Sinal = Literal["trial_ending_48h", "lapsed_7d", "near_limit", "inactive_subscribers_30d"]
Ordem = Literal["created_desc", "created_asc", "last_sign_in_desc", "last_sign_in_asc", "ai_used_desc", "email_asc",
                "last_seen_desc", "last_seen_asc"]


def _filtro(q: str, access, plan, origin, signal) -> tuple[str, list]:
    """O WHERE da lista e do CSV: um critério só, para os dois nunca divergirem."""
    onde, args = ["true"], []
    if q.strip():
        busca, args = "email ilike %s or name ilike %s", [_like(q)] * 2
        # com 4+ dígitos em `q`, procura também no telefone (só os dígitos dele, qualquer formatação)
        digitos = re.sub(r"\D", "", q)
        if len(digitos) >= 4:
            busca += " or regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like %s"
            args.append(f"%{digitos}%")
        onde.append(f"({busca})")
    if access:
        onde.append(f"({_ACESSO[access]})")
    if signal:
        onde.append(f"({_SINAIS[signal]})")
    if plan:
        onde.append("plan = %s")
        args.append(plan)
    if origin == "none":
        onde.append("provider is null")
    elif origin:
        onde.append("provider = %s")
        args.append(_ORIGEM_SQL[origin])
    return " and ".join(onde), args


@router.get("/accounts")
async def accounts(
    q: str = Query("", max_length=100),
    access: Acesso | None = None,
    plan: Plano | None = None,
    origin: Origem | None = None,
    signal: Sinal | None = None,
    sort: Ordem = "created_desc",
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(25, ge=1, le=100),
    _admin: UUID = Depends(admin_user),
):
    filtro, args = _filtro(q, access, plan, origin, signal)
    total = await db.fetch_one(f"with {_BASE} select count(*)::int as n from base where {filtro}", *args)
    limite, desloc = _pagina(page, page_size)
    linhas = await db.fetch(
        f"with {_BASE} select * from base where {filtro} order by {_ORDEM[sort]} limit %s offset %s",
        *args, limite, desloc,
    )
    return _json({"items": [_linha(r) for r in linhas], "total": (total or {}).get("n", 0),
                  "page": page, "page_size": page_size})


CSV_TETO = 10_000
_CSV_COLUNAS = ("user_id", "email", "name", "created_at", "last_sign_in_at", "last_seen_at", "last_app_version",
                "plan", "status", "access", "is_trial", "period_end", "origin", "ai_used", "ai_max", "wa_used",
                "wa_max", "whatsapp_linked", "suspended", "contact_ok")


def _celula(v) -> str:
    """Valor de CSV; texto que começa com `= + - @` ganha `'` (a planilha não executa como fórmula)."""
    t = "" if v is None else str(v).lower() if isinstance(v, bool) else str(v)
    return "'" + t if t[:1] in ("=", "+", "-", "@", "\t", "\r") else t


@router.get("/accounts.csv")
async def accounts_csv(
    q: str = Query("", max_length=100),
    access: Acesso | None = None,
    plan: Plano | None = None,
    origin: Origem | None = None,
    signal: Sinal | None = None,
    sort: Ordem = "created_desc",
    admin: UUID = Depends(admin_user),
):
    filtro, args = _filtro(q, access, plan, origin, signal)
    total = (await db.fetch_one(f"with {_BASE} select count(*)::int as n from base where {filtro}", *args) or {}).get("n", 0)
    if total > CSV_TETO:
        raise _erro(422, "too_many_rows", f"São {total} contas; o teto do CSV é {CSV_TETO}. Refine os filtros.")
    linhas = await db.fetch(f"with {_BASE} select * from base where {filtro} order by {_ORDEM[sort]}", *args)
    saida = io.StringIO()
    escritor = csv.writer(saida, lineterminator="\r\n")
    escritor.writerow(_CSV_COLUNAS)
    for r in linhas:
        linha = _linha(r)
        escritor.writerow([_celula(linha[c]) for c in _CSV_COLUNAS])
    filtros = {k: v for k, v in {"q": q.strip() or None, "access": access, "plan": plan, "origin": origin,
                                 "signal": signal, "sort": sort}.items() if v is not None}
    async with db.unidade_de_trabalho():
        await _auditar(admin, "accounts_exported", None, {"filters": filtros, "total": len(linhas)})
    nome = f"contas-{datetime.now(_FUSO).date().isoformat()}.csv"
    return Response(content=("\ufeff" + saida.getvalue()).encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


def _evento(r: dict) -> dict:  # forma única de AuditEvent
    return {
        "id": str(r["id"]), "created_at": _iso(r["created_at"]), "action": r["action"],
        "admin_user_id": str(r["admin_user_id"]), "admin_email": r.get("admin_email"),
        "target_user_id": str(r["target_user_id"]) if r.get("target_user_id") else None,
        "target_email": r.get("target_email"), "payload": r.get("payload") or {},
    }


_EVENTOS = """
select e.id, e.created_at, e.action, e.admin_user_id, a.email::text as admin_email,
       e.target_user_id, t.email::text as target_email, e.payload
from public.admin_audit_events e
left join auth.users a on a.id = e.admin_user_id
left join auth.users t on t.id = e.target_user_id
"""


async def _detalhe(user_id: UUID) -> dict:
    acc = await db.fetch_one(f"with {_BASE} select * from base where user_id = %s", user_id)
    if acc is None:
        raise _erro(404, "not_found")
    ws = acc.get("workspace_id")
    u = await db.fetch_one(
        """select p.phone, u.email_confirmed_at, u.banned_until,
                  coalesce(u.raw_user_meta_data->>'onboarding_completed', 'false') = 'true' as onboarding,
                  (select count(*) from auth.sessions s where s.user_id = u.id)::int as sessoes,
                  p.terms_version, p.terms_accepted_at, p.ai_consent_at, p.marketing_opt_out_at, p.last_app_version,
                  p.last_app_platform, p.last_seen_at, (p.expo_push_token is not null)::int as push_tokens,
                  (select count(*) from public.admin_account_notes n where n.user_id = p.id)::int as notes_count
           from public.profiles p join auth.users u on u.id = p.id where p.id = %s""",
        user_id,
    ) or {}
    sub = (await db.fetch_one(
        """select plan, status, provider, external_id, product_id, environment, is_trial,
                  current_period_end, canceled_at
           from public.subscriptions where workspace_id = %s""", ws,
    ) if ws else None) or {}
    prov = sub.get("provider")
    custo = (await db.fetch_one(
        f"select coalesce(sum(estimated_cost_usd), 0) as c from public.ai_events where workspace_id = %s and created_at >= {_MES}",
        ws,
    ) if ws else None) or {}
    meses = (await db.fetch(
        """
        select to_char(m, 'YYYY-MM') as month,
          (select count(*) from public.ai_events e where e.workspace_id = %s and e.kind = 'turn'
             and date_trunc('month', e.created_at at time zone 'America/Sao_Paulo') = m)::int as ai_turns,
          (select count(*) from public.whatsapp_sends s where s.workspace_id = %s and s.kind = 'reply'
             and date_trunc('month', s.created_at at time zone 'America/Sao_Paulo') = m)::int as replies,
          (select coalesce(sum(e.estimated_cost_usd), 0) from public.ai_events e where e.workspace_id = %s
             and date_trunc('month', e.created_at at time zone 'America/Sao_Paulo') = m) as cost
        from generate_series(date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '5 months',
                             date_trunc('month', now() at time zone 'America/Sao_Paulo'), interval '1 month') m
        order by m desc
        """, ws, ws, ws,
    ) if ws else [])
    c = (await db.fetch_one(
        """select
          (select count(*) from public.transactions where workspace_id = %s)::int as transactions,
          (select count(*) from public.accounts where workspace_id = %s and type <> 'credit_card')::int as accounts,
          (select count(*) from public.accounts where workspace_id = %s and type = 'credit_card')::int as cards,
          (select count(*) from public.notes where workspace_id = %s)::int as notes,
          (select count(*) from public.reminders where workspace_id = %s)::int as reminders,
          (select count(*) from public.goals where workspace_id = %s)::int as goals,
          (select count(*) from public.debts where workspace_id = %s)::int as debts,
          (select count(*) from public.recurring_transactions where workspace_id = %s)::int as recurring""",
        *([ws] * 8),
    ) if ws else None) or {}
    membros = (await db.fetch(
        """select m.user_id, u.email::text as email, p.display_name, m.role
           from public.workspace_members m
           join auth.users u on u.id = m.user_id
           left join public.profiles p on p.id = m.user_id
           where m.workspace_id = %s order by m.created_at, m.user_id""", ws,
    ) if ws else [])
    convites = (await db.fetch(
        "select id, phone, status, created_at from public.workspace_invites where workspace_id = %s order by created_at desc",
        ws,
    ) if ws else [])
    cobrancas = await db.fetch(
        """select id, type, result, received_at from public.billing_events
           where workspace_id = %s or payload->>'app_user_id' = %s or payload->>'user_id' = %s
           order by received_at desc limit 50""",
        ws, str(user_id), str(user_id),
    )
    eventos = await db.fetch(
        _EVENTOS + " where e.target_user_id = %s order by e.created_at desc limit 50", user_id
    )
    return {
        "account": _linha(acc),
        "profile": {"phone": u.get("phone"), "email_confirmed_at": _iso(u.get("email_confirmed_at")),
                    "onboarding_completed": bool(u.get("onboarding")),
                    "banned_until": _iso(u.get("banned_until")), "sessions": u.get("sessoes") or 0,
                    "terms_version": u.get("terms_version"), "terms_accepted_at": _iso(u.get("terms_accepted_at")),
                    "ai_consent_at": _iso(u.get("ai_consent_at")),
                    "marketing_opt_out_at": _iso(u.get("marketing_opt_out_at")),
                    "last_app_version": u.get("last_app_version"),
                    "last_app_platform": u.get("last_app_platform"), "last_seen_at": _iso(u.get("last_seen_at")),
                    "push_tokens": u.get("push_tokens") or 0, "notes_count": u.get("notes_count") or 0},
        "subscription": {
            "plan": sub.get("plan") or "free", "status": sub.get("status") or "active",
            "provider": prov or "", "origin": _ORIGEM_API.get(prov, prov) if prov else None,
            "external_id": sub.get("external_id") or "",
            "product_id": sub.get("product_id") or "", "environment": sub.get("environment") or "",
            "is_trial": bool(sub.get("is_trial")), "current_period_end": _iso(sub.get("current_period_end")),
            "canceled_at": _iso(sub.get("canceled_at")),
            "store_managed": prov is not None and prov != "manual",
        },
        "usage": {
            "current": {"ai_used": acc["ai_used"], "ai_max": acc["ai_max"], "wa_used": acc["wa_used"],
                        "wa_max": acc["wa_max"], "notices_today": acc["notices_today"],
                        "notices_max": acc["notices_max"], "ai_cost_usd": _usd(custo.get("c"))},
            "months": [{"month": m["month"], "ai_turns": m["ai_turns"], "whatsapp_replies": m["replies"],
                        "ai_cost_usd": _usd(m["cost"])} for m in meses],
        },
        "counts": {k: int(c.get(k) or 0) for k in
                   ("transactions", "accounts", "cards", "notes", "reminders", "goals", "debts", "recurring")},
        "members": [{"user_id": str(m["user_id"]), "email": m["email"], "name": m.get("display_name"),
                     "role": "owner" if m["role"] == "owner" else "member"} for m in membros],
        "invites": [{"id": str(i["id"]), "phone": i["phone"], "status": i["status"], "created_at": _iso(i["created_at"])}
                    for i in convites],
        "billing_events": [{"id": b["id"], "type": b.get("type") or "", "result": b.get("result") or "",
                            "created_at": _iso(b["received_at"])} for b in cobrancas],
        "admin_events": [_evento(e) for e in eventos],
    }


@router.get("/accounts/{user_id}")
async def conta(user_id: UUID, _admin: UUID = Depends(admin_user)):
    return _json(await _detalhe(user_id))


# ── ações ─────────────────────────────────────────────────────────────────────────────────────────────
async def _alvo(user_id: UUID) -> dict:
    r = await db.fetch_one(
        """select p.id, u.email::text as email, p.phone, p.expo_push_token,
                  (select id from public.workspaces w where w.owner_id = p.id order by w.created_at, w.id limit 1) as ws
           from public.profiles p join auth.users u on u.id = p.id where p.id = %s""",
        user_id,
    )
    if r is None:
        raise _erro(404, "not_found")
    return r


async def _auditar(admin: UUID, acao: str, alvo: dict | None, extra: dict | None = None) -> None:
    """`alvo` None = ação sem conta (exportar a lista, configuração do app)."""
    alvo = alvo or {}
    await db.execute(
        """insert into public.admin_audit_events (admin_user_id, action, target_user_id, target_workspace_id, payload)
           values (%s, %s, %s, %s, %s)""",
        admin, acao, alvo.get("id"), alvo.get("ws"), Jsonb(extra or {}),
    )


def _nao_a_si_mesmo(admin: UUID, user_id: UUID) -> None:
    if admin == user_id:
        raise _erro(409, "self_target", "Você não pode fazer isso na sua própria conta.")


class PlanoIn(BaseModel):
    plan: Literal["free", "pro", "family"]
    period_end: date | None = None
    force: bool = False


@router.post("/accounts/{user_id}/plan")
async def mudar_plano(user_id: UUID, body: PlanoIn, admin: UUID = Depends(admin_user)):
    if body.period_end is not None and body.period_end < datetime.now(_FUSO).date():
        raise _erro(422, "period_end_past", "A data de fim já passou.")
    alvo = await _alvo(user_id)
    if not alvo["ws"]:
        raise _erro(409, "no_workspace", "A conta não tem espaço criado.")
    async with db.unidade_de_trabalho():
        atual = await db.fetch_one(
            "select plan, provider from public.subscriptions where workspace_id = %s for update", alvo["ws"]
        ) or {}
        loja = atual.get("provider") not in (None, "manual")
        if loja and not body.force:
            raise _erro(409, "store_managed",
                        "A assinatura é gerida pela loja. Mudar aqui vale até a próxima notificação dela.")
        livre = body.plan == "free"
        await db.execute(
            """insert into public.subscriptions (workspace_id, plan, status, provider, is_trial,
                                                 current_period_end, canceled_at)
               values (%s, %s, %s, 'manual', false, %s, case when %s then now() end)
               on conflict (workspace_id) do update
                 set plan = excluded.plan, status = excluded.status, provider = 'manual', is_trial = false,
                     current_period_end = excluded.current_period_end, canceled_at = excluded.canceled_at""",
            alvo["ws"], body.plan, "canceled" if livre else "active",
            None if livre else body.period_end, livre,
        )
        await _auditar(admin, "plan_forced" if loja else "plan_changed", alvo, {
            "from_plan": atual.get("plan"), "from_provider": atual.get("provider"), "to_plan": body.plan,
            "period_end": _iso(body.period_end),
        })
    return _json(await _detalhe(user_id))


MOTIVO_MAX = 300  # o mesmo número na UI (account-actions.tsx)


class SuspenderIn(BaseModel):
    reason: str = Field("", max_length=MOTIVO_MAX)


@router.post("/accounts/{user_id}/suspend")
async def suspender(user_id: UUID, body: SuspenderIn, admin: UUID = Depends(admin_user)):
    _nao_a_si_mesmo(admin, user_id)
    alvo = await _alvo(user_id)
    async with db.unidade_de_trabalho():
        await db.execute("update auth.users set banned_until = now() + interval '100 years' where id = %s", user_id)
        await db.execute("delete from auth.sessions where user_id = %s", user_id)
        await _auditar(admin, "suspended", alvo, {"reason": body.reason})
    return _json(await _detalhe(user_id))


@router.post("/accounts/{user_id}/reactivate")
async def reativar(user_id: UUID, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    async with db.unidade_de_trabalho():
        await db.execute("update auth.users set banned_until = null where id = %s", user_id)
        await _auditar(admin, "reactivated", alvo)
    return _json(await _detalhe(user_id))


@router.post("/accounts/{user_id}/sign-out")
async def sair(user_id: UUID, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    async with db.unidade_de_trabalho():
        await db.execute("delete from auth.sessions where user_id = %s", user_id)
        await _auditar(admin, "signed_out", alvo)
    return _json(await _detalhe(user_id))


@router.post("/accounts/{user_id}/password-reset")
async def redefinir_senha(user_id: UUID, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    if not alvo.get("email"):
        raise _erro(409, "no_email", "A conta não tem e-mail cadastrado, então não há para onde enviar o código.")
    s = get_settings()
    # rede FORA da transação (segura lock); só audita se o Supabase aceitou o envio
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.post(f"{s.supabase_url.rstrip('/')}/auth/v1/recover",
                                headers={"apikey": s.supabase_anon_key}, json={"email": alvo["email"]})
        r.raise_for_status()
    except Exception as err:  # noqa: BLE001
        resp = getattr(err, "response", None)
        log.warning("password-reset admin falhou: %s %s", type(err).__name__,
                    f"{resp.status_code} {resp.text[:200]}" if resp is not None else "")
        raise _erro(502, "recover_failed", "Não consegui enviar o código de recuperação. Tente de novo.") from err
    async with db.unidade_de_trabalho():
        await _auditar(admin, "password_reset_sent", alvo)
    return _json(await _detalhe(user_id))


@router.post("/accounts/{user_id}/unlink-whatsapp")
async def desvincular(user_id: UUID, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    if not alvo.get("phone"):
        raise _erro(409, "not_linked", "A conta não tem WhatsApp vinculado.")
    async with db.unidade_de_trabalho():
        await db.execute("update public.profiles set phone = null, whatsapp_verified = false where id = %s", user_id)
        await db.execute(
            """delete from public.user_sessions
               where private.canonical_whatsapp_phone(phone) = private.canonical_whatsapp_phone(%s)""",
            alvo["phone"],
        )
        await _auditar(admin, "whatsapp_unlinked", alvo)
    return _json(await _detalhe(user_id))


class ApagarIn(BaseModel):
    confirm_email: str


@router.post("/accounts/{user_id}/delete")
async def apagar(user_id: UUID, body: ApagarIn, admin: UUID = Depends(admin_user)):
    _nao_a_si_mesmo(admin, user_id)
    alvo = await _alvo(user_id)
    # Conta antiga só com telefone não tem e-mail: a confirmação é o id dela.
    esperado = (alvo["email"] or str(user_id)).strip().lower()
    if body.confirm_email.strip().lower() != esperado:
        raise _erro(409, "email_mismatch", "O que foi digitado não confere com o e-mail (ou o ID) da conta.")
    async with db.unidade_de_trabalho():
        await _auditar(admin, "account_deleted", alvo)  # só ids: o e-mail some junto com a conta
        await db.execute("select private.apagar_conta(%s)", user_id)
    return _json({"deleted": True})


# ── notas internas, convites, membros, aviso por push ─────────────────────────────────────────────────
class NotaIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=2000)


_NOTA = """select n.id, n.body, n.created_at, n.admin_user_id, a.email::text as admin_email
           from public.admin_account_notes n left join auth.users a on a.id = n.admin_user_id"""


def _nota(r: dict) -> dict:
    return {"id": str(r["id"]), "body": r["body"], "created_at": _iso(r["created_at"]),
            "admin_user_id": str(r["admin_user_id"]), "admin_email": r.get("admin_email")}


@router.get("/accounts/{user_id}/notes")
async def notas(user_id: UUID, _admin: UUID = Depends(admin_user)):
    await _alvo(user_id)
    linhas = await db.fetch(_NOTA + " where n.user_id = %s order by n.created_at desc, n.id", user_id)
    return _json({"items": [_nota(r) for r in linhas]})


@router.post("/accounts/{user_id}/notes")
async def nova_nota(user_id: UUID, body: NotaIn, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    async with db.unidade_de_trabalho():
        nova = await db.fetch_one(
            """insert into public.admin_account_notes (user_id, admin_user_id, body) values (%s, %s, %s)
               returning id""", user_id, admin, body.body)
        await _auditar(admin, "note_added", alvo, {"note_id": str(nova["id"])})  # o texto da nota não vai à auditoria
    criada = await db.fetch_one(_NOTA + " where n.id = %s", nova["id"])
    return _json(_nota(criada))


@router.delete("/accounts/{user_id}/notes/{note_id}")
async def apagar_nota(user_id: UUID, note_id: UUID, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    async with db.unidade_de_trabalho():
        apagou = await db.fetch_one(
            "delete from public.admin_account_notes where id = %s and user_id = %s returning id", note_id, user_id)
        if apagou is None:
            raise _erro(404, "not_found")
        await _auditar(admin, "note_deleted", alvo, {"note_id": str(note_id)})
    return _json({"deleted": True})


@router.post("/accounts/{user_id}/invites/{invite_id}/revoke")
async def revogar_convite(user_id: UUID, invite_id: UUID, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    if not alvo["ws"]:
        raise _erro(404, "not_found")
    async with db.unidade_de_trabalho():
        # a mesma regra do app (`useRevokeInvite`): o convite vira `revoked`; aqui só os do espaço DESTA conta
        convite = await db.fetch_one(
            "select status from public.workspace_invites where id = %s and workspace_id = %s for update",
            invite_id, alvo["ws"])
        if convite is None:
            raise _erro(404, "not_found")
        if convite["status"] != "pending":
            raise _erro(409, "invite_not_pending", "Esse convite já foi aceito ou revogado.")
        await db.execute("update public.workspace_invites set status = 'revoked' where id = %s", invite_id)
        await _auditar(admin, "invite_revoked", alvo, {"invite_id": str(invite_id)})  # sem o telefone do convidado
    return _json(await _detalhe(user_id))


@router.post("/accounts/{user_id}/members/{member_user_id}/remove")
async def remover_membro(user_id: UUID, member_user_id: UUID, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    if not alvo["ws"]:
        raise _erro(404, "not_found")
    async with db.unidade_de_trabalho():
        membro = await db.fetch_one(
            "select role from public.workspace_members where workspace_id = %s and user_id = %s for update",
            alvo["ws"], member_user_id)
        if membro is None:
            raise _erro(404, "not_found")
        if membro["role"] == "owner" or member_user_id == user_id:
            raise _erro(409, "cannot_remove_owner", "O dono do espaço não pode ser removido.")
        await db.execute("delete from public.workspace_members where workspace_id = %s and user_id = %s",
                         alvo["ws"], member_user_id)
        await _auditar(admin, "member_removed", alvo, {"member_user_id": str(member_user_id)})
    return _json(await _detalhe(user_id))


class AvisoIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=60)
    body: str = Field(min_length=1, max_length=180)


@router.post("/accounts/{user_id}/notify")
async def avisar(user_id: UUID, body: AvisoIn, admin: UUID = Depends(admin_user)):
    alvo = await _alvo(user_id)
    if not alvo.get("expo_push_token"):
        raise _erro(409, "no_push_tokens", "A conta não tem aparelho registrado para receber o aviso.")
    # rede FORA da transação; só audita se o Expo aceitou
    try:
        await push.send(alvo["expo_push_token"], body.title, body.body)
    except Exception as err:  # noqa: BLE001
        log.warning("push do painel falhou: %s", type(err).__name__)
        raise _erro(502, "push_failed", "Não consegui enviar o aviso. Tente de novo.") from err
    async with db.unidade_de_trabalho():
        await _auditar(admin, "push_sent", alvo, {"title": body.title})
    return _json({"sent": 1})


# ── configuração remota do app (versão mínima, aviso) ──────────────────────────────────────────────────
_VERSAO = re.compile(r"^\d+\.\d+\.\d+$")
_CONFIG_CAMPOS = ("min_version_ios", "min_version_android", "latest_version_ios", "latest_version_android",
                  "store_url_ios", "store_url_android", "notice_title", "notice_body", "notice_level", "notice_until")


class ConfigIn(BaseModel):
    """Substitui os 10 campos (o painel manda o formulário inteiro); vazio vira null."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")  # o painel pode devolver updated_at/updated_by
    min_version_ios: str | None = None
    min_version_android: str | None = None
    latest_version_ios: str | None = None
    latest_version_android: str | None = None
    store_url_ios: str | None = Field(None, max_length=500)
    store_url_android: str | None = Field(None, max_length=500)
    notice_title: str | None = Field(None, max_length=120)
    notice_body: str | None = Field(None, max_length=1000)
    notice_level: Literal["info", "warning", "critical"] | None = None
    notice_until: datetime | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _vazio_e_nulo(cls, v):
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("min_version_ios", "min_version_android", "latest_version_ios", "latest_version_android")
    @classmethod
    def _semver(cls, v):
        if v is not None and not _VERSAO.match(v):
            raise ValueError("versão no formato MAJOR.MINOR.PATCH")
        return v

    @field_validator("notice_until")
    @classmethod
    def _com_fuso(cls, v):
        # sem fuso na entrada = horário de Brasília (o painel é brasileiro), nunca o fuso da conexão
        return v.replace(tzinfo=_FUSO) if v is not None and v.tzinfo is None else v

    @field_validator("store_url_ios")
    @classmethod
    def _loja_ios(cls, v):
        if v is not None and not v.startswith(("https://apps.apple.com/", "https://itunes.apple.com/")):
            raise ValueError("a URL da App Store começa com https://apps.apple.com/ ou https://itunes.apple.com/")
        return v

    @field_validator("store_url_android")
    @classmethod
    def _loja_android(cls, v):
        if v is not None and not v.startswith("https://play.google.com/"):
            raise ValueError("a URL da Play Store começa com https://play.google.com/")
        return v


def _config(r: dict) -> dict:
    out = {c: r.get(c) for c in _CONFIG_CAMPOS}
    out["notice_until"] = _iso(r.get("notice_until"))
    out["updated_at"] = _iso(r.get("updated_at"))
    out["updated_by"] = str(r["updated_by"]) if r.get("updated_by") else None
    return out


@router.get("/app-config")
async def ver_config(_admin: UUID = Depends(admin_user)):
    r = await db.fetch_one("select * from public.app_config where id = 1")
    return _json(_config(r or {}))


@router.put("/app-config")
async def mudar_config(body: ConfigIn, admin: UUID = Depends(admin_user)):
    novo = body.model_dump()
    async with db.unidade_de_trabalho():
        antes = await db.fetch_one("select * from public.app_config where id = 1 for update") or {}
        # compara os OBJETOS (o mesmo instante em fusos diferentes é igual); só o audit vira texto
        diff = {c: {"from": _json_valor(antes.get(c)), "to": _json_valor(novo[c])}
                for c in _CONFIG_CAMPOS if antes.get(c) != novo[c]}
        if not diff:
            return _json(_config(antes))
        depois = await db.fetch_one(
            f"""update public.app_config set {", ".join(f"{c} = %s" for c in _CONFIG_CAMPOS)},
                       updated_at = now(), updated_by = %s where id = 1 returning *""",
            *[novo[c] for c in _CONFIG_CAMPOS], admin)
        await _auditar(admin, "app_config_changed", None, {"changes": diff})
    return _json(_config(depois))


def _json_valor(v):
    return v.isoformat() if isinstance(v, datetime) else v


# ── auditoria, cobrança, sistema ──────────────────────────────────────────────────────────────────────
@router.get("/audit")
async def auditoria(
    action: str = Query("", max_length=40),
    admin_user_id: UUID | None = None,
    target_user_id: UUID | None = None,
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(50, ge=1, le=100),
    _admin: UUID = Depends(admin_user),
):
    onde, args = ["true"], []
    for sql, v in (("e.action = %s", action or None), ("e.admin_user_id = %s", admin_user_id),
                   ("e.target_user_id = %s", target_user_id)):
        if v is not None:
            onde.append(sql)
            args.append(v)
    filtro = " and ".join(onde)
    total = await db.fetch_one(f"select count(*)::int as n from public.admin_audit_events e where {filtro}", *args)
    limite, desloc = _pagina(page, page_size)
    linhas = await db.fetch(f"{_EVENTOS} where {filtro} order by e.created_at desc, e.id limit %s offset %s",
                            *args, limite, desloc)
    return _json({"items": [_evento(r) for r in linhas], "total": (total or {}).get("n", 0),
                  "page": page, "page_size": page_size})


@router.get("/billing-events")
async def cobrancas(
    q: str = Query("", max_length=100),
    type: str = Query("", max_length=40),  # noqa: A002 — nome do contrato
    result: str = Query("", max_length=40),
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(50, ge=1, le=100),
    _admin: UUID = Depends(admin_user),
):
    onde, args = ["true"], []
    if q.strip():
        onde.append("(b.app_user_id ilike %s or u.email ilike %s)")
        args += [_like(q)] * 2
    for sql, v in (("b.type = %s", type or None), ("b.result = %s", result or None)):
        if v is not None:
            onde.append(sql)
            args.append(v)
    filtro = " and ".join(onde)
    de = """
        from (select id, received_at, type, provider, result,
                     coalesce(payload->>'app_user_id', payload->'event'->>'app_user_id') as app_user_id,
                     coalesce(payload->>'product_id', payload->'event'->>'product_id') as product_id,
                     coalesce(payload->>'environment', payload->'event'->>'environment') as environment
              from public.billing_events) b
        left join auth.users u on u.id::text = b.app_user_id"""
    total = await db.fetch_one(f"select count(*)::int as n {de} where {filtro}", *args)
    limite, desloc = _pagina(page, page_size)
    linhas = await db.fetch(
        f"""select b.id, b.received_at, b.type, b.provider, b.result, b.app_user_id, u.email::text as email,
                   b.product_id, b.environment
            {de} where {filtro} order by b.received_at desc, b.id limit %s offset %s""",
        *args, limite, desloc,
    )
    return _json({"items": [
        {"id": r["id"], "created_at": _iso(r["received_at"]), "type": r.get("type"), "provider": r.get("provider"),
         "result": r.get("result"), "app_user_id": r.get("app_user_id"), "email": r.get("email"),
         "product_id": r.get("product_id"), "environment": r.get("environment")} for r in linhas],
        "total": (total or {}).get("n", 0), "page": page, "page_size": page_size})


@router.get("/system")
async def sistema(_admin: UUID = Depends(admin_user)):
    f = await db.fetch_one(
        f"""select
          (select count(*) from public.messages_queue where status = 'pending')::int as pending,
          (select count(*) from public.messages_queue where status = 'processing')::int as processing,
          (select count(*) from public.messages_queue
            where status = 'failed' and created_at >= now() - interval '24 hours')::int as failed_24h,
          (select coalesce(extract(epoch from now() - min(created_at)), 0)
             from public.messages_queue where status = 'pending')::int as oldest,
          (select coalesce(sum(estimated_cost_usd), 0) from public.ai_events
            where created_at >= now() - interval '24 hours') as c24,
          (select coalesce(sum(estimated_cost_usd), 0) from public.ai_events
            where created_at >= now() - interval '7 days') as c7,
          (select count(*) from public.whatsapp_sends where kind = 'reply' and created_at >= {_MES})::int as replies,
          (select count(*) from public.whatsapp_sends where kind = 'notice' and created_at >= {_MES})::int as notices"""
    ) or {}
    falhas = await db.fetch(
        # sem texto do usuário: só o erro técnico, sem sequências longas de dígitos (telefone, ids) e curto
        """select created_at, status,
                  left(regexp_replace(coalesce(last_error, ''), '[0-9]{8,}', '#', 'g'), 200) as last_error
           from public.messages_queue where status = 'failed' order by created_at desc limit 10"""
    )
    return _json({
        "queue": {"pending": f.get("pending", 0), "processing": f.get("processing", 0),
                  "failed_24h": f.get("failed_24h", 0), "oldest_pending_seconds": f.get("oldest", 0)},
        "recent_failures": [{"created_at": _iso(r["created_at"]), "status": r["status"],
                             "last_error": r["last_error"]} for r in falhas],
        "ai_cost": {"last_24h_usd": _usd(f.get("c24")), "last_7d_usd": _usd(f.get("c7"))},
        "whatsapp_month": {"replies": f.get("replies", 0), "notices": f.get("notices", 0)},
    })
