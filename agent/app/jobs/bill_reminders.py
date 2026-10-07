"""Lembrete de conta (cron de 1 minuto): quem decide o que toca é `_bill_reminders_due()`.

A reserva em `private.bill_reminder_sends` acontece ANTES do envio, sob trava de sessão (o mesmo
at-least-once dos lembretes). Falha soma `attempts`; com 5 a função do banco deixa de devolver o
aviso — template pago não entra em loop. Canais e portão do WhatsApp são os do lembrete comum.
"""

from __future__ import annotations

import logging
from datetime import date

from app import db
from app.domain.dates import now_utc, tz
from app.domain.money import cents_to_brl
from app.jobs import reminders

log = logging.getLogger(__name__)


def hoje_local() -> date:
    return now_utc().astimezone(tz("America/Sao_Paulo")).date()


def texto(nome: str, cents: int, vence: date, hoje: date) -> str:
    dias = (vence - hoje).days
    quando = ("vence hoje" if dias <= 0 else "vence amanhã" if dias == 1
              else f"vence em {dias} dias, {vence:%d/%m}")
    return f"{nome} {quando} · {cents_to_brl(cents)}"


async def run() -> dict:
    linhas = await db.fetch("select * from public._bill_reminders_due()")
    hoje = hoje_local()
    enviados = falhas = 0
    for linha in linhas:
        chave = f"conta:{linha['bill_reminder_id']}:{linha['due_date']}"
        async with db.trava_de_sessao(chave) as livre:
            if not livre:
                continue
            await db.execute(
                "insert into private.bill_reminder_sends (bill_reminder_id, due_date)"
                " values (%s, %s) on conflict do nothing",
                linha["bill_reminder_id"], linha["due_date"],
            )
            estado = await db.fetch_one(
                "select sent_at, attempts from private.bill_reminder_sends"
                " where bill_reminder_id = %s and due_date = %s",
                linha["bill_reminder_id"], linha["due_date"],
            )
            if not estado or estado["sent_at"] is not None or estado["attempts"] >= reminders.MAX_SEND_ATTEMPTS:
                continue
            corpo = texto(linha["title"], linha["amount_cents"], linha["due_date"], hoje)
            try:
                await reminders._entregar({**linha, "title": corpo}, alvo=linha["target"], ref=str(linha["ref"]))
                await db.execute(
                    "update private.bill_reminder_sends set sent_at = now(), last_error = null"
                    " where bill_reminder_id = %s and due_date = %s",
                    linha["bill_reminder_id"], linha["due_date"],
                )
                enviados += 1
            except Exception as err:  # noqa: BLE001
                await db.execute(
                    "update private.bill_reminder_sends set attempts = attempts + 1, last_error = %s"
                    " where bill_reminder_id = %s and due_date = %s",
                    repr(err)[:2000], linha["bill_reminder_id"], linha["due_date"],
                )
                falhas += 1
                log.warning("lembrete de conta %s: %s", linha["bill_reminder_id"], err)
    return {"due": len(linhas), "sent": enviados, "failed": falhas}
