"""Execução do par de substituição (apagar/corrigir + criar) depois do SIM.

A criação roda PRIMEIRO; o apagar só roda se ela escreveu. Sem isso, o SIM
aprovava as duas, a criação falhava (Level1Error, exceção do banco) e o apagar
acontecia sozinho — o incidente das wardogs por outro caminho.

Passa pelo `registry.execute` DE VERDADE (reserva, falha isolada, liberação);
só o banco e as tools são dublês.
"""

import pytest

from app.graph import nodes
from app.graph.schemas import FinanceActionType
from app.tools import registry
from app.tools.base import ToolResult
from app.tools.guards import Level1Error

ALVO = {"table": "transactions", "status": "found",
        "candidates": [{"id": "tx-w", "label": "gasto de R$ 104,99 em *wardogs*"}]}


def _estado(acoes, alvos):
    return {
        "user_id": "u1", "workspace_id": "w1", "phone": "5551999999999",
        "timezone": "America/Sao_Paulo", "text": "na verdade foi em 2x",
        "source_message_id": "wamid.par", "results": [],
        "finance_actions": acoes, "targets": alvos,
    }


@pytest.fixture
def banco(monkeypatch):
    """Reserva por índice ORIGINAL; `ja_feitas` simula a retentativa
    (índice -> `result_id` carimbado na reserva, ou None se ela ficou órfã)."""
    chamadas: list[str] = []
    ja_feitas: dict[int, str | None] = {}

    async def reserve(msg, indice, tipo, **kw):
        return indice not in ja_feitas

    async def carimbo(msg, indice):
        return ja_feitas.get(indice)

    async def nada(*a, **k):
        return None

    async def dono(*a, **k):
        return None

    async def apagar(ctx, acao):
        chamadas.append(f"delete#{ctx.action_index}")
        return ToolResult("🗑️ Apaguei wardogs.", result_id="tx-w")

    monkeypatch.setattr(registry.db, "reserve_execution", reserve)
    monkeypatch.setattr(registry.db, "execution_result_id", carimbo)
    monkeypatch.setattr(registry.db, "release_execution", nada)
    monkeypatch.setattr(registry.db, "confirm_execution", nada)
    monkeypatch.setattr(registry, "ensure_owned", dono)
    monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.DELETE_TRANSACTION, apagar)

    async def sem_regra(ws, acao):
        return acao

    monkeypatch.setattr(nodes, "apply_rules", sem_regra)
    return chamadas, ja_feitas


def _criar(monkeypatch, chamadas, efeito):
    async def criar(ctx, acao):
        chamadas.append(f"create#{ctx.action_index}")
        if isinstance(efeito, BaseException):
            raise efeito
        return efeito

    monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.CREATE_EXPENSE, criar)


PAR = [
    {"type": FinanceActionType.DELETE_TRANSACTION.value, "description": "wardogs"},
    {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 10499,
     "description": "wardogs"},
]


@pytest.mark.asyncio
async def test_criacao_roda_primeiro_e_o_apagar_depois(monkeypatch, banco):
    chamadas, _ = banco
    _criar(monkeypatch, chamadas, ToolResult("💸 Gasto de R$ 104,99.", result_id=None))

    await nodes.execute_node(_estado(PAR, [ALVO, {}]))

    # índices ORIGINAIS preservados: é a chave de `executed_actions`
    assert chamadas == ["create#1", "delete#0"]


@pytest.mark.asyncio
@pytest.mark.parametrize("falha", [
    Level1Error("💳 Não achei a conta."),
    RuntimeError("banco caiu"),
])
async def test_criacao_que_falha_nao_deixa_o_apagar_rodar(monkeypatch, banco, falha):
    chamadas, _ = banco
    _criar(monkeypatch, chamadas, falha)

    ret = await nodes.execute_node(_estado(PAR, [ALVO, {}]))

    assert chamadas == ["create#1"]
    texto = "\n".join(ret["results"])
    assert "Não apaguei gasto de R$ 104,99 em *wardogs*" in texto, texto
    assert "porque não consegui registrar" in texto, texto


@pytest.mark.asyncio
async def test_criacao_que_nao_escreveu_tambem_trava(monkeypatch, banco):
    chamadas, _ = banco
    _criar(monkeypatch, chamadas, ToolResult("🤷 Não deu.", read_only=True))

    await nodes.execute_node(_estado(PAR, [ALVO, {}]))

    assert chamadas == ["create#1"]


