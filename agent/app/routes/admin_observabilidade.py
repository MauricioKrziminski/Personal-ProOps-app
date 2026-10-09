"""Observabilidade do painel: issues agrupados (docs/ADMIN-API.md). Mesma autorização do `admin.py`.

Nada aqui devolve conteúdo financeiro: só erro técnico já mascarado, contagens e o e-mail de quem
foi afetado (o mesmo dado que a tela de contas já mostra ao admin).
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app import db
from app.routes.admin import _Rota, _erro, _EVENTOS, _evento, _iso, _json, _like, _pagina, admin_user

router = APIRouter(prefix="/admin/api", tags=["admin"], route_class=_Rota)

_PERIODO = {"1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days"}
_ORDEM = {
    "last_seen_desc": "last_seen desc, id",
    "count_desc": "count desc, id",
    "users_desc": "users_affected desc, id",
    "first_seen_desc": "first_seen desc, id",
}
_COLUNAS = """i.id, i.fingerprint, i.source, i.kind, i.severity, i.title, i.message, i.route, i.status,
       i.first_seen, i.last_seen, i.count, i.last_app_version, i.platforms,
       (select count(distinct e.user_id) from public.error_events e where e.issue_id = i.id)::int as users_affected"""


def _issue(r: dict) -> dict:
    return {
        "id": str(r["id"]), "fingerprint": r["fingerprint"], "source": r["source"], "kind": r["kind"],
        "severity": r["severity"], "title": r["title"], "message": r["message"], "route": r.get("route"),
        "status": r["status"], "first_seen": _iso(r["first_seen"]), "last_seen": _iso(r["last_seen"]),
        "count": int(r["count"]), "users_affected": int(r["users_affected"]),
        "last_app_version": r.get("last_app_version"), "platforms": list(r.get("platforms") or []),
    }


@router.get("/issues")
async def issues(
    status: Literal["open", "resolved", "ignored"] = "open",
    source: Literal["app", "admin", "agent"] | None = None,
    severity: Literal["critical", "error", "warning"] | None = None,
    period: Literal["1h", "24h", "7d", "30d"] = "7d",
    q: str = Query("", max_length=100),
    sort: Literal["last_seen_desc", "count_desc", "users_desc", "first_seen_desc"] = "last_seen_desc",
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(25, ge=1, le=100),
    _admin: UUID = Depends(admin_user),
):
    onde, args = ["i.status = %s", f"i.last_seen >= now() - interval '{_PERIODO[period]}'"], [status]
    for sql, v in (("i.source = %s", source), ("i.severity = %s", severity)):
        if v:
            onde.append(sql)
            args.append(v)
    if q.strip():
        onde.append("(i.title ilike %s or i.message ilike %s or i.route ilike %s)")
        args += [_like(q)] * 3
    filtro = " and ".join(onde)
    total = await db.fetch_one(f"select count(*)::int as n from public.error_issues i where {filtro}", *args)
    limite, desloc = _pagina(page, page_size)
    linhas = await db.fetch(
        f"""select * from (select {_COLUNAS} from public.error_issues i where {filtro}) x
            order by {_ORDEM[sort]} limit %s offset %s""",
        *args, limite, desloc,
    )
    s = await db.fetch_one(
        """select (select count(*) from public.error_issues where status = 'open')::int as open,
                  (select count(*) from public.error_events where created_at >= now() - interval '24 hours')::int as ev,
                  (select count(distinct user_id) from public.error_events
                    where created_at >= now() - interval '24 hours')::int as users,
                  (select count(*) from public.error_issues where first_seen >= now() - interval '24 hours')::int as nw"""
    ) or {}
    por_origem = {k: 0 for k in ("app", "admin", "agent")}
    for r in await db.fetch(
        """select i.source, count(*)::int as n from public.error_events e join public.error_issues i on i.id = e.issue_id
           where e.created_at >= now() - interval '24 hours' group by i.source"""
    ):
        por_origem[r["source"]] = r["n"]
    return _json({
        "items": [_issue(r) for r in linhas], "total": (total or {}).get("n", 0), "page": page, "page_size": page_size,
        "summary": {"open": s.get("open", 0), "events_24h": s.get("ev", 0), "users_affected_24h": s.get("users", 0),
                    "new_24h": s.get("nw", 0), "by_source_24h": por_origem},
    })


async def _detalhe(issue_id: UUID) -> dict:
    r = await db.fetch_one(f"select {_COLUNAS}, i.stack from public.error_issues i where i.id = %s", issue_id)
    if r is None:
        raise _erro(404, "not_found")
    horas = await db.fetch(
        """select h, (select count(*) from public.error_events e where e.issue_id = %s
                       and date_trunc('hour', e.created_at) = h)::int as n
           from generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()),
                                interval '1 hour') h order by h""", issue_id)
    dias = await db.fetch(
        """select to_char(d, 'YYYY-MM-DD') as day, (select count(*) from public.error_events e where e.issue_id = %s
                       and (e.created_at at time zone 'America/Sao_Paulo')::date = d::date)::int as n
           from generate_series((now() at time zone 'America/Sao_Paulo')::date - 29,
                                (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') d order by d""", issue_id)
    eventos = await db.fetch(
        """select e.id, e.created_at, e.user_id, u.email::text as user_email, e.platform, e.app_version, e.route,
                  e.message, e.context
           from public.error_events e left join auth.users u on u.id = e.user_id
           where e.issue_id = %s order by e.created_at desc, e.id limit 50""", issue_id)
    triagem = await db.fetch(
        _EVENTOS + " where e.action = 'issue_triaged' and e.payload->>'issue_id' = %s order by e.created_at desc limit 50",
        str(issue_id))
    return {
        "issue": _issue(r), "stack": r.get("stack"),
        "hourly_24h": [{"hour": _iso(h["h"]), "count": h["n"]} for h in horas],
        "daily_30d": [{"day": d["day"], "count": d["n"]} for d in dias],
        "events": [{"id": str(e["id"]), "created_at": _iso(e["created_at"]),
                    "user_id": str(e["user_id"]) if e["user_id"] else None, "user_email": e.get("user_email"),
                    "platform": e.get("platform"), "app_version": e.get("app_version"), "route": e.get("route"),
                    "message": e["message"], "context": e.get("context") or {}} for e in eventos],
        "triage": [_evento(t) for t in triagem],
    }


@router.get("/issues/{issue_id}")
async def issue(issue_id: UUID, _admin: UUID = Depends(admin_user)):
    return _json(await _detalhe(issue_id))


class StatusIn(BaseModel):
    status: Literal["open", "resolved", "ignored"]


@router.post("/issues/{issue_id}/status")
async def triar(issue_id: UUID, body: StatusIn, admin: UUID = Depends(admin_user)):
    async with db.unidade_de_trabalho():
        atual = await db.fetch_one("select status from public.error_issues where id = %s for update", issue_id)
        if atual is None:
            raise _erro(404, "not_found")
        resolvida = body.status == "resolved"
        await db.execute(
            """update public.error_issues set status = %s,
                      resolved_at = case when %s then now() end, resolved_by = case when %s then %s::uuid end
               where id = %s""",
            body.status, resolvida, resolvida, str(admin), issue_id,
        )
        # sem alvo (não há conta): o id do issue vai no payload, que o detalhe filtra
        await db.execute(
            """insert into public.admin_audit_events (admin_user_id, action, payload)
               values (%s, 'issue_triaged', %s)""",
            admin, Jsonb({"issue_id": str(issue_id), "from": atual["status"], "to": body.status}),
        )
    return _json(await _detalhe(issue_id))
