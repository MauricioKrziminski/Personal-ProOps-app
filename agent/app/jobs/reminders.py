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
from datetime import datetime

from app import db
from app.config import get_settings
from app.domain.dates import local_iso_date, now_utc, tz
from app.domain.recurrence import em_pausa, next_occurrence
from app.services import push, whatsapp

log = logging.getLogger(__name__)

MAX_SEND_ATTEMPTS = 5
DEFAULT_TIMEZONE = "America/Sao_Paulo"


def _fixed_day_for_implicit_monthly(
    recurrence: str | None, run_at: datetime, timezone_name: str
) -> str | None:
    """Keep the date's numeric day when an older monthly rule omitted BYMONTHDAY.

    Once February is clamped to 28/29, the original 30/31 cannot be recovered
    from next_run_at. Persisting the explicit day on the first advance preserves it.
    """
    if not recurrence:
        return recurrence
    chunks = recurrence.removeprefix("RRULE:").split(";")
    pairs = [chunk.partition("=") for chunk in chunks]
    if any(not separator or not value for _, separator, value in pairs):
        return recurrence
    parts = {key.upper(): value.upper() for key, _, value in pairs}
    if (
        len(parts) != len(pairs)
        or parts.get("FREQ") != "MONTHLY"
        or set(parts) - {"FREQ", "INTERVAL", "COUNT", "UNTIL"}
    ):
        return recurrence
    day = run_at.astimezone(tz(timezone_name)).day
    if day < 29:
        return recurrence
    suffix_index = next(
        (i for i, (key, _, _) in enumerate(pairs) if key.upper() in {"COUNT", "UNTIL"}),
        len(chunks),
    )
    chunks.insert(suffix_index, f"BYMONTHDAY={day}")
    prefix = "RRULE:" if recurrence.startswith("RRULE:") else ""
    return prefix + ";".join(chunks)


