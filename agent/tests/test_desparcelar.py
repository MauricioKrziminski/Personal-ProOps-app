"""Desparcelar — a compra parcelada volta a ser à vista (21/09/2026).

"desparcela a compra da tv" é `update_transaction` com `installments=1` sobre o PLANO. O
caminho é a MESMA RPC do chip "À vista" do app (`update_installment_plan` com
`p_installments = 1`): a parcela 1 sobrevive com o total e o MESMO id, as outras somem,
o plano é dissolvido. Antes o modelo propunha `delete_transaction` — apagava a compra.

Tudo que dá para saber antes do SIM é recusado antes do SIM; a RPC é a última trava.
"""

from uuid import UUID

import pytest
from langgraph.types import Command

from app.graph.policy import describe_for_confirmation, erro_de_correcao
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance, resolve
from app.tools.base import ExecContext
from app.tools.guards import Level1Error
from tests.test_hitl_flow import _estado, _valor, grafo  # noqa: F401

WS = UUID("22222222-2222-2222-2222-222222222222")
UPD = FinanceActionType.UPDATE_TRANSACTION

PLANO_ROW = {
    "id": "p-tv", "description": "TV", "merchant": None, "total_cents": 300000,
    "installments": 10, "first_occurred_at": "2026-09-05", "editaveis": 10,
    "travado_cents": 0, "parcela1_em": "2026-09-05", "account_name": "Nubank",
}
AVULSO = {"id": "tx-tv", "kind": "expense", "amount_cents": 300000, "category": "eletrônicos",
          "description": "TV", "merchant": None, "occurred_at": "2026-09-05"}


def _banco(monkeypatch, planos=None, txs=None):
    consultas = []
    planos = [dict(PLANO_ROW)] if planos is None else planos
    txs = [] if txs is None else txs

    async def fetch(sql, *args):
        consultas.append((" ".join(sql.split()), args))
        if "from public.installment_plans p" in sql and "ilike" in sql:
            return [dict(r) for r in planos]
        if "join public.installment_plans p on p.id = t.installment_plan_id" in sql:
            return []
        if "with pista as" in sql:
            return [dict(r) for r in txs]
        return []

    async def fetch_one(sql, *args):
        return None

    monkeypatch.setattr(resolve.db, "fetch", fetch)
    monkeypatch.setattr(resolve.db, "fetch_one", fetch_one)
    return consultas


async def _alvo(acao, texto="desparcela a compra da tv"):
    return (await resolve.for_actions(WS, [acao], texto))[0]


# ---------------------------------------------------------------------------
# resolve
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acha_o_plano_pela_tabela_de_planos_e_congela_data_e_cartao(monkeypatch):
    consultas = _banco(monkeypatch)
    alvo = await _alvo(FinanceAction(type=UPD, description="tv", installments=1))
    assert alvo["table"] == "installment_plans" and alvo["status"] == "found"
    assert not alvo.get("correction_error")
    cand = alvo["candidates"][0]
    assert cand["parcela1_em"] == "2026-09-05" and cand["account_name"] == "Nubank"
    assert cand["total_cents"] == 300000 and cand["plan_installments"] == 10
    sql, args = next(c for c in consultas if "from public.installment_plans p" in c[0])
    assert "p.workspace_id = %s" in sql and WS in args
    assert "parcela_travada" in sql


@pytest.mark.asyncio
async def test_lancamento_avulso_ja_e_a_vista(monkeypatch):
    _banco(monkeypatch, planos=[], txs=[AVULSO])
    alvo = await _alvo(FinanceAction(type=UPD, description="tv", installments=1),
                       "a tv foi à vista, não parcelada")
    assert alvo["correction_error"] == "Esse lançamento já é à vista. Ainda não mudei nada."


@pytest.mark.asyncio
async def test_avulso_com_outra_correcao_ignora_o_1(monkeypatch):
    """`installments=1` de ruído numa correção comum não pode virar recusa."""
    _banco(monkeypatch, planos=[], txs=[AVULSO])
    alvo = await _alvo(FinanceAction(type=UPD, description="tv", installments=1,
                                     new_category="casa"), "a tv é casa")
    assert not alvo.get("correction_error")


# ---------------------------------------------------------------------------
# policy — recusas e a frase do SIM
# ---------------------------------------------------------------------------


