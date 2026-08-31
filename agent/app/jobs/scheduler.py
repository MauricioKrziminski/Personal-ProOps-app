"""Manutenção financeira (cron de hora em hora).

Quatro coisas, nessa ordem:
  1. materializa recorrentes 90 dias à frente (é o que alimenta a projeção de
     fluxo de caixa — sem isso a previsão só enxerga o que já aconteceu)
  2. fecha faturas vencidas
  3. promove pendentes que já venceram
  4. tira a foto do patrimônio do dia

Só a (1) é código; o resto é RPC. Valor de imóvel/investimento/dívida não tem
histórico para reconstruir depois, então a série de patrimônio vive de SNAPSHOT —
reconstruir seria inventar número.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from psycopg.errors import UniqueViolation

from app import db
from app.domain.dates import local_iso_date, now_utc
from app.domain.recurrence import next_occurrence

log = logging.getLogger(__name__)

HORIZON_DAYS = 90
MAX_OCCURRENCES_PER_SERIES = 200
MAX_SERIES_PER_RUN = 200
DEFAULT_TIMEZONE = "America/Sao_Paulo"


async def run() -> dict:
    agora = now_utc()
    criadas = await materialize_horizon(agora)

    fechadas = await db.fetch_one("select public._close_due_invoices() as n")
    promovidas = await db.fetch_one("select public._promote_due_transactions() as n")
    fotos = await db.fetch_one("select public._snapshot_net_worth() as n")

    return {
        "created": criadas,
        "invoices_closed": (fechadas or {}).get("n", 0),
        "promoted": (promovidas or {}).get("n", 0),
        "snapshots": (fotos or {}).get("n", 0),
    }


async def materialize_horizon(agora) -> int:
    series = await db.fetch(
        """
        select r.id, r.user_id, r.workspace_id, r.kind, r.amount_cents, r.currency,
               r.category, r.description, r.account_id, r.rrule, r.next_run_at,
               r.dtstart, r.end_date, r.auto_confirm, r.materialized_until,
               p.timezone
        from public.recurring_transactions r
        left join public.profiles p on p.id = r.user_id
        where r.active = true
        limit %s
        """,
        MAX_SERIES_PER_RUN,
    )

    horizonte = agora + timedelta(days=HORIZON_DAYS)
    criadas = 0

    for rec in series:
        fuso = rec["timezone"] or DEFAULT_TIMEZONE
        # âncora imutável da série: sem ela a hora de parede derivaria a cada rodada
        dtstart = rec["dtstart"] or rec["next_run_at"]

        try:
            # retoma de onde parou; na primeira vez, de um instante ANTES da
            # próxima ocorrência (para que ela mesma seja gerada)
            cursor = rec["materialized_until"] or (rec["next_run_at"] - timedelta(seconds=1))
            ultima = rec["materialized_until"]
            geradas = 0

            while geradas < MAX_OCCURRENCES_PER_SERIES:
                occ = next_occurrence(rec["rrule"], cursor, fuso, dtstart)
                if occ is None or occ > horizonte:
                    break
                dia = local_iso_date(fuso, occ)
                if rec["end_date"] and dia > rec["end_date"].isoformat():
                    break

                ja_aconteceu = occ <= agora
                try:
                    await db.execute(
                        """
                        insert into public.transactions
                          (user_id, workspace_id, kind, amount_cents, currency, category,
                           description, account_id, occurred_at, due_at, source, status,
                           recurring_id)
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'recurring', %s, %s)
                        """,
                        rec["user_id"], rec["workspace_id"], rec["kind"], rec["amount_cents"],
                        rec["currency"], rec["category"], rec["description"], rec["account_id"],
                        dia, dia,
                        "cleared" if (ja_aconteceu and rec["auto_confirm"]) else "pending",
                        rec["id"],
                    )
                    criadas += 1
                except UniqueViolation:
                    # ocorrência já materializada numa rodada anterior: segue
                    pass

                cursor = occ
                ultima = occ
                geradas += 1

            # next_run_at continua sendo a PRÓXIMA ocorrência FUTURA (é o que o
            # app mostra), independente de quanto já foi materializado à frente
            proxima = next_occurrence(rec["rrule"], agora, fuso, dtstart)
            encerrou = proxima is None or (
                rec["end_date"] is not None
                and local_iso_date(fuso, proxima) > rec["end_date"].isoformat()
            )
            await db.execute(
                """
                update public.recurring_transactions
                set dtstart = %s, materialized_until = coalesce(%s, materialized_until),
                    next_run_at = %s, active = %s, run_attempts = 0, last_error = null
                where id = %s
                """,
                dtstart,
                ultima,
                (ultima or rec["next_run_at"]) if encerrou else proxima,
                not encerrou,
                rec["id"],
            )
        except Exception as err:  # noqa: BLE001
            log.exception("série %s falhou", rec["id"])
            await db.execute(
                "update public.recurring_transactions set last_error = %s where id = %s",
                repr(err)[:2000],
                rec["id"],
            )

    return criadas