@pytest.mark.asyncio
async def test_retentativa_com_a_criacao_ja_gravada_segue_para_o_apagar(monkeypatch, banco):
    """O worker morreu entre as duas: a reserva da criação volta como "já feita"
    (read_only, sem escrever de novo). Tratar isso como falha deixaria a compra
    nova ao lado da antiga para sempre."""
    chamadas, ja_feitas = banco
    ja_feitas[1] = "tx-nova"
    _criar(monkeypatch, chamadas, ToolResult("nunca", result_id=None))

    ret = await nodes.execute_node(_estado(PAR, [ALVO, {}]))

    assert chamadas == ["delete#0"]
    # I3: o id do apagado não vira antecedente na retentativa
    assert "last_write_id" not in ret


@pytest.mark.asyncio
async def test_retentativa_com_reserva_ORFA_nao_segue_para_o_apagar(monkeypatch, banco):
    """Reserva sem `result_id`: o worker morreu entre reservar e escrever (ou
    outro está escrevendo agora). Não dá para afirmar que a compra nova existe,
    então o apagar não roda."""
    chamadas, ja_feitas = banco
    ja_feitas[1] = None
    _criar(monkeypatch, chamadas, ToolResult("nunca", result_id=None))

    ret = await nodes.execute_node(_estado(PAR, [ALVO, {}]))

    assert chamadas == []
    assert "porque não consegui registrar" in "\n".join(ret["results"])


@pytest.mark.asyncio
async def test_criacao_que_falha_pula_tambem_as_criacoes_seguintes_do_par(monkeypatch, banco):
    chamadas, _ = banco
    _criar(monkeypatch, chamadas, RuntimeError("x"))
    acoes = [PAR[0], PAR[1], {"type": FinanceActionType.CREATE_EXPENSE.value,
                              "amount_cents": 2000, "description": "frete"}]

    ret = await nodes.execute_node(_estado(acoes, [ALVO, {}, {}]))

    assert chamadas == ["create#1"]
    texto = "\n".join(ret["results"])
    assert "Não registrei frete (R$ 20,00) porque não consegui registrar wardogs (R$ 104,99)" in texto, texto
    assert "Não apaguei gasto de R$ 104,99 em *wardogs*" in texto, texto


@pytest.mark.asyncio
async def test_lote_comum_mantem_a_ordem_e_a_falha_isolada(monkeypatch, banco):
    """Dois gastos não são par: ordem original e falha isolada, como sempre."""
    chamadas, _ = banco
    _criar(monkeypatch, chamadas, RuntimeError("x"))
    acoes = [
        {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500, "category": "mercado"},
        {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 3000, "category": "uber"},
    ]

    await nodes.execute_node(_estado(acoes, [{}, {}]))

    assert chamadas == ["create#0", "create#1"]


@pytest.mark.asyncio
async def test_undo_last_sem_alvo_nao_repete_o_verbo(monkeypatch, banco):
    chamadas, _ = banco
    _criar(monkeypatch, chamadas, RuntimeError("x"))
    acoes = [{"type": FinanceActionType.UNDO_LAST.value}, PAR[1]]

    ret = await nodes.execute_node(_estado(acoes, [{}, {}]))

    texto = "\n".join(ret["results"])
    assert "Não fiz: apagar o seu lançamento mais recente" in texto, texto
    assert "apaguei apagar" not in texto


@pytest.mark.asyncio
async def test_no_par_o_antecedente_do_proximo_turno_e_a_CRIACAO(monkeypatch, banco):
    """I3: com a criação rodando primeiro, o último id escrito era o do APAGADO — e
    "corrige esse para 60" no turno seguinte não achava nada."""
    chamadas, _ = banco

    async def apagar(ctx, acao):
        chamadas.append(f"delete#{ctx.action_index}")
        return ToolResult("🗑️ Apaguei wardogs.", result_id="tx-w")

    monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.DELETE_TRANSACTION, apagar)
    _criar(monkeypatch, chamadas, ToolResult("💸 Gasto de R$ 104,99.", result_id="tx-nova"))

    ret = await nodes.execute_node(_estado(PAR, [ALVO, {}]))

    assert chamadas == ["create#1", "delete#0"]
    assert ret["last_write_id"] == "tx-nova"


def test_nao_fiz_nao_repete_a_data_de_hoje():
    """X2: a frase do "não fiz" usa o `hoje` do usuário, como a do SIM."""
    from app.graph import nodes
    from app.graph.schemas import FinanceAction, FinanceActionType

    acao = FinanceAction(type=FinanceActionType.MARK_PAID, description="luz", occurred_at="2026-09-21")
    criacao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=100, description="x")
    frase = nodes._nao_fiz(acao, {}, criacao, hoje="2026-09-21")
    assert "21/09/2026" not in frase