def _plano(**cand):
    base = {"id": "p-tv", "label": "Tudo (10x) — TV", "table": "installment_plans",
            "plan_installments": 10, "total_cents": 300000, "editaveis": 10,
            "travado_cents": 0, "parcela1_em": "2026-09-05", "account_name": "Nubank"}
    return {"table": "installment_plans", "status": "found", "candidates": [{**base, **cand}]}


def test_desparcelar_o_plano_nao_e_mudar_parcelas():
    assert erro_de_correcao(FinanceAction(type=UPD, installments=1), _plano()) is None


def test_parcela_travada_recusa_antes_do_sim():
    erro = erro_de_correcao(FinanceAction(type=UPD, installments=1),
                            _plano(editaveis=7, travado_cents=90000))
    assert erro == ("A compra TV tem parcela já paga ou numa fatura fechada — não dá para "
                    "voltar para à vista. Ainda não mudei nada.")


def test_valor_novo_junto_recusa():
    erro = erro_de_correcao(FinanceAction(type=UPD, installments=1, new_amount_cents=320000),
                            _plano())
    assert erro.startswith("Não entendi se é para voltar a compra para à vista ou corrigir o valor")


def test_reparcelar_para_outro_n_continua_exclusao():
    assert "Mudar o número de parcelas é em Editar a compra no app" in erro_de_correcao(
        FinanceAction(type=UPD, installments=12), _plano())


def test_frase_do_sim_diz_o_efeito_inteiro():
    assert describe_for_confirmation(FinanceAction(type=UPD, installments=1), _plano()) == (
        "desparcelar TV: a compra de R$ 3.000,00 volta a ser à vista em 05/09/2026 no "
        "cartão Nubank (as 10 parcelas viram um lançamento só)")


def test_frase_com_nome_e_categoria_novos():
    frase = describe_for_confirmation(
        FinanceAction(type=UPD, installments=1, new_description="Televisão",
                      new_category="casa"), _plano())
    assert frase.endswith("(as 10 parcelas viram um lançamento só); categoria → casa, "
                          "nome → Televisão")


def test_frase_do_empate():
    alvo = {"table": "installment_plans", "status": "ambiguous",
            "candidates": [_plano()["candidates"][0], {**_plano()["candidates"][0], "id": "p2"}]}
    assert describe_for_confirmation(
        FinanceAction(type=UPD, description="tv", installments=1), alvo) == (
        "desparcelar tv — a compra volta a ser à vista num lançamento só. Qual delas?")


def test_empate_de_compras_nao_cai_em_o_que_mudar():
    alvo = {"table": "installment_plans", "status": "ambiguous",
            "candidates": [_plano()["candidates"][0], {**_plano()["candidates"][0], "id": "p2"}]}
    assert erro_de_correcao(FinanceAction(type=UPD, description="tv", installments=1), alvo) is None


def test_um_espurio_com_categoria_o_sim_denuncia():
    """`installments=1` de ruído em "a tv é casa": o SIM começa com "desparcelar", e a
    pessoa vê antes de aprovar."""
    frase = describe_for_confirmation(
        FinanceAction(type=UPD, description="tv", installments=1, new_category="casa"), _plano())
    assert frase.startswith("desparcelar TV")


# ---------------------------------------------------------------------------
# tool — a RPC do app, 8 argumentos, installments = 1
# ---------------------------------------------------------------------------

PLANO_ATUAL = {"id": "p-tv", "total_cents": 300000, "installments": 10,
               "first_occurred_at": "2026-09-01", "description": "TV", "category": "eletrônicos",
               "merchant": "Magalu", "account_id": "card-nu", "editaveis": 10,
               "travado_cents": 0, "parcela1_em": "2026-09-05", "parcela1_id": "tx-1"}


def _ctx(**cand) -> ExecContext:
    return ExecContext(
        user_id=UUID("11111111-1111-1111-1111-111111111111"), workspace_id=WS,
        phone="5551999999999", timezone="America/Sao_Paulo", texto="",
        source_message_id="w1", target=_plano(**cand),
    )


def _rpc(monkeypatch, plano=PLANO_ATUAL, erro=None):
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((" ".join(sql.split()), args))
        if "update_installment_plan" in sql:
            if erro:
                raise erro
            return {"mexidas": 1}
        return dict(plano) if plano else None

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    return chamadas


