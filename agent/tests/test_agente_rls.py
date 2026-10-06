"""`AGENTE_RLS`: a tool roda sob `authenticated`; reserva e carimbo ficam como `postgres`. Desligada, nada muda."""

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app import db
from app.graph.schemas import FinanceAction, FinanceActionType, FinanceQuery, FinanceQueryType
from app.tools import registry
from app.tools.base import ExecContext, ToolResult

CRIA = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500, description="mercado")
LE = FinanceQuery(type=FinanceQueryType.QUERY_BALANCE)


def _ctx():
    return ExecContext("u1", "w", None, "America/Sao_Paulo", "gastei 45", "wamid.rls")


@pytest.fixture
def ordem(monkeypatch):
    passos: list[str] = []

    async def reserve(*a, **k):
        passos.append("reserve")
        return True

    async def confirm(msg, indice, result_id):
        passos.append("confirm")

    @asynccontextmanager
    async def sob_rls(user_id):
        passos.append(f"rls+:{user_id}")
        yield
        passos.append("rls-")

    async def dono(*a, **k):
        return None

    monkeypatch.setattr(registry.db, "reserve_execution", reserve)
    monkeypatch.setattr(registry.db, "confirm_execution", confirm)
    monkeypatch.setattr(registry.db, "sob_rls", sob_rls)
    monkeypatch.setattr(registry, "ensure_owned", dono)

    async def escreve(ctx, acao):
        passos.append("tool")
        return ToolResult("ok", result_id="r1")

    async def le(ctx, acao):
        passos.append("tool")
        return ToolResult("ok", read_only=True)

    monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.CREATE_EXPENSE, escreve)
    monkeypatch.setitem(registry.QUERY_TOOLS, FinanceQueryType.QUERY_BALANCE, le)
    return passos


def _flag(monkeypatch, ligada):
    monkeypatch.setattr(registry, "get_settings", lambda: SimpleNamespace(agente_rls=ligada))


@pytest.mark.asyncio
async def test_escrita_reserva_como_postgres_tool_sob_rls_carimbo_como_postgres(monkeypatch, ordem):
    _flag(monkeypatch, True)
    await registry.execute(_ctx(), CRIA)
    assert ordem == ["reserve", "rls+:u1", "tool", "rls-", "confirm"]


@pytest.mark.asyncio
async def test_consulta_sob_rls_quando_ligada(monkeypatch, ordem):
    _flag(monkeypatch, True)
    await registry.execute(_ctx(), LE)
    assert ordem == ["rls+:u1", "tool", "rls-"]


@pytest.mark.asyncio
async def test_desligada_nada_muda(monkeypatch, ordem):
    _flag(monkeypatch, False)
    await registry.execute(_ctx(), CRIA)
    await registry.execute(_ctx(), LE)
    assert ordem == ["reserve", "tool", "confirm", "tool"]


@pytest.mark.asyncio
async def test_sob_rls_exige_unidade_de_trabalho():
    with pytest.raises(RuntimeError):
        async with db.sob_rls("u1"):
            pass


class _Conn:
    def __init__(self):
        self.sql: list[str] = []

    async def execute(self, sql, args=None):
        self.sql.append(" ".join(sql.split()))


@pytest.mark.asyncio
async def test_sob_rls_papel_claims_e_volta_a_postgres():
    conn = _Conn()
    marca = db._uow.set(conn)
    try:
        async with db.sob_rls("u1"):
            assert db.rls_ativo()
        assert not db.rls_ativo()
    finally:
        db._uow.reset(marca)
    assert conn.sql[0] == "set local role authenticated"
    assert "request.jwt.claim.sub" in conn.sql[1] and "request.jwt.claims" in conn.sql[1]
    assert conn.sql[2] == "reset role"


def test_por_usuario_escolhe_wrapper_sob_rls_e_interna_fora():
    assert db.por_usuario("budgets_status", "u", "2026-10-06") == (
        "select * from public._budgets_status(%s, %s)", "u", "2026-10-06")
    assert db.por_usuario("account_balances", "u") == ("select * from public._account_balances(%s)", "u")
    marca = db._rls.set(True)
    try:
        assert db.por_usuario("budgets_status", "u", "2026-10-06") == (
            "select * from public.budgets_status(%s)", "2026-10-06")
        assert db.por_usuario("account_balances", "u") == ("select * from public.account_balances()",)
    finally:
        db._rls.reset(marca)
