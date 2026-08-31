"""Disparo de lembretes vencidos (cron de 1 minuto).

Push primeiro (grátis), template do WhatsApp como complemento ou fallback.
Depois recalcula next_run_at pela RRULE, ou desativa se for único.

Falha de entrega NÃO repete para sempre: send_attempts conta, e ao estourar o
teto a série pula para a próxima ocorrência (e o lembrete único é desativado).
Sem isso, um template não aprovado na Meta fazia o cron tentar a cada minuto,
eternamente — aconteceu.
"""

from __future__ import annotations

import logging

from app import db
from app.config import get_settings
from app.domain.dates import now_utc
from app.domain.recurrence import next_occurrence
from app.services import push, whatsapp

log = logging.getLogger(__name__)

MAX_SEND_ATTEMPTS = 5
DEFAULT_TIMEZONE = "America/Sao_Paulo"


async def run() -> dict:
    agora = now_utc()
    vencidos = await db.fetch(
        """
        select r.id, r.user_id, r.title, r.recurrence, r.channel, r.next_run_at,
               r.timezone, r.send_attempts, p.phone, p.expo_push_token
        from public.reminders r
        join public.profiles p on p.id = r.user_id
        where r.active = true and r.next_run_at <= %s
        order by r.next_run_at
        limit 100
        """,
        agora,
    )

    enviados = desistidos = 0
    for lembrete in vencidos:
        fuso = lembrete["timezone"] or DEFAULT_TIMEZONE
        try:
            await _entregar(lembrete)
            proxima = next_occurrence(
                lembrete["recurrence"], agora, fuso, lembrete["next_run_at"]
            )
            await db.execute(
                """
                update public.reminders
                set send_attempts = 0, last_error = null, updated_at = now(),
                    next_run_at = coalesce(%s, next_run_at),
                    active = %s
                where id = %s
                """,
                proxima,
                proxima is not None,
                lembrete["id"],
            )
            enviados += 1
        except Exception as err:  # noqa: BLE001
            tentativas = (lembrete["send_attempts"] or 0) + 1
            desistir = tentativas >= MAX_SEND_ATTEMPTS
            proxima = (
                next_occurrence(lembrete["recurrence"], agora, fuso, lembrete["next_run_at"])
                if desistir
                else None
            )
            await db.execute(
                """
                update public.reminders
                set send_attempts = %s, last_error = %s, updated_at = now(),
                    next_run_at = coalesce(%s, next_run_at),
                    active = case when %s and %s is null then false else active end
                where id = %s
                """,
                0 if desistir else tentativas,
                repr(err)[:2000],
                proxima,
                desistir,
                proxima,
                lembrete["id"],
            )
            if desistir:
                desistidos += 1
            log.warning("lembrete %s (tentativa %s): %s", lembrete["id"], tentativas, err)

    return {"due": len(vencidos), "sent": enviados, "given_up": desistidos}


async def _entregar(lembrete: dict) -> None:
    """Tenta os canais pedidos. Push que falha não anula o WhatsApp."""
    settings = get_settings()
    canal = lembrete["channel"]
    quer_push = canal in ("push", "both")
    quer_whatsapp = canal in ("whatsapp", "both")

    entregue = False
    falhas: list[str] = []

    if quer_push and lembrete["expo_push_token"]:
        try:
            await push.send(lembrete["expo_push_token"], "⏰ Lembrete", lembrete["title"], "reminders")
            entregue = True
        except Exception as err:  # noqa: BLE001
            falhas.append(f"push: {err}")

    if lembrete["phone"] and (quer_whatsapp or (not entregue and quer_push)):
        try:
            await whatsapp.send_template(
                lembrete["phone"], settings.wa_reminder_template, [lembrete["title"]]
            )
            entregue = True
        except Exception as err:  # noqa: BLE001
            falhas.append(f"whatsapp: {err}")

    if not entregue:
        raise RuntimeError(
            " | ".join(falhas) or "nenhum canal disponível (sem push token nem telefone)"
        )