@pytest.mark.asyncio
async def test_tool_chama_a_rpc_com_os_atuais_e_1_parcela(monkeypatch):
    chamadas = _rpc(monkeypatch)
    r = await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=1))
    leitura = chamadas[0]
    assert "p.workspace_id = %s" in leitura[0] and leitura[1] == ("p-tv", WS)
    rpc = [a for q, a in chamadas if "update_installment_plan" in q]
    assert rpc == [("p-tv", 300000, 1, "2026-09-05", "TV", "eletrônicos", "Magalu", "card-nu")]
    assert not r.read_only and r.result_id == "tx-1"
    assert r.message == "✅ TV voltou a ser à vista: R$ 3.000,00 em 05/09/2026."


@pytest.mark.asyncio
async def test_tool_troca_nome_e_categoria_junto(monkeypatch):
    chamadas = _rpc(monkeypatch)
    await finance.update_transaction(
        _ctx(), FinanceAction(type=UPD, installments=1, new_description="Televisão",
                              new_category="Casa"))
    rpc = [a for q, a in chamadas if "update_installment_plan" in q]
    assert rpc == [("p-tv", 300000, 1, "2026-09-05", "Televisão", "casa", "Magalu", "card-nu")]


@pytest.mark.asyncio
async def test_tool_plano_de_outro_workspace_nao_chama_a_rpc(monkeypatch):
    chamadas = _rpc(monkeypatch, plano=None)
    r = await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=1))
    assert r.read_only
    assert not any("update_installment_plan" in q for q, _ in chamadas)


@pytest.mark.asyncio
async def test_tool_parcela_travada_depois_do_sim_nao_escreve(monkeypatch):
    chamadas = _rpc(monkeypatch, plano={**PLANO_ATUAL, "travado_cents": 30000, "editaveis": 9})
    r = await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=1))
    assert r.read_only and "não dá para voltar para à vista" in r.message
    assert not any("update_installment_plan" in q for q, _ in chamadas)


@pytest.mark.asyncio
async def test_tool_total_mudou_depois_do_sim_nao_escreve(monkeypatch):
    chamadas = _rpc(monkeypatch, plano={**PLANO_ATUAL, "total_cents": 320000})
    r = await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=1))
    assert r.read_only and "mudou" in r.message
    assert not any("update_installment_plan" in q for q, _ in chamadas)


@pytest.mark.asyncio
async def test_tool_valor_novo_e_recusado(monkeypatch):
    _rpc(monkeypatch)
    with pytest.raises(Level1Error):
        await finance.update_transaction(
            _ctx(), FinanceAction(type=UPD, installments=1, new_amount_cents=320000))


@pytest.mark.asyncio
async def test_tool_recusa_da_rpc_vira_mensagem(monkeypatch):
    import psycopg

    class Recusa(psycopg.errors.RaiseException):
        pass

    _rpc(monkeypatch, erro=Recusa("Essa data (ou essa conta) joga o lançamento dentro de uma "
                                  "fatura já fechada. Escolha outra."))
    with pytest.raises(Level1Error) as err:
        await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=1))
    assert "fatura já fechada" in err.value.mensagem_usuario
    assert "Ainda não mudei nada" in err.value.mensagem_usuario


# ---------------------------------------------------------------------------
# grafo — resolvedor real → frase → SIM → execução
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grafo_desparcela_pelo_resolvedor_real(monkeypatch, grafo):  # noqa: F811
    from app.graph import nodes
    from tests.test_hitl_flow import _for_actions_real

    monkeypatch.setattr(nodes.resolve, "for_actions", _for_actions_real)
    _banco(monkeypatch)
    cfg = {"configurable": {"thread_id": "desparcelar-tv"}}
    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "installments": 1}])
        | {"text": "desparcela a compra da tv"},
        config=cfg,
    )
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation"
    assert pausa["summary"] == (
        "desparcelar TV: a compra de R$ 3.000,00 volta a ser à vista em 05/09/2026 no "
        "cartão Nubank (as 10 parcelas viram um lançamento só)")
    assert "EXECUTOU" not in estado.get("results", [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "EXECUTOU" in final["results"]


@pytest.mark.asyncio
async def test_grafo_parcela_travada_para_antes_do_sim(monkeypatch, grafo):  # noqa: F811
    from app.graph import nodes
    from tests.test_hitl_flow import _for_actions_real

    monkeypatch.setattr(nodes.resolve, "for_actions", _for_actions_real)
    _banco(monkeypatch, planos=[{**PLANO_ROW, "editaveis": 8, "travado_cents": 60000}])
    final = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "installments": 1}])
        | {"text": "desparcela a compra da tv"},
        config={"configurable": {"thread_id": "desparcelar-travada"}},
    )
    assert "__interrupt__" not in final
    assert any("não dá para voltar para à vista" in r for r in final["results"])
    assert "EXECUTOU" not in final["results"]


