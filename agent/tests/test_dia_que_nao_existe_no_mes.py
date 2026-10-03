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
        "end_date": None, "auto_confirm": True, "materialized_until": None, "timezone": "America/Sao_Paulo", "edit_revision": 1,
    }
    escritas, procuras = [], []

    async def fetch(sql, *args):
        return [serie] if "from public.recurring_transactions" in sql else []

    async def fetch_one(sql, *args):
        if args[5]:
            procuras.append(args[4])  # Atomic command attempts adoption only for past dates.
        adopted = args[4] == "2026-09-04"
        escritas.append("update adota" if adopted else "insert")
        return {"intent_current": True, "created": not adopted}

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


def _serie_fundacred():
    from uuid import uuid4

    return {
        "id": uuid4(), "user_id": uuid4(), "workspace_id": uuid4(), "kind": "expense",
        "amount_cents": 119885, "currency": "BRL", "category": "estudo", "description": "Fundacred",
        "merchant": None, "account_id": uuid4(), "rrule": "FREQ=MONTHLY;BYMONTHDAY=4",
        "next_run_at": datetime(2026, 10, 4, 12, tzinfo=UTC), "dtstart": datetime(2026, 10, 4, 12, tzinfo=UTC),
        "end_date": None, "auto_confirm": False, "materialized_until": None, "timezone": "America/Sao_Paulo", "edit_revision": 1,
    }


@pytest.mark.asyncio
async def test_dia_apagado_no_app_nao_volta_pelo_agendador(monkeypatch):
    """Apagou "só esta" (novembro): o calendário refeito não recria o dia (28/09/2026)."""
    from datetime import date

    from app.jobs import scheduler

    serie = _serie_fundacred()
    dias = []

    async def fetch(sql, *args):
        if "from public.recurring_transactions" in sql:
            return [serie]
        return [{"original_date": date(2026, 11, 4)}]

    async def one(sql, *args):
        dias.append(args[4])
        return {"intent_current": True, "created": True}

    async def execute(sql, *args):
        return 1

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    monkeypatch.setattr(scheduler.db, "execute", execute)
    monkeypatch.setattr(scheduler.db, "fetch_one", one)
    await scheduler.materialize_horizon(datetime(2026, 9, 28, 15, tzinfo=UTC), so_novas=True)
    assert "2026-11-04" not in dias
    assert "2026-10-04" in dias and "2026-12-04" in dias


@pytest.mark.asyncio
async def test_gemea_ja_adotada_pelo_app_nao_trava_a_serie(monkeypatch):
    """O app gravou o dia no toque antes da rodada: a adoção bate no unique e a série segue."""
    from psycopg.errors import UniqueViolation

    from app.jobs import scheduler

    serie = {**_serie_fundacred(), "next_run_at": datetime(2026, 9, 4, 12, tzinfo=UTC),
             "dtstart": datetime(2026, 9, 4, 12, tzinfo=UTC)}
    escritas = []

    async def fetch(sql, *args):
        return [serie] if "from public.recurring_transactions" in sql else []

    async def fetch_one(sql, *args):
        if args[4] == "2026-09-04":
            raise UniqueViolation("já existe")
        escritas.append("insert")
        return {"intent_current": True, "created": True}

    async def execute(sql, *args):
        if "recurring_id = %s where id" in sql:
            raise UniqueViolation("já existe")
        escritas.append(sql.split()[0])

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    monkeypatch.setattr(scheduler.db, "fetch_one", fetch_one)
    monkeypatch.setattr(scheduler.db, "execute", execute)
    await scheduler.materialize_horizon(datetime(2026, 9, 27, 15, tzinfo=UTC), so_novas=True)
    assert escritas.count("insert") == 12, "outubro em diante nasce normalmente"
    assert escritas[-1] == "update", "a série grava materialized_until em vez de last_error"


@pytest.mark.asyncio
async def test_so_o_espaco_da_conversa_quando_o_agente_pede(monkeypatch):
    """"paguei o aluguel" grava as séries NUNCA gravadas só daquele espaço (28/09/2026)."""
    from app.jobs import scheduler

    visto = {}

    async def fetch(sql, *args):
        visto["sql"], visto["args"] = sql, args
        return []

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    await scheduler.materialize_horizon(datetime(2026, 9, 28, 12, tzinfo=UTC), so_novas=True, workspace_id="w1")
    assert "r.workspace_id = %s::uuid" in visto["sql"]
    assert visto["args"][2:4] == ("w1", "w1")
    assert visto["args"][-2:] == (True, scheduler.MAX_NOVAS_POR_MINUTO)


@pytest.mark.asyncio
async def test_baixa_grava_as_ocorrencias_antes_de_procurar_e_falha_nao_derruba(monkeypatch):
    from app.graph import nodes
    from app.graph.schemas import FinanceAction, FinanceActionType
    from app.jobs import scheduler

    pedidos = []

    async def materializa(agora, so_novas=False, workspace_id=None):
        pedidos.append((so_novas, workspace_id))
        raise RuntimeError("banco fora")

    monkeypatch.setattr(scheduler, "materialize_horizon", materializa)
    await nodes._ocorrencias_gravadas("w1", [FinanceAction(type=FinanceActionType.MARK_PAID, description="aluguel")])
    assert pedidos == [(True, "w1")], "a falha é engolida: o turno segue como antes"
    await nodes._ocorrencias_gravadas("w1", [FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=100)])
    assert pedidos == [(True, "w1")], "criar gasto não procura ocorrência"
