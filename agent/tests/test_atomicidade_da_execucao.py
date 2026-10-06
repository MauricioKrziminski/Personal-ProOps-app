"""A3: reserva + escrita + carimbo do `result_id` são UMA unidade de trabalho; o par também.

Só o banco e as tools são dublês (a unidade vem da fixture `unidade`, que conta commit/rollback).
A prova no Postgres real está em `test_unidade_de_trabalho_integracao.py`.
"""

import pytest

from app.graph import nodes
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import registry
from app.tools.base import ExecContext, ToolResult
from app.tools.guards import Level1Error

ALVO = {"table": "transactions", "status": "found",
        "candidates": [{"id": "tx-w", "label": "gasto de R$ 104,99 em *wardogs*"}]}
CRIA = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500, description="mercado")


@pytest.fixture
def banco(monkeypatch):
    ordem: list[str] = []
    estado = {"reserva": True, "result": None}

    async def reserve(*a, **k):
        ordem.append("reserve")
        return estado["reserva"]

    async def carimbo(*a, **k):
        return estado["result"]

    async def confirm(msg, indice, result_id):
        ordem.append(f"confirm:{result_id}")

    async def solto(*a, **k):
        raise AssertionError("release_execution não é mais chamado: a unidade desfaz a reserva")

    async def dono(*a, **k):
        return None

    monkeypatch.setattr(registry.db, "reserve_execution", reserve)
    monkeypatch.setattr(registry.db, "execution_result_id", carimbo)
    monkeypatch.setattr(registry.db, "confirm_execution", confirm)
    monkeypatch.setattr(registry.db, "release_execution", solto)
    monkeypatch.setattr(registry, "ensure_owned", dono)
    return ordem, estado


def _ctx():
    return ExecContext("u", "w", None, "America/Sao_Paulo", "gastei 45", "wamid.a3")


def _tool(monkeypatch, ordem, devolve):
    async def tool(ctx, acao):
        ordem.append("tool")
        if isinstance(devolve, BaseException):
            raise devolve
        return devolve

    monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.CREATE_EXPENSE, tool)


@pytest.mark.asyncio
async def test_sucesso_reserva_escreve_e_carimba_na_mesma_unidade(monkeypatch, banco, unidade):
    ordem, _ = banco
    _tool(monkeypatch, ordem, ToolResult("✅ ok", result_id="r1"))
    ctx = _ctx()

    r = await registry.execute(ctx, CRIA)

    assert ordem == ["reserve", "tool", "confirm:r1"]
    assert (unidade.commits, unidade.rollbacks) == (1, 0)
    assert r.message == "✅ ok" and ctx.created == ["r1"]


@pytest.mark.asyncio
@pytest.mark.parametrize("falha", [Level1Error("💳 sem conta"), RuntimeError("caiu")])
async def test_falha_da_tool_desfaz_a_unidade_inteira(monkeypatch, banco, unidade, falha):
    ordem, _ = banco
    _tool(monkeypatch, ordem, falha)
    ctx = _ctx()

    r = await registry.execute(ctx, CRIA)

    assert r.read_only and (unidade.commits, unidade.rollbacks) == (0, 1)
    assert not any(o.startswith("confirm") for o in ordem) and ctx.created == []


@pytest.mark.asyncio
async def test_falha_no_carimbo_desfaz_a_escrita_tambem(monkeypatch, banco, unidade):
    ordem, _ = banco
    _tool(monkeypatch, ordem, ToolResult("✅ ok", result_id="r1"))

    async def confirm_quebra(*a, **k):
        raise RuntimeError("conexão caiu")

    monkeypatch.setattr(registry.db, "confirm_execution", confirm_quebra)
    ctx = _ctx()

    r = await registry.execute(ctx, CRIA)

    assert r.read_only and "Deu erro" in r.message
    assert (unidade.commits, unidade.rollbacks) == (0, 1) and ctx.created == []


@pytest.mark.asyncio
async def test_tool_que_nao_escreveu_nao_consome_a_vaga(monkeypatch, banco, unidade):
    ordem, _ = banco
    _tool(monkeypatch, ordem, ToolResult("🤷 não achei", read_only=True))

    r = await registry.execute(_ctx(), CRIA)

    assert r.message == "🤷 não achei" and r.read_only
    assert (unidade.commits, unidade.rollbacks) == (0, 1)


@pytest.mark.asyncio
async def test_vaga_ja_tomada_pula_a_tool_e_le_o_carimbo(monkeypatch, banco, unidade):
    ordem, estado = banco
    estado["reserva"], estado["result"] = False, "r-antigo"
    _tool(monkeypatch, ordem, ToolResult("não deveria rodar", result_id="x"))

    r = await registry.execute(_ctx(), CRIA)

    assert r.ja_executada and "tool" not in ordem


