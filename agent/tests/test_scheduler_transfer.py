"""F18: a transferência recorrente atravessa o agendador com o destino.

O check de `transactions` exige `counterparty_account_id` na transferência: se qualquer ponto do
caminho (gêmea candidata, insert, reparo de duplicata) esquecer o destino, a série morre com
`last_error` ou a adoção casa com a linha errada. Prende o TEXTO das consultas, que é onde regride.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app import db
from app.jobs import scheduler


def _sql_da_materializacao(monkeypatch) -> str:
    capturado: list[str] = []

    async def fetch_one(sql, *args):
        capturado.append(" ".join(sql.split()))
        return {"intent_current": True, "created": True}

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    return capturado  # type: ignore[return-value]


@pytest.mark.asyncio
async def test_a_ocorrencia_copia_e_compara_o_destino(monkeypatch):
    capturado = _sql_da_materializacao(monkeypatch)
    rec = {"id": "s", "edit_revision": 1, "rrule": "FREQ=MONTHLY;BYMONTHDAY=5", "dtstart": None}
    await scheduler._materialize_occurrence(rec, "2026-10-05", False)
    sql = capturado[0]
    # só a transferência tem destino; a versão sem a coluna cai na série
    assert "coalesce(v.counterparty_account_id, r.counterparty_account_id)" in sql
    assert "= 'transfer'" in sql
    # a gêmea solta só casa com o MESMO destino (senão adota a transferência de outra conta)
    assert "t.counterparty_account_id is not distinct from d.occurrence_counterparty" in sql
    # e o insert grava o destino, na mesma posição da coluna
    cols = [c.strip() for c in sql.split("insert into public.transactions (", 1)[1].split(")", 1)[0].split(",")]
    vals = [v.strip() for v in sql.split("select d.user_id,", 1)[1].split(" from dated d", 1)[0].split(",")]
    campos = ["d.user_id", *vals]
    assert cols.index("counterparty_account_id") == cols.index("account_id") + 1
    assert campos[cols.index("counterparty_account_id")] == "d.occurrence_counterparty"


@pytest.mark.asyncio
async def test_o_reparo_de_gemeas_compara_o_destino(monkeypatch):
    vistas: list[str] = []

    async def fetch(sql, *args):
        vistas.append(" ".join(sql.split()))
        return []

    monkeypatch.setattr(db, "fetch", fetch)
    assert await scheduler.reparar_gemeas() == 0
    assert "o.counterparty_account_id is not distinct from g.counterparty_account_id" in vistas[0]


@pytest.mark.asyncio
async def test_transferencia_antiga_sem_destino_nao_materializa(monkeypatch):
    vistas: list[str] = []

    async def fetch(sql, *args):
        vistas.append(" ".join(sql.split()))
        return []

    monkeypatch.setattr(db, "fetch", fetch)
    await scheduler.materialize_horizon(datetime(2026, 10, 5, 12, tzinfo=UTC))
    assert "not (r.kind = 'transfer' and r.counterparty_account_id is null)" in vistas[0]
