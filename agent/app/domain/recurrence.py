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


# RRULE → português. Espelha `src/lib/rrule-text.ts` PALAVRA POR PALAVRA: a mesma série é
# descrita no card do app e na resposta do WhatsApp, e duas redações para a mesma regra são
# duas coisas que o usuário precisa reconciliar sozinho. `rrule_text.test.ts` prende o lado do
# app; `tests/test_recurrence_text.py` prende este.
DIAS_DA_SEMANA = {
    "MO": "segunda", "TU": "terça", "WE": "quarta", "TH": "quinta",
    "FR": "sexta", "SA": "sábado", "SU": "domingo",
}
CADA = {"DAILY": "todo dia", "WEEKLY": "toda semana", "MONTHLY": "todo mês", "YEARLY": "todo ano"}
UNIDADE = {"DAILY": "dias", "WEEKLY": "semanas", "MONTHLY": "meses", "YEARLY": "anos"}


def _lista_pt(itens: list[str]) -> str:
    """["a"] -> "a"; ["a","b"] -> "a e b"; ["a","b","c"] -> "a, b e c"."""
    if len(itens) <= 1:
        return itens[0] if itens else ""
    return f"{', '.join(itens[:-1])} e {itens[-1]}"


def descreve_rrule(rrule: str | None) -> str:
    """Descrição curta e minúscula da regra.

    Regra que não souber interpretar VOLTA COMO VEIO: mostrar `FREQ=MONTHLY;BYMONTHDAY=5` é
    feio, mas mentir sobre quando o lançamento cai é pior — e é dinheiro.
    """
    if not rrule or not rrule.strip():
        return "sem recorrência"

    partes: dict[str, str] = {}
    for pedaco in rrule.strip().removeprefix("RRULE:").removeprefix("rrule:").split(";"):
        chave, _, valor = pedaco.partition("=")
        if chave and valor:
            partes[chave.strip().upper()] = valor.strip().upper()

    freq = partes.get("FREQ")
    if not freq or freq not in CADA:
        return rrule.strip()

    try:
        intervalo = int(partes.get("INTERVAL", "1"))
    except ValueError:
        intervalo = 1
    base = f"a cada {intervalo} {UNIDADE[freq]}" if intervalo > 1 else CADA[freq]

    if freq == "WEEKLY" and partes.get("BYDAY"):
        crus = [d.lstrip("+-0123456789") for d in partes["BYDAY"].split(",") if d]
        dias = [DIAS_DA_SEMANA[d] for d in crus if d in DIAS_DA_SEMANA]
        if dias:
            if intervalo > 1:
                return f"{base}, {_lista_pt(dias)}"
            # concordância: "toda segunda" (feira, feminino), mas "todo sábado"/"todo domingo"
            artigo = "todo" if crus[0] in ("SA", "SU") else "toda"
            return f"{artigo} {_lista_pt(dias)}"

    if freq == "MONTHLY" and partes.get("BYMONTHDAY"):
        dias = [d for d in partes["BYMONTHDAY"].split(",") if d]
        if dias:
            return f"{base}, no dia {_lista_pt(dias)}" if intervalo > 1 else f"todo dia {_lista_pt(dias)}"

    return base
