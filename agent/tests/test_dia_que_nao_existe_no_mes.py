"""'todo dia 29/30/31' cai no último dia do mês curto, nunca pula o mês (27/09/2026).

A `dateutil` segue a RRULE ao pé da letra e pulava fevereiro inteiro em "todo dia 30" — o
agendador não gerava a linha e a projeção perdia a conta. O resto do sistema
(`private.day_in_month`) sempre caiu no último dia; aqui o agendador passa a concordar.
"""

from datetime import UTC, datetime

import pytest

from app.domain.recurrence import _dia_que_cabe, next_occurrence

TZ = "America/Sao_Paulo"


def _proximas(regra: str, inicio: datetime, n: int) -> list[str]:
    datas, cursor = [], inicio
    for _ in range(n):
        cursor = next_occurrence(regra, cursor, TZ, inicio)
        datas.append(cursor.astimezone(UTC).strftime("%d/%m/%Y"))
    return datas


@pytest.mark.parametrize(
    ("regra", "esperado"),
    [
        ("FREQ=MONTHLY;BYMONTHDAY=30", ["30/12/2026", "30/01/2027", "28/02/2027", "30/03/2027"]),
        ("FREQ=MONTHLY;BYMONTHDAY=29", ["29/12/2026", "29/01/2027", "28/02/2027", "29/03/2027"]),
        ("FREQ=MONTHLY;BYMONTHDAY=31", ["31/12/2026", "31/01/2027", "28/02/2027", "31/03/2027"]),
    ],
)
def test_fevereiro_nao_some(regra, esperado):
    inicio = datetime(2026, 11, 30, 12, tzinfo=UTC)
    assert _proximas(regra, inicio, 4) == esperado


def test_bissexto_cai_no_29():
    inicio = datetime(2027, 12, 30, 12, tzinfo=UTC)
    assert _proximas("FREQ=MONTHLY;BYMONTHDAY=30", inicio, 3) == ["30/01/2028", "29/02/2028", "30/03/2028"]


def test_anual_de_29_de_fevereiro_nao_pula_o_ano():
    inicio = datetime(2028, 2, 29, 12, tzinfo=UTC)
    assert _proximas("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", inicio, 2) == ["28/02/2029", "28/02/2030"]


def test_o_que_nao_muda():
    # dia comum, último dia (-1), lista de dias, semanal e regra que já usa BYSETPOS
    for regra in ["FREQ=MONTHLY;BYMONTHDAY=5", "FREQ=MONTHLY;BYMONTHDAY=-1",
                  "FREQ=MONTHLY;BYMONTHDAY=5,30", "FREQ=WEEKLY;BYDAY=MO",
                  "FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1"]:
        assert _dia_que_cabe(regra) == regra
    assert _dia_que_cabe("RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=30;COUNT=6") == (
        "RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=28,29,30;BYSETPOS=-1;COUNT=6"
    )


@pytest.mark.asyncio
async def test_cron_de_minuto_so_materializa_serie_nunca_materializada(monkeypatch):
    """Série nova não espera a rodada de hora em hora (27/09/2026, produção)."""
    from app.jobs import scheduler

    visto = {}

    async def fetch(sql, *args):
        visto["sql"], visto["args"] = sql, args
        return []

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    await scheduler.materialize_horizon(datetime(2026, 9, 27, 12, tzinfo=UTC), so_novas=True)
    assert "r.materialized_until is null" in visto["sql"]
    assert visto["args"][-2:] == (True, scheduler.MAX_NOVAS_POR_MINUTO)
    await scheduler.materialize_horizon(datetime(2026, 9, 27, 12, tzinfo=UTC))
    assert visto["args"][-2:] == (False, scheduler.MAX_SERIES_PER_RUN)


@pytest.mark.asyncio
async def test_serie_recriada_adota_o_mes_pago_em_vez_de_duplicar(monkeypatch):
    """Apagou a série (o setembro pago ficou) e recriou a partir de 04/09: não nasce outro 04/09."""
    from uuid import uuid4

    from app.jobs import scheduler

    serie = {
        "id": uuid4(), "user_id": uuid4(), "workspace_id": uuid4(), "kind": "expense",
        "amount_cents": 119885, "currency": "BRL", "category": "estudo", "description": "Fundacred",
        "merchant": None, "account_id": uuid4(), "rrule": "FREQ=MONTHLY;BYMONTHDAY=4",
        "next_run_at": datetime(2026, 9, 4, 12, tzinfo=UTC), "dtstart": datetime(2026, 9, 4, 12, tzinfo=UTC),
        "end_date": None, "auto_confirm": True, "materialized_until": None, "timezone": "America/Sao_Paulo",
    }
    escritas, procuras = [], []

    async def fetch(sql, *args):
        return [serie]

    async def fetch_one(sql, *args):
        procuras.append(args[4])  # o dia procurado
        return {"id": "setembro-antigo"} if args[4] == "2026-09-04" else None

    async def execute(sql, *args):
        escritas.append(sql.split()[0] + (" adota" if "recurring_id = %s where id" in sql else ""))

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    monkeypatch.setattr(scheduler.db, "fetch_one", fetch_one)
    monkeypatch.setattr(scheduler.db, "execute", execute)
    await scheduler.materialize_horizon(datetime(2026, 9, 27, 15, tzinfo=UTC), so_novas=True)

    assert escritas[0] == "update adota", "setembro já existia solto: é adotado"
    assert procuras == ["2026-09-04"], "só a ocorrência PASSADA procura gêmea"
    assert escritas.count("insert") == 12, "outubro/2026 a setembro/2027 nascem normalmente"


@pytest.mark.asyncio
async def test_reparo_tira_a_gerada_e_devolve_a_antiga_para_a_serie(monkeypatch):
    from app.jobs import scheduler

    ordem = []

    async def fetch(sql, *args):
        return [{"gerada": "nova-04-09", "solta": "antiga-04-09", "recurring_id": "serie"}]

    async def execute(sql, *args):
        ordem.append((sql.split()[0], args))

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    monkeypatch.setattr(scheduler.db, "execute", execute)
    assert await scheduler.reparar_gemeas() == 1
    # a gerada sai ANTES da adoção: o unique (recurring_id, occurred_at) recusaria o contrário
    assert ordem == [("delete", ("nova-04-09",)), ("update", ("serie", "antiga-04-09"))]
