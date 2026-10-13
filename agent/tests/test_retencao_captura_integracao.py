"""A regra de retenção de `captured_notifications` contra um Postgres REAL — opt-in.

    SQL_TEST_DATABASE_URL=<url do STAGING> .venv/bin/pytest tests/test_retencao_captura_integracao.py

Sem a variável o teste PULA. Com ela, só o staging (a mesma trava de `scripts/sql-test.py`), numa
transação que SEMPRE volta (`rollback` num `finally`, sem a conexão como context manager, que
commitaria na saída). Roda o MESMO SQL que `retencao.run` monta, com a condição de `_REGRAS`.
"""

from __future__ import annotations

import os
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from app.jobs import retencao

URL = os.environ.get("SQL_TEST_DATABASE_URL", "")
STAGING_REF = "utkqoiigimqzeenxkxdl"

pytestmark = pytest.mark.skipif(not URL, reason="opt-in: defina SQL_TEST_DATABASE_URL (staging)")


def test_retencao_apaga_so_o_que_venceu_e_o_de_quem_saiu():
    assert STAGING_REF in URL, "recusado: SQL_TEST_DATABASE_URL não é o staging"
    (_, tabela, cond), = [r for r in retencao._REGRAS if r[0] == "captured_notifications"]
    con = psycopg.connect(URL, autocommit=False, row_factory=dict_row)
    try:
        u, saiu, w = uuid4(), uuid4(), uuid4()
        con.execute("insert into auth.users(id, email) values (%s, %s), (%s, %s)",
                    (u, f"{u}@example.invalid", saiu, f"{saiu}@example.invalid"))
        con.execute("insert into public.profiles(id) values (%s), (%s) on conflict (id) do nothing", (u, saiu))
        con.execute("insert into public.workspaces(id, owner_id, name) values (%s, %s, 'Retenção')", (w, u))
        con.execute("insert into public.workspace_members(workspace_id, user_id, role) values (%s, %s, 'owner')",
                    (w, u))
        rascunho = '{"tipo":"uma","params":{},"perguntas":[]}'

        def cap(nome, status, dias, quem=u, draft=None):
            con.execute(
                """insert into public.captured_notifications
                     (workspace_id, user_id, external_id, bank, posted_at, status, draft, updated_at)
                   values (%s, %s, %s, 'Nubank', now() - make_interval(days => %s), %s, %s::jsonb,
                           now() - make_interval(days => %s))""",
                (w, quem, f"ret-{nome}-{w}", dias, status, draft, dias))
            return f"ret-{nome}-{w}"

        fica = [cap("pendente-velha", "pending", 90, draft=rascunho),
                cap("duplicada-nova", "duplicate", 10, draft=rascunho),
                cap("confirmada-nova", "confirmed", 10),
                cap("reserva-viva", "processing", 0)]
        sai = [cap("confirmada-velha", "confirmed", 31), cap("descartada-velha", "discarded", 31),
               cap("ignorada-velha", "ignored", 31), cap("duplicada-velha", "duplicate", 31, draft=rascunho),
               cap("reserva-abandonada", "processing", 2),
               cap("de-quem-saiu", "pending", 0, quem=saiu, draft=rascunho)]

        con.execute(f"delete from {tabela} where ctid = any(array("
                    f"select ctid from {tabela} where {cond} limit %s))", (retencao.TETO_POR_TABELA,))
        restam = {r["external_id"] for r in con.execute(
            "select external_id from public.captured_notifications where workspace_id = %s", (w,))}
        assert restam == set(fica), (restam ^ set(fica), sai)
    finally:
        con.rollback()
        con.close()
