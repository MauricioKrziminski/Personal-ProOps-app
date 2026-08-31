"""Alertas proativos (cron diário).

Quem decide o que alertar é a RPC `_alerts_to_send`; aqui só entrega. A reserva
em alerts_sent acontece ANTES do envio: se duas execuções coincidirem, só uma
passa. No WhatsApp, spam é template PAGO.

Quando a entrega falha, a reserva FICA. Perder um alerta é melhor do que insistir
todo dia num canal quebrado — foi assim que o cron de lembretes virou loop.
"""

from __future__ import annotations

import logging

from psycopg.errors import UniqueViolation

from app import db
from app.config import get_settings
from app.services import push, whatsapp

log = logging.getLogger(__name__)

MAX_ALERTS_PER_USER = 4


async def run() -> dict:
    candidatos = await db.fetch("select * from public._alerts_to_send()")

    por_usuario: dict[str, int] = {}
    enviados = pulados = 0

    for alerta in candidatos:
        usuario = str(alerta["user_id"])
        if por_usuario.get(usuario, 0) >= MAX_ALERTS_PER_USER:
            pulados += 1
            continue

        try:
            await db.execute(
                """
                insert into public.alerts_sent (workspace_id, user_id, kind, ref, channel)
                values (%s, %s, %s, %s, %s)
                """,
                alerta["workspace_id"], alerta["user_id"], alerta["kind"], alerta["ref"],
                "push" if alerta["expo_push_token"] else "whatsapp",
            )
        except UniqueViolation:
            pulados += 1  # já mandado hoje
            continue
        except Exception:  # noqa: BLE001
            log.exception("reserva em alerts_sent falhou — não envio às cegas")
            pulados += 1
            continue

        try:
            if alerta["expo_push_token"]:
                await push.send(
                    alerta["expo_push_token"],
                    alerta["title"],
                    alerta["body"],
                    push.target_for(alerta["kind"]),
                )
            elif alerta["phone"]:
                # fora da janela de 24h texto livre não passa: template Utility
                await whatsapp.send_template(
                    alerta["phone"],
                    get_settings().wa_reminder_template,
                    [f"{alerta['title']}: {alerta['body']}"],
                )
            else:
                pulados += 1
                continue
            enviados += 1
            por_usuario[usuario] = por_usuario.get(usuario, 0) + 1
        except Exception:  # noqa: BLE001
            log.exception("alerta %s/%s falhou", alerta["kind"], alerta["ref"])
            pulados += 1

    return {"candidatos": len(candidatos), "enviados": enviados, "pulados": pulados}
