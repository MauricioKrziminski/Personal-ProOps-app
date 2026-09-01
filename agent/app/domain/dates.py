"""Datas no fuso do usuário.

O container roda em UTC. `date.today()` devolve o dia ERRADO para quem está em
GMT-3 depois das 21h — um gasto lançado às 22h de segunda vira terça. Tudo que
envolve "que dia é hoje para este usuário" passa por aqui.

Porte de _shared/datetime.ts, mas usando zoneinfo (stdlib) em vez da ginástica
com Intl que o Deno exigia.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc


DEFAULT_TZ = "America/Sao_Paulo"


def tz(name: str | None = None) -> ZoneInfo:
    """Fuso do profile, com queda para America/Sao_Paulo (e depois UTC).

    Evita que timezone vazio ou container em UTC gere data do dia anterior
    em lançamentos perto da meia-noite.
    """
    if not name or name == "UTC":
        return ZoneInfo(DEFAULT_TZ)
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def now_utc() -> datetime:
    return datetime.now(UTC)


def local_now(timezone_name: str, instant: datetime | None = None) -> datetime:
    return (instant or now_utc()).astimezone(tz(timezone_name))


def local_iso_date(timezone_name: str, instant: datetime | None = None) -> str:
    """YYYY-MM-DD no fuso do usuário."""
    return local_now(timezone_name, instant).date().isoformat()


def local_datetime_iso(timezone_name: str, instant: datetime | None = None) -> str:
    """"2026-08-30T21:43:57-03:00" — é isto que vai no prompt.

    Mandar o "agora" em UTC obriga o modelo a fazer a conta do fuso sozinho para
    resolver "hoje"/"ontem", e ele erra perto da meia-noite.
    """
    return local_now(timezone_name, instant).isoformat(timespec="seconds")


def to_instant(value: str | None, timezone_name: str, fallback: datetime | None = None) -> datetime:
    """Datetime vindo do modelo -> instante absoluto.

    O prompt pede a hora LOCAL do usuário. Quando o modelo devolve sem offset
    ("2026-08-27T09:00:00"), o Postgres leria como UTC e o lembrete dispararia
    3h mais cedo. Aqui o offset do fuso é carimbado.
    """
    fb = fallback or now_utc()
    raw = (value or "").strip()
    if not raw:
        return fb

    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    if "T" not in raw:
        raw = f"{raw}T00:00:00"

    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return fb

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz(timezone_name))
    return parsed.astimezone(UTC)


def format_date_br(value: str | date | None) -> str:
    """ISO -> 28/08/2026.

    Uma grafia só no produto inteiro. Hífen (28-08-2026) lembra ISO, que é como o
    dado é ARMAZENADO, não como se lê — regra registrada em frontend.md.
    """
    if value is None:
        return ""
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    partes = str(value)[:10].split("-")
    if len(partes) != 3:
        return str(value)
    ano, mes, dia = partes
    return f"{dia}/{mes}/{ano}"


def add_months(value: str | date, n: int) -> str:
    """Soma (ou subtrai) meses preservando o dia quando ele couber.

    Espelha `private.add_months` da `0013` de propósito: é ela que gera as datas
    das parcelas, e as duas pontas precisam concordar sobre em que MÊS cada
    parcela cai. 31/01 + 1 mês = 28/02, como no banco.

    Não é perfeitamente reversível quando o dia é clampado (31/05 → -3 meses →
    28/02 → +3 meses → 28/05), mas o MÊS sempre volta certo — e é o mês que
    decide a fatura.
    """
    d = value if isinstance(value, date) else date.fromisoformat(str(value))
    total = d.year * 12 + (d.month - 1) + n
    ano, mes = divmod(total, 12)
    ultimo = monthrange(ano, mes + 1)[1]
    return date(ano, mes + 1, min(d.day, ultimo)).isoformat()
