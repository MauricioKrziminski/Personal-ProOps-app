"""`db.unidade_de_trabalho` contra um Postgres REAL — opt-in.

    SQL_TEST_DATABASE_URL=<url do STAGING> .venv/bin/pytest tests/test_unidade_de_trabalho_integracao.py

Sem a variável o teste PULA (o pytest padrão não fala com rede). Com ela, a URL tem que ser a do
staging (mesma trava de `scripts/sql-test.py`) e o teste só toca uma TABELA TEMPORÁRIA da própria
conexão: nenhuma tabela do produto é lida ou escrita, e o pool tem UMA conexão, que fecha no fim
(a tabela some com a sessão). O `commit` que a unidade faz é, portanto, um commit numa temp table.

Pool de tamanho 1 prova a mesma coisa que o resto prova: se `execute` dentro da unidade (ou o
`como_usuario`) pedisse outra conexão ao pool, travaria e o timeout reprovaria o teste.
"""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app import db
from app.db import unidade_de_trabalho as unidade_real

URL = os.environ.get("SQL_TEST_DATABASE_URL", "")
STAGING_REF = "utkqoiigimqzeenxkxdl"

pytestmark = pytest.mark.skipif(not URL, reason="opt-in: defina SQL_TEST_DATABASE_URL (staging)")


class _Boom(Exception):
    pass


async def _linhas() -> int:
    return (await db.fetch_one("select count(*) as n from _uow_t"))["n"]


@pytest.mark.asyncio
async def test_unidade_enxerga_o_que_escreveu_e_o_rollback_desfaz(monkeypatch):
    assert STAGING_REF in URL, "recusado: SQL_TEST_DATABASE_URL não é o staging"
    pool = AsyncConnectionPool(
        URL, min_size=1, max_size=1, timeout=5, open=False,
        kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None},
    )
    await pool.open()
    monkeypatch.setattr(db, "_pool", pool)
    try:
        await db.execute("create temp table _uow_t (n int)")

        # rollback: a escrita some, e dentro da unidade ela era visível (mesma conexão)
        with pytest.raises(_Boom):
            async with unidade_real():
                await db.execute("insert into _uow_t values (1)")
                assert await _linhas() == 1
                raise _Boom
        assert await _linhas() == 0

        # savepoint: só o bloco de dentro volta
        async with unidade_real():
            await db.execute("insert into _uow_t values (1)")
            with pytest.raises(_Boom):
                async with unidade_real():
                    await db.execute("insert into _uow_t values (2)")
                    raise _Boom
            assert await _linhas() == 1
        assert await _linhas() == 1  # commitou

        # como_usuario dentro da unidade: mesma conexão, claim visível e DEVOLVIDO na saída
        uid = str(uuid4())
        sql_claim = "select current_setting('request.jwt.claim.sub', true) as v"
        async with unidade_real():
            async with db.como_usuario(uid) as tx:
                assert (await tx.fetch_one(sql_claim))["v"] == uid
                await tx.execute("insert into _uow_t values (3)")
            assert ((await db.fetch_one(sql_claim))["v"] or "") == ""
        assert await _linhas() == 2

        # recusa dentro do como_usuario volta só o savepoint dele; a unidade segue e commita
        async with unidade_real():
            with pytest.raises(_Boom):
                async with db.como_usuario(uid) as tx:
                    await tx.execute("insert into _uow_t values (4)")
                    raise _Boom
            await db.execute("insert into _uow_t values (5)")
        assert await _linhas() == 3
    finally:
        await pool.close()