def _empate(monkeypatch, segundo):
    from app.graph import nodes

    cand = _plano()["candidates"][0]

    async def empate(workspace_id, acoes, texto_cru, antecedente=None):
        return [{"table": "installment_plans", "status": "ambiguous",
                 "candidates": [cand, {**cand, "id": "p-tv2", "label": "Tudo (6x) — TV sala",
                                       **segundo}]}]

    monkeypatch.setattr(nodes.resolve, "for_actions", empate)


@pytest.mark.asyncio
async def test_grafo_empate_escolha_confirma_e_executa(monkeypatch, grafo):  # noqa: F811
    _empate(monkeypatch, {"plan_installments": 6, "total_cents": 120000})
    cfg = {"configurable": {"thread_id": "desparcelar-empate"}}
    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "installments": 1}]),
        config=cfg)
    pausa = _valor(estado)
    assert pausa["kind"] == "choice"
    assert pausa["summary"] == (
        "desparcelar tv — a compra volta a ser à vista num lançamento só. Qual delas?")
    estado = await grafo.ainvoke(Command(resume={"approved": True, "candidate_id": "p-tv2"}),
                                 config=cfg)
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation"
    assert pausa["summary"] == (
        "desparcelar TV sala: a compra de R$ 1.200,00 volta a ser à vista em 05/09/2026 no "
        "cartão Nubank (as 6 parcelas viram um lançamento só)")
    assert "EXECUTOU" not in estado.get("results", [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "EXECUTOU" in final["results"]
    assert final["targets"][0]["candidates"][0]["id"] == "p-tv2"


@pytest.mark.asyncio
async def test_grafo_empate_escolha_de_plano_travado_recusa_antes_de_escrever(monkeypatch, grafo):  # noqa: F811
    _empate(monkeypatch, {"editaveis": 4, "travado_cents": 40000})
    cfg = {"configurable": {"thread_id": "desparcelar-empate-travado"}}
    await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "installments": 1}]),
        config=cfg)
    final = await grafo.ainvoke(Command(resume={"approved": True, "candidate_id": "p-tv2"}),
                                config=cfg)
    assert "__interrupt__" not in final
    assert any("A compra TV sala tem parcela já paga" in r for r in final["results"])
    assert "EXECUTOU" not in final["results"]


@pytest.mark.asyncio
async def test_grafo_empate_misto_escolhendo_a_avulsa_diz_que_ja_e_a_vista(monkeypatch, grafo):  # noqa: F811
    from app.graph import nodes

    plano = _plano()["candidates"][0]
    avulsa = {"id": "tx-tv", "label": "gasto de R$ 3.000,00 em *eletrônicos* (TV)",
              "table": "transactions", "when": "05/09/2026"}

    async def empate(workspace_id, acoes, texto_cru, antecedente=None):
        return [{"table": "transactions", "status": "ambiguous", "candidates": [plano, avulsa]}]

    monkeypatch.setattr(nodes.resolve, "for_actions", empate)
    cfg = {"configurable": {"thread_id": "desparcelar-empate-misto"}}
    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "installments": 1}]),
        config=cfg)
    assert _valor(estado)["kind"] == "choice"
    final = await grafo.ainvoke(Command(resume={"approved": True, "candidate_id": "tx-tv"}),
                                config=cfg)
    assert "__interrupt__" not in final
    assert "Esse lançamento já é à vista. Ainda não mudei nada." in final["results"]
    assert "EXECUTOU" not in final["results"]
