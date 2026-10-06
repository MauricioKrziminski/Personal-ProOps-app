"""`db.unidade_de_trabalho`: UMA conexão e UMA transação para tudo que roda dentro do bloco.

Com dublê de conexão: o que se prova aqui é a ENCANAÇÃO (quem usa qual conexão, quando abre
savepoint, quando o claim volta). O comportamento no Postgres real está em
`test_unidade_de_trabalho_integracao.py` (opt-in).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest

from app import db
from app.db import unidade_de_trabalho as unidade_real  # a fixture autouse troca `db.unidade_de_trabalho`


class _Cur:
    rowcount = 1

    async def fetchall(self):
        return [{"v": ""}]

    async def fetchone(self):
        return {"v": ""}


class _Conn:
    def __init__(self, log):
        self.log = log
        self.fundo = 0

    @asynccontextmanager
    async def transaction(self):
        self.log.append("savepoint" if self.fundo else "begin")
        self.fundo += 1
        try:
            yield
        except BaseException:
            self.log.append("rollback")
            raise
        else:
            self.log.append("commit")
        finally:
            self.fundo -= 1

    async def execute(self, sql, args=()):
        self.log.append(sql)
        return _Cur()


class _Pool:
    def __init__(self, log):
        self.log = log
        self.aberturas = 0

    @asynccontextmanager
    async def connection(self):
        self.aberturas += 1
        yield _Conn(self.log)


@pytest.mark.asyncio
async def test_tudo_dentro_usa_a_mesma_conexao_e_commita_uma_vez(monkeypatch):
    log: list = []
    pool = _Pool(log)
    monkeypatch.setattr(db, "pool", lambda: pool)
    async with unidade_real():
        await db.execute("insert 1")
        await db.fetch("select 1")
        await db.fetch_one("select 2")
    assert pool.aberturas == 1
    assert log == ["begin", "insert 1", "select 1", "select 2", "commit"]


@pytest.mark.asyncio
async def test_fora_da_unidade_cada_comando_pega_a_sua_conexao(monkeypatch):
    log: list = []
    pool = _Pool(log)
    monkeypatch.setattr(db, "pool", lambda: pool)
    await db.execute("a")
    await db.fetch("b")
    assert pool.aberturas == 2


@pytest.mark.asyncio
async def test_erro_desfaz_e_a_contextvar_e_devolvida(monkeypatch):
    log: list = []
    monkeypatch.setattr(db, "pool", lambda: _Pool(log))
    with pytest.raises(RuntimeError):
        async with unidade_real():
            await db.execute("insert 1")
            raise RuntimeError("boom")
    assert log == ["begin", "insert 1", "rollback"]
    assert db._uow.get() is None


@pytest.mark.asyncio
async def test_aninhada_vira_savepoint_e_so_o_de_dentro_volta(monkeypatch):
    log: list = []
    pool = _Pool(log)
    monkeypatch.setattr(db, "pool", lambda: pool)
    async with unidade_real():
        await db.execute("a")
        with pytest.raises(ValueError):
            async with unidade_real():
                await db.execute("b")
                raise ValueError
        await db.execute("c")
    assert pool.aberturas == 1
    assert log == ["begin", "a", "savepoint", "b", "rollback", "c", "commit"]


@pytest.mark.asyncio
async def test_como_usuario_dentro_da_unidade_usa_savepoint_e_devolve_o_claim(monkeypatch):
    log: list = []
    pool = _Pool(log)
    monkeypatch.setattr(db, "pool", lambda: pool)
    async with unidade_real():
        async with db.como_usuario(uuid4()) as tx:
            await tx.execute("rpc")
    assert pool.aberturas == 1  # a MESMA conexão: o claim é local à transação da unidade
    ordem = [
        "begin", "current_setting", "savepoint", "set_config", "rpc", "commit", "set_config", "commit",
    ]
    assert [next((k for k in ordem if k in e), e) for e in log] == ordem
    # o claim anterior ("") volta ANTES do commit da unidade: não vaza para a tool seguinte
    assert log[-2].startswith("select set_config")


@pytest.mark.asyncio
async def test_como_usuario_que_falha_dentro_da_unidade_nao_mata_a_unidade(monkeypatch):
    log: list = []
    monkeypatch.setattr(db, "pool", lambda: _Pool(log))
    async with unidade_real():
        with pytest.raises(ValueError):
            async with db.como_usuario(uuid4()):
                raise ValueError
        await db.execute("depois")
    assert "rollback" in log and "depois" in log and log[-1] == "commit"
