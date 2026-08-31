"""RRULE no calendário do usuário.

"todo dia 5" tem que cair no dia 5 DELE, não no dia 5 em UTC — para quem está em
GMT-3 isso seria dia 4 às 21h. Com zoneinfo dá para expandir a regra direto em
datetimes aware, sem o truque de "hora de parede fingindo ser UTC" que o rrule.js
obrigava no Deno.
"""

from __future__ import annotations

import logging
from datetime import datetime

from dateutil.rrule import rrulestr

from app.domain.dates import UTC, tz

log = logging.getLogger(__name__)


def next_occurrence(
    recurrence: str | None,
    after: datetime,
    timezone_name: str,
    dtstart: datetime | None = None,
) -> datetime | None:
    """Próxima ocorrência DEPOIS de `after` (exclusive), em UTC.

    `dtstart` ancora a série: passe o next_run_at atual para preservar a hora
    original. Sem âncora, a hora do lembrete vira o minuto em que o cron rodou.
    """
    if not recurrence:
        return None

    zone = tz(timezone_name)
    base = (dtstart or after).astimezone(zone)
    depois = after.astimezone(zone)

    try:
        regra = rrulestr(
            recurrence if recurrence.startswith("RRULE:") else f"RRULE:{recurrence}",
            dtstart=base,
        )
        proxima = regra.after(depois, inc=False)
    except (ValueError, TypeError) as err:
        log.warning("RRULE inválida %r: %s", recurrence, err)
        return None

    return proxima.astimezone(UTC) if proxima else None
