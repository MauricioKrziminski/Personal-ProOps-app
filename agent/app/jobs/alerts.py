"""Alertas proativos (cron diário).

Quem decide o que alertar é a RPC `_alerts_to_send`; aqui só entrega nos canais
que a pessoa ativou. A reserva em alerts_sent acontece POR CANAL antes do envio:
se duas execuções coincidirem, só uma passa. No WhatsApp, spam é template PAGO.

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


def _channels(alerta: dict) -> list[str]:
    """Capacidade não é consentimento: não existe fallback entre canais."""
    channels: list[str] = []
    if alerta["alerts_push_enabled"] and alerta["expo_push_token"]:
        channels.append("push")
    if alerta["alerts_whatsapp_enabled"] and alerta["phone"]:
        channels.append("whatsapp")
    return channels


async def run() -> dict:
    candidatos = await db.fetch("select * from public._alerts_to_send()")

    por_usuario: dict[str, int] = {}
    enviados = pulados = 0

    for alerta in candidatos:
        usuario = str(alerta["user_id"])
        if por_usuario.get(usuario, 0) >= MAX_ALERTS_PER_USER:
            pulados += 1
            continue

        channels = _channels(alerta)
        if not channels:
            pulados += 1
            continue

        entregou = False
        for channel in channels:
            try:
                await db.execute(
                    """
                    insert into public.alerts_sent (workspace_id, user_id, kind, ref, channel)
                    values (%s, %s, %s, %s, %s)
                    """,
                    alerta["workspace_id"],
                    alerta["user_id"],
                    alerta["kind"],
                    alerta["ref"],
                    channel,
                )
            except UniqueViolation:
                pulados += 1  # este canal já foi reservado hoje
                continue
            except Exception:  # noqa: BLE001
                log.exception("reserva em alerts_sent falhou — não envio às cegas")
                pulados += 1
                continue

            try:
                if channel == "push":
                    await push.send(
                        alerta["expo_push_token"],
                        alerta["title"],
                        alerta["body"],
                        push.target_for(alerta["kind"]),
                    )
                else:
                    # Aviso inferido não pode usar o template que diz "você pediu".
                    await whatsapp.send_template(
                        alerta["phone"],
                        get_settings().wa_alert_template,
                        [f"{alerta['title']}: {alerta['body']}"],
                    )
                enviados += 1
                entregou = True
            except Exception:  # noqa: BLE001
                log.exception(
                    "alerta %s/%s via %s falhou",
                    alerta["kind"],
                    alerta["ref"],
                    channel,
                )
                pulados += 1

        if entregou:
            por_usuario[usuario] = por_usuario.get(usuario, 0) + 1

    return {"candidatos": len(candidatos), "enviados": enviados, "pulados": pulados}