async def run() -> dict:
    agora = now_utc()
    vencidos = await db.fetch(
        """
        select r.id, r.user_id, r.title, r.recurrence, r.channel, r.next_run_at,
               r.skip_run_at, r.parent_reminder_id, r.paused_from, r.paused_until,
               r.timezone, r.send_attempts, p.phone, p.expo_push_token,
               p.alerts_whatsapp_enabled
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
        # Reivindica ANTES de entregar: duas rodadas que se sobrepõem (cron lento,
        # retry do Scheduler) pegavam o mesmo lembrete e mandavam o template pago
        # duas vezes. A trava é de sessão e morre com a conexão; se o container cai
        # entre entregar e avançar, a próxima rodada reenvia: preferimos o envio
        # repetido a lembrete perdido (at-least-once).
        chave = f"lembrete:{lembrete['id']}:{lembrete['next_run_at']}"
        async with db.trava_de_sessao(chave) as livre:
            if not livre:
                continue
            # a rodada anterior pode ter terminado entre o select e a trava
            ainda = await db.fetch_one(
                "select 1 from public.reminders"
                " where id = %s and next_run_at = %s and active = true",
                lembrete["id"], lembrete["next_run_at"],
            )
            if not ainda:
                continue
            fuso = lembrete["timezone"] or DEFAULT_TIMEZONE
            regra = _fixed_day_for_implicit_monthly(
                lembrete["recurrence"], lembrete["next_run_at"], fuso
            )
            try:
                delivered_channels: list[str] = []
                skipped = (
                    lembrete["skip_run_at"] is not None
                    and lembrete["skip_run_at"] == lembrete["next_run_at"]
                ) or em_pausa(
                    local_iso_date(fuso, lembrete["next_run_at"]),
                    lembrete.get("paused_from"),
                    lembrete.get("paused_until"),
                )
                if not skipped:
                    delivered_channels = await _entregar(lembrete) or []
                proxima = next_occurrence(
                    regra, agora, fuso, lembrete["next_run_at"]
                )
                await db.execute(
                    """
                    select public.finish_reminder_occurrence(
                        %s, %s, %s, %s, %s, 'sent', null, %s, %s
                    )
                    """,
                    lembrete["id"],
                    lembrete["next_run_at"],
                    lembrete["recurrence"],
                    proxima,
                    regra,
                    delivered_channels,
                    lembrete["title"],
                )
                if not skipped:
                    enviados += 1
            except Exception as err:  # noqa: BLE001
                tentativas = (lembrete["send_attempts"] or 0) + 1
                desistir = tentativas >= MAX_SEND_ATTEMPTS
                proxima = (
                    next_occurrence(regra, agora, fuso, lembrete["next_run_at"])
                    if desistir
                    else None
                )
                if desistir:
                    await db.execute(
                        """
                        select public.finish_reminder_occurrence(
                            %s, %s, %s, %s, %s, 'given_up', %s
                        )
                        """,
                        lembrete["id"],
                        lembrete["next_run_at"],
                        lembrete["recurrence"],
                        proxima,
                        regra,
                        repr(err)[:2000],
                    )
                else:
                    await db.execute(
                        """
                        update public.reminders
                        set send_attempts = %s, last_error = %s, updated_at = now()
                        where id = %s and next_run_at = %s
                          and recurrence is not distinct from %s and active = true
                        """,
                        tentativas,
                        repr(err)[:2000],
                        lembrete["id"],
                        lembrete["next_run_at"],
                        lembrete["recurrence"],
                    )
                if desistir:
                    desistidos += 1
                log.warning("lembrete %s (tentativa %s): %s", lembrete["id"], tentativas, err)

    return {"due": len(vencidos), "sent": enviados, "given_up": desistidos}


async def _entregar(
    lembrete: dict, titulo: str = "⏰ Lembrete", alvo: str = "reminders", ref: str | None = None
) -> list[str]:
    """Tenta os canais pedidos. Push que falha não anula o WhatsApp.

    ⚠️ **O WhatsApp obedece ao portão do Perfil** (`profiles.alerts_whatsapp_enabled`, default
    `false` desde a `0052`), inclusive quando o lembrete pede esse canal explicitamente.

    Antes este job não lia flag nenhuma: ele buscava todo lembrete vencido e entregava pelo canal
    gravado na linha. Como a tela de lembrete nascia com `both`, criar um lembrete no app bastava
    para receber um template PAGO no WhatsApp — e o "Avisos financeiros no WhatsApp: desligado"
    do Perfil não valia nada aqui. Um interruptor que não desliga é pior que nenhum interruptor.

    O bloqueio nunca é silencioso: quando o WhatsApp era o único caminho, a entrega falha com
    motivo e o texto vai para `reminders.last_error`, que é onde se debuga isto.
    """
    settings = get_settings()
    canal = lembrete["channel"]
    quer_push = canal in ("push", "both")
    quer_whatsapp = canal in ("whatsapp", "both")
    pode_whatsapp = bool(lembrete.get("alerts_whatsapp_enabled"))

    delivered_channels: list[str] = []
    falhas: list[str] = []

    if quer_push and lembrete["expo_push_token"]:
        try:
            if ref:
                await push.send(lembrete["expo_push_token"], titulo, lembrete["title"], alvo, ref=ref)
            else:
                await push.send(lembrete["expo_push_token"], titulo, lembrete["title"], alvo)
            delivered_channels.append("push")
        except Exception as err:  # noqa: BLE001
            falhas.append(f"push: {err}")

    # O fallback (push pedido mas não entregue) era o caminho mais traiçoeiro: sem token de push
    # ele transformava `channel = 'push'` — o default, o canal "grátis" — em template pago.
    precisa_whatsapp = quer_whatsapp or (not delivered_channels and quer_push)

    if precisa_whatsapp and not pode_whatsapp:
        falhas.append("whatsapp: desligado no Perfil (alerts_whatsapp_enabled)")
    elif precisa_whatsapp and not lembrete["phone"]:
        falhas.append("whatsapp: perfil sem telefone verificado")
    elif precisa_whatsapp:
        try:
            await whatsapp.send_template(
                lembrete["phone"], settings.wa_reminder_template, [lembrete["title"]]
            )
            delivered_channels.append("whatsapp")
        except Exception as err:  # noqa: BLE001
            falhas.append(f"whatsapp: {err}")

    if not delivered_channels:
        raise RuntimeError(
            " | ".join(falhas) or "nenhum canal disponível (sem push token nem telefone)"
        )
    return delivered_channels
