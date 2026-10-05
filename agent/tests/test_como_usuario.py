"""`db.como_usuario`: o claim é setado ANTES da RPC, na MESMA transação, e é local."""

from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest

from app import db


class _Cur:
    rowcount = 1

    async def fetchall(self):
        return [{"ok": True}]


class _Conn:
    def __init__(self, log):
        self.log = log

    @asynccontextmanager
    async def transaction(self):
        self.log.append("begin")
        try:
            yield
        finally:
            self.log.append("end")

    async def execute(self, sql, args=()):
        self.log.append((sql, tuple(args)))
        return _Cur()


class _Pool:
    def __init__(self, log):
        self.log = log

    @asynccontextmanager
    async def connection(self):
        yield _Conn(self.log)


@pytest.mark.asyncio
async def test_claim_local_antes_da_rpc_na_mesma_transacao(monkeypatch):
    log: list = []
    monkeypatch.setattr(db, "pool", lambda: _Pool(log))
    uid = uuid4()
    async with db.como_usuario(uid) as tx:
        row = await tx.fetch_one("select public.spending_change(%s)", "x")
    assert row == {"ok": True}
    assert log[0] == "begin"
    sql, args = log[1]
    assert "set_config('request.jwt.claim.sub'" in sql and sql.rstrip().endswith("true)")
    assert args == (str(uid),)
    assert log[2] == ("select public.spending_change(%s)", ("x",))
    assert log[-1] == "end"  # a RPC rodou ANTES de a transação (e o claim local) fechar


@pytest.mark.asyncio
async def test_claim_nao_vaza_para_o_proximo_bloco(monkeypatch):
    log: list = []
    monkeypatch.setattr(db, "pool", lambda: _Pool(log))
    async with db.como_usuario(uuid4()):
        pass
    async with db.como_usuario(uuid4()) as tx:
        await tx.execute("select 1")
    # cada bloco refaz o set_config dentro da sua própria transação
    assert [e for e in log if e in ("begin", "end")] == ["begin", "end", "begin", "end"]
    assert sum(1 for e in log if isinstance(e, tuple) and "set_config" in e[0]) == 2
