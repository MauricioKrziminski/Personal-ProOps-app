"""RRULE no calendário do usuário.

"todo dia 5" tem que cair no dia 5 DELE, não no dia 5 em UTC — para quem está em
GMT-3 isso seria dia 4 às 21h. Com zoneinfo dá para expandir a regra direto em
datetimes aware, sem o truque de "hora de parede fingindo ser UTC" que o rrule.js
obrigava no Deno.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta

from dateutil.rrule import rrulestr

from app.domain.dates import UTC, now_utc, tz

log = logging.getLogger(__name__)

# "todo dia 30" num mês sem dia 30. A RRULE ao pé da letra PULA o mês (a `dateutil` dá 30/01,
# 30/03 — fevereiro some, e com ele o aluguel da projeção), enquanto o resto do sistema cai no
# último dia (`private.day_in_month`: vencimento de cartão, parcela de dívida, a projeção além do
# horizonte). 27/09/2026. A regra GRAVADA não muda: a troca é só na hora de expandir, por
# `BYMONTHDAY=28,…,N;BYSETPOS=-1` — "o último destes dias que existir no mês". Um dia só; lista
# de dias ("5,30", do lembrete) fica como está.
_DIA_ALTO = re.compile(r"(?<![^;:])BYMONTHDAY=(29|30|31)(?=;|$)")


def _dia_que_cabe(regra: str) -> str:
    if "BYSETPOS" in regra or not re.search(r"FREQ=(MONTHLY|YEARLY)", regra):
        return regra
    return _DIA_ALTO.sub(
        lambda m: "BYMONTHDAY=" + ",".join(str(d) for d in range(28, int(m.group(1)) + 1)) + ";BYSETPOS=-1",
        regra,
    )


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
            _dia_que_cabe(recurrence if recurrence.startswith("RRULE:") else f"RRULE:{recurrence}"),
            dtstart=base,
        )
        proxima = regra.after(depois, inc=False)
    except (ValueError, TypeError) as err:
        log.warning("RRULE inválida %r: %s", recurrence, err)
        return None

    return proxima.astimezone(UTC) if proxima else None


def primeira_da_recorrencia(recurrence: str | None, occurred_at: str | None, timezone_name: str) -> datetime | None:
    """A primeira ocorrência de um LANÇAMENTO que se repete, em UTC (14/10/2026): a da regra no dia do
    lançamento ou a seguinte. A data dita NÃO é puxada para hoje: o que veio entre ela e hoje a pessoa
    contou que aconteceu (a série nasce nela e o agendador grava essas ocorrências). Sem data dita o dia é HOJE, o literal de todo
    lançamento ("gastei 30 de uber e repete todo mês" = o de hoje é o primeiro). Partir de "a próxima
    a partir de agora" fazia a mesma frase dar 14/10 ou 14/11 conforme o modelo preenchia a data."""
    agora = now_utc()
    local = agora.astimezone(tz(timezone_name))
    try:
        dia = date.fromisoformat((occurred_at or "")[:10]) if occurred_at else local.date()
    except ValueError:
        dia = local.date()
    inicio = datetime.combine(dia, local.timetz())
    return next_occurrence(recurrence, inicio - timedelta(seconds=1), timezone_name, dtstart=inicio)


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
        # `-1` é "último dia do mês" na RRULE, e é diferente de "dia 31": fevereiro não tem 31.
        # Sem este ramo a frase saía **"todo dia -1"** no WhatsApp enquanto o app escrevia "todo
        # último dia do mês". `-1` agora vem da escolha explícita no calendário; tocar no número
        # 31 conserva `BYMONTHDAY=31`. Espelha `src/lib/rrule-text.ts`.
        if dias == ["-1"]:
            return f"{base}, no último dia do mês" if intervalo > 1 else "todo último dia do mês"
        if dias:
            return f"{base}, no dia {_lista_pt(dias)}" if intervalo > 1 else f"todo dia {_lista_pt(dias)}"

    return base


def em_pausa(dia, de, ate) -> bool:
    """A mesma régua de `private.em_pausa` (SQL) e `emPausa` (app): período [de, até)."""
    if de is None or ate is None:
        return False
    d = dia if isinstance(dia, date) else date.fromisoformat(dia)
    return de <= d < ate


def dias_ate_hoje(recurrence: str, primeira: datetime, timezone_name: str) -> list[date]:
    """Dias (locais) da regra, da `primeira` até HOJE inclusive: as ocorrências que já aconteceram."""
    hoje = now_utc().astimezone(tz(timezone_name)).date()
    dias, cursor = [], primeira - timedelta(seconds=1)
    while len(dias) < 400:
        occ = next_occurrence(recurrence, cursor, timezone_name, primeira)
        if occ is None or (dia := occ.astimezone(tz(timezone_name)).date()) > hoje:
            break
        dias.append(dia)
        cursor = occ
    return dias