# ------------------------------------------------------------------ o par


DELETE = {"type": FinanceActionType.DELETE_TRANSACTION.value, "description": "wardogs"}
CREATE = {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 10499, "description": "wardogs"}
CREATE2 = {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 500, "description": "taxa"}


def _estado(acoes, alvos):
    return {
        "user_id": "u1", "workspace_id": "w1", "phone": "5551999999999",
        "timezone": "America/Sao_Paulo", "text": "na verdade foi em 2x",
        "source_message_id": "wamid.par", "results": [],
        "finance_actions": acoes, "targets": alvos,
    }


@pytest.fixture
def par(monkeypatch, banco):
    async def sem_regra(ws, acao):
        return acao

    monkeypatch.setattr(nodes, "apply_rules", sem_regra)

    def instala(criar, apagar):
        async def c(ctx, acao):
            return criar(acao) if callable(criar) else criar

        async def a(ctx, acao):
            return apagar

        monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.CREATE_EXPENSE, c)
        monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.DELETE_TRANSACTION, a)

    return instala


@pytest.mark.asyncio
async def test_par_que_deu_certo_commita_sem_desfazer(par, unidade):
    par(ToolResult("💸 Gasto novo.", result_id="novo"), ToolResult("🗑️ Apaguei.", result_id="tx-w"))

    ret = await nodes.execute_node(_estado([DELETE, CREATE], [ALVO, {}]))

    assert unidade.rollbacks == 0 and unidade.commits == 3  # 2 savepoints + a unidade do par
    assert ret["last_write_id"] == "novo"
    assert "💸 Gasto novo." in ret["results"] and "🗑️ Apaguei." in ret["results"]


@pytest.mark.asyncio
async def test_apagar_que_falha_depois_da_criacao_desfaz_a_criacao_e_diz_a_verdade(par, unidade):
    par(ToolResult("💸 Gasto novo.", result_id="novo"), ToolResult("🤷 Não achei mais esse lançamento.", read_only=True))

    ret = await nodes.execute_node(_estado([DELETE, CREATE], [ALVO, {}]))

    texto = "\n".join(ret["results"])
    assert "last_write_id" not in ret, "o que a criação escreveu voltou com a transação"
    assert "💸 Gasto novo." not in texto, texto  # não afirma o que foi desfeito
    assert "🤷 Não achei mais esse lançamento." in texto
    assert "Não registrei wardogs (R$ 104,99)" in texto and "nada foi alterado" in texto, texto
    assert unidade.commits == 1  # só o savepoint da criação; a unidade do par voltou
    assert unidade.rollbacks >= 1


@pytest.mark.asyncio
async def test_criacao_que_falha_desfaz_a_criacao_anterior_do_par(par, unidade):
    def criar(acao):
        if acao.description == "taxa":
            return ToolResult("🤷 Não deu.", read_only=True)
        return ToolResult("💸 Gasto novo.", result_id="novo")

    par(criar, ToolResult("🗑️ Apaguei.", result_id="tx-w"))

    ret = await nodes.execute_node(_estado([DELETE, CREATE, CREATE2], [ALVO, {}, {}]))

    texto = "\n".join(ret["results"])
    assert "last_write_id" not in ret
    assert "💸 Gasto novo." not in texto and "🗑️ Apaguei." not in texto, texto
    assert "Não registrei wardogs (R$ 104,99) porque não consegui registrar taxa (R$ 5,00)" in texto, texto
    assert "Não apaguei gasto de R$ 104,99 em *wardogs*" in texto, texto


@pytest.mark.asyncio
async def test_commit_que_falha_no_par_nao_afirma_nada(par, unidade, monkeypatch):
    par(ToolResult("💸 Gasto novo.", result_id="novo"), ToolResult("🗑️ Apaguei.", result_id="tx-w"))
    comum = nodes.db.unidade_de_trabalho

    def quebra_no_commit():
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _u():
            yield
            raise ConnectionError("caiu no commit")

        return _u()

    # só a unidade do PAR (a mais externa) quebra no commit
    chamadas = {"n": 0}

    def alterna():
        chamadas["n"] += 1
        return quebra_no_commit() if chamadas["n"] == 1 else comum()

    monkeypatch.setattr(nodes.db, "unidade_de_trabalho", alterna)

    ret = await nodes.execute_node(_estado([DELETE, CREATE], [ALVO, {}]))

    texto = "\n".join(ret["results"])
    assert "Deu erro" in texto and "Nada foi alterado" in texto
    assert "last_write_id" not in ret and "💸" not in texto
