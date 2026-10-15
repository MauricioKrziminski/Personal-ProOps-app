"""A corrida pendente x pendente contra um Postgres REAL, com duas conexões — opt-in, SÓ no Postgres LOCAL.

    SQL_TEST_LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
        .venv/bin/pytest tests/test_captures_corrida_integracao.py

Sem a variável PULA. Com ela, a URL tem que ser local (127.0.0.1/localhost): nunca staging nem produção.
Cria um usuário/espaço descartáveis e remove tudo pelo id no fim.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app import db
from app.db import unidade_de_trabalho as unidade_real  # o conftest troca a de `db` por um dublê
from app.routes import captures
from app.routes.finance_draft import RascunhoOut

URL = os.environ.get("SQL_TEST_LOCAL_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="opt-in: defina SQL_TEST_LOCAL_DATABASE_URL (Postgres local)")


@pytest.mark.asyncio
async def test_duas_conexoes_da_mesma_compra_viram_pendente_e_duplicada(monkeypatch):
    assert any(h in URL for h in ("127.0.0.1", "localhost")), "recusado: só Postgres local"
    pool = AsyncConnectionPool(
        URL, min_size=2, max_size=4, timeout=10, open=False,
        kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None},
    )
    await pool.open()
    monkeypatch.setattr(db, "_pool", pool)
    monkeypatch.setattr(db, "unidade_de_trabalho", unidade_real)
    u, w = uuid4(), uuid4()
    quando = datetime(2026, 10, 12, 15, 30, tzinfo=timezone.utc)
    try:
        await db.execute("insert into auth.users(id, email) values (%s, %s)", u, f"{u}@example.invalid")
        await db.execute("insert into public.profiles(id) values (%s) on conflict do nothing", u)
        await db.execute("insert into public.workspaces(id, owner_id, name) values (%s, %s, 'corrida')", w, u)
        externos = [f"corrida-{i}-{u}"[:100] for i in (1, 2)]
        reservas = []
        for ext in externos:
            r = await db.fetch_one(
                """insert into public.captured_notifications (workspace_id, user_id, external_id, bank, posted_at, status)
                   values (%s, %s, %s, 'Nubank', %s, 'processing') returning id""",
                w, u, ext, quando)
            reservas.append(str(r["id"]))
        rascunho = RascunhoOut(tipo="uma", params={"kind": "expense"}, perguntas=[], entendido="Gasto de R$ 45,90")
        acao = {"type": "create_expense", "amount_cents": 4590, "description": "mercado"}
        for rodada in range(5):  # várias rodadas: a corrida é de tempo, uma só poderia passar por sorte
            await db.execute("update public.captured_notifications set status = 'processing', draft = null, kind = null,"
                             " amount_cents = null where workspace_id = %s", w)
            await asyncio.gather(*[
                captures._guardar(w, reserva, captures.NotificacaoIn(
                    external_id=ext, package="com.nu.production", title="t",
                    text="Compra de R$ 45,90 aprovada", posted_at=quando), "Nubank", rascunho, acao, quando.date())
                for ext, reserva in zip(externos, reservas)
            ])
            status = sorted(r["status"] for r in await db.fetch(
                "select status from public.captured_notifications where workspace_id = %s", w))
            assert status == ["duplicate", "pending"], (rodada, status)
    finally:
        await db.execute("delete from public.workspaces where id = %s", w)
        await db.execute("delete from public.profiles where id = %s", u)
        await db.execute("delete from auth.users where id = %s", u)
        await pool.close()
