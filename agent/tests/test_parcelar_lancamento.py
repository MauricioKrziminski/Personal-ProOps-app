"""D1 — parcelar um lançamento que JÁ EXISTE.

"Comprei wardogs por 104,99" e depois "na verdade eu comprei em 2x no cartão" é
`update_transaction` com `installments=2` sobre a linha do wardogs. O caminho é a
MESMA RPC do botão "Parcelar" do app (`convert_transaction_to_installments`): a linha
é adotada como parcela 1, o id não muda, e o cartão é obrigatório.

Tudo que dá para saber antes do SIM é recusado antes do SIM (resolve congela o
estado da linha); a RPC continua sendo a última trava.
"""

from uuid import UUID

import pytest
from langgraph.types import Command

from app.graph.policy import describe_for_confirmation, erro_de_correcao
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance, resolve
from app.tools.base import ExecContext
from app.tools.guards import Level1Error
from tests.test_hitl_flow import _config, _estado, _valor, grafo  # noqa: F401

WS = UUID("22222222-2222-2222-2222-222222222222")
UPD = FinanceActionType.UPDATE_TRANSACTION

CARTOES = [
    {"id": "card-bb", "name": "BB", "type": "credit_card"},
    {"id": "card-nu", "name": "Nubank", "type": "credit_card"},
]
CONTAS = [{"id": "chk-inter", "name": "Inter", "type": "checking"}, *CARTOES]

LINHA = {
    "id": "tx-w", "kind": "expense", "amount_cents": 10499, "occurred_at": "2026-09-20",
    "description": "Wardogs", "merchant": "Nuuvem", "category": "jogos",
    "installment_plan_id": None, "plan_installments": None, "recurring_id": None,
    "debt_id": None, "rollover_of_invoice_id": None, "fatura_travada": False,
    "account_id": "card-nu", "account_name": "Nubank", "account_type": "credit_card",
}


# ---------------------------------------------------------------------------
# resolve — congela o que a frase e a tool leem, recusa o que dá para saber antes
# ---------------------------------------------------------------------------


def _banco(monkeypatch, linhas=None, contas=CONTAS):
    """Antecedente da conversa (fetch_one) + detalhe da linha (fetch) + contas."""
    consultas = []
    linhas = [dict(LINHA)] if linhas is None else linhas

    async def fetch_one(sql, *args):
        return {k: LINHA[k] for k in ("id", "kind", "amount_cents", "category",
                                      "description", "occurred_at")}

    async def fetch(sql, *args):
        consultas.append((" ".join(sql.split()), args))
        if "rollover_of_invoice_id" in sql:
            return [dict(r) for r in linhas]
        return []

    async def accounts(workspace_id, *, only_cards=False):
        return [c for c in contas if not only_cards or c["type"] == "credit_card"]

    monkeypatch.setattr(resolve.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resolve.db, "fetch", fetch)
    monkeypatch.setattr(resolve.db, "accounts", accounts)
    return consultas


async def _alvo(acao):
    alvos = await resolve.for_actions(WS, [acao], "na verdade foi em 2x", antecedente="tx-w")
    return alvos[0]


@pytest.mark.asyncio
async def test_linha_no_cartao_congela_cartao_nome_valor_e_data(monkeypatch):
    consultas = _banco(monkeypatch)
    alvo = await _alvo(FinanceAction(type=UPD, installments=2))
    assert alvo["status"] == "found" and not alvo.get("correction_error")
    assert alvo["convert_account"] == {"id": "card-nu", "name": "Nubank"}
    cand = alvo["candidates"][0]
    assert cand["nome"] == "Wardogs"
    assert cand["amount_cents"] == 10499 and cand["occurred_at"] == "2026-09-20"
    sql, args = next(c for c in consultas if "rollover_of_invoice_id" in c[0])
    assert "t.workspace_id = %s" in sql and WS in args
    assert "parcela_travada('pending', t.invoice_id)" in sql


@pytest.mark.asyncio
async def test_linha_em_conta_corrente_sem_cartao_citado_pergunta_listando_os_cartoes(monkeypatch):
    _banco(monkeypatch, [{**LINHA, "account_id": "chk-inter", "account_name": "Inter",
                          "account_type": "checking"}])
    alvo = await _alvo(FinanceAction(type=UPD, installments=2))
    assert alvo["correction_error"] == (
        "Em qual cartão? Você tem: *BB*, *Nubank*. Me manda de novo dizendo o cartão.")
    assert "convert_account" not in alvo


@pytest.mark.asyncio
async def test_sem_cartao_cadastrado_diz_isso(monkeypatch):
    _banco(monkeypatch, [{**LINHA, "account_id": None, "account_name": None,
                          "account_type": None}], contas=[CONTAS[0]])
    alvo = await _alvo(FinanceAction(type=UPD, installments=2))
    assert "não tem cartão cadastrado" in alvo["correction_error"]
    assert "convert_account" not in alvo


@pytest.mark.asyncio
async def test_cartao_citado_resolve_so_entre_cartoes_e_nao_vira_troca_de_conta(monkeypatch):
    _banco(monkeypatch, [{**LINHA, "account_id": "chk-inter", "account_type": "checking"}],
           contas=[{"id": "chk-nu", "name": "Nubank Conta", "type": "checking"},
                   {"id": "card-nu", "name": "Nubank Cartão", "type": "credit_card"}])
    alvo = await _alvo(FinanceAction(type=UPD, installments=2, new_account="nubank"))
    assert alvo["convert_account"] == {"id": "card-nu", "name": "Nubank Cartão"}
    assert "new_account" not in alvo and not alvo.get("correction_error")


@pytest.mark.asyncio
async def test_conta_corrente_citada_nao_serve_e_pergunta_o_cartao(monkeypatch):
    _banco(monkeypatch)
    alvo = await _alvo(FinanceAction(type=UPD, installments=2, new_account="inter"))
    assert "*BB*, *Nubank*" in alvo["correction_error"]
    assert "Me manda de novo dizendo o cartão." in alvo["correction_error"]
    assert "convert_account" not in alvo and "new_account" not in alvo


@pytest.mark.asyncio
@pytest.mark.parametrize("campos, trecho", [
    ({"kind": "income"}, "Só gasto vira compra parcelada"),
    ({"recurring_id": "r1"}, "série recorrente"),
    ({"debt_id": "d1"}, "financiamento"),
    ({"rollover_of_invoice_id": "i1"}, "saldo adiado"),
    ({"fatura_travada": True}, "fatura desse lançamento já foi paga"),
    ({"installment_plan_id": "p1", "plan_installments": 3},
     "Mudar o número de parcelas é em Editar a compra no app"),
])
async def test_recusas_da_rpc_saem_antes_do_sim(monkeypatch, campos, trecho):
    _banco(monkeypatch, [{**LINHA, **campos}])
    alvo = await _alvo(FinanceAction(type=UPD, installments=2))
    assert trecho in alvo["correction_error"]
    assert "Ainda não mudei nada" in alvo["correction_error"]
    assert "convert_account" not in alvo


@pytest.mark.asyncio
async def test_linha_de_plano_com_o_mesmo_n_nao_e_conversao(monkeypatch):
    _banco(monkeypatch, [{**LINHA, "installment_plan_id": "p1", "plan_installments": 2}])
    alvo = await _alvo(FinanceAction(type=UPD, installments=2, new_description="Wardogs 2"))
    assert "convert_account" not in alvo and not alvo.get("correction_error")


@pytest.mark.asyncio
@pytest.mark.parametrize("n", [73, 99])
async def test_parcelas_fora_do_limite_da_rpc(monkeypatch, n):
    _banco(monkeypatch)
    alvo = await _alvo(FinanceAction(type=UPD, installments=n))
    assert "Escolha pelo menos 2 parcelas (e no máximo 72)" in alvo["correction_error"]


@pytest.mark.asyncio
async def test_linha_que_nao_e_do_workspace_nao_converte(monkeypatch):
    """O detalhe é lido com `workspace_id`; sem linha, nada é congelado."""
    _banco(monkeypatch, [])
    alvo = await _alvo(FinanceAction(type=UPD, installments=2))
    assert "convert_account" not in alvo
    assert alvo["correction_error"]


@pytest.mark.asyncio
async def test_empate_congela_por_candidato_e_nao_levanta_para_o_alvo(monkeypatch):
    _banco(monkeypatch, [dict(LINHA), {**LINHA, "id": "tx-2", "account_type": "checking",
                                       "account_id": "chk-inter", "account_name": "Inter"}])
    alvos = [{"table": "transactions", "status": "ambiguous",
              "candidates": [{"id": "tx-w", "label": "a", "table": "transactions"},
                             {"id": "tx-2", "label": "b", "table": "transactions"}]}]
    alvos = await resolve.conversoes(WS, [FinanceAction(type=UPD, installments=2)], alvos)
    a, b = alvos[0]["candidates"]
    assert a["convert_account"] == {"id": "card-nu", "name": "Nubank"}
    assert "Em qual cartão?" in b["convert_error"]
    assert "convert_account" not in alvos[0] and not alvos[0].get("correction_error")


# ---------------------------------------------------------------------------
# policy — a frase diz tudo que o SIM aprova; installments não é correção à toa
# ---------------------------------------------------------------------------

ALVO_CONV = {
    "table": "transactions", "status": "found",
    "convert_account": {"id": "card-nu", "name": "Nubank"},
    "candidates": [{"id": "tx-w", "label": "gasto de R$ 104,99 em *jogos* (Wardogs)",
                    "table": "transactions", "when": "20/09/2026", "nome": "Wardogs",
                    "amount_cents": 10499, "occurred_at": "2026-09-20",
                    "convert_account": {"id": "card-nu", "name": "Nubank"}}],
}


def test_frase_usa_o_nome_curto_e_nao_a_sentenca():
    frase = describe_for_confirmation(FinanceAction(type=UPD, installments=2), ALVO_CONV)
    assert frase == "parcelar Wardogs (R$ 104,99) em 2x no cartão Nubank, 1ª parcela em 20/09/2026"


def test_frase_diz_nome_categoria_e_data_novos_e_nao_fala_em_conta():
    acao = FinanceAction(type=UPD, installments=3, new_amount_cents=30000,
                         new_description="Wardogs Deluxe", new_category="lazer",
                         new_occurred_at="2026-09-18", new_account="nubank")
    frase = describe_for_confirmation(acao, ALVO_CONV)
    assert frase.startswith("parcelar Wardogs (R$ 300,00) em 3x no cartão Nubank, "
                            "1ª parcela em 18/09/2026")
    assert "nome → Wardogs Deluxe" in frase and "categoria → lazer" in frase
    assert "conta →" not in frase and "data →" not in frase


PLANO = {"table": "installment_plans", "status": "found",
         "candidates": [{"id": "p1", "label": "Tudo (10x) — TV", "table": "installment_plans",
                         "plan_installments": 10}]}


def test_installments_igual_ao_do_plano_sozinho_nao_e_correcao():
    assert erro_de_correcao(FinanceAction(type=UPD, installments=10), PLANO).startswith(
        "O que você quer mudar")


def test_installments_igual_ao_do_plano_com_nome_segue():
    assert erro_de_correcao(FinanceAction(type=UPD, installments=10, new_description="TV"),
                            PLANO) is None


def test_installments_diferente_do_plano_recusa():
    assert "Mudar o número de parcelas é em Editar a compra no app" in erro_de_correcao(
        FinanceAction(type=UPD, installments=12), PLANO)


def test_uma_parcela_sozinha_nao_e_correcao():
    assert erro_de_correcao(FinanceAction(type=UPD, installments=1), ALVO_CONV).startswith(
        "O que você quer mudar")


def test_erro_congelado_no_alvo_escolhido_volta():
    alvo = {**ALVO_CONV, "correction_error": "Em qual cartão? X"}
    assert erro_de_correcao(FinanceAction(type=UPD, installments=2), alvo) == "Em qual cartão? X"


# ---------------------------------------------------------------------------
# tool — a RPC do app, com os 8 argumentos na ordem da assinatura
# ---------------------------------------------------------------------------


def _ctx(**alvo) -> ExecContext:
    return ExecContext(
        user_id=UUID("11111111-1111-1111-1111-111111111111"), workspace_id=WS,
        phone="5551999999999", timezone="America/Sao_Paulo", texto="",
        source_message_id="w1", target={**ALVO_CONV, **alvo},
    )


def _rpc(monkeypatch, linha=LINHA, erro=None):
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((" ".join(sql.split()), args))
        if "convert_transaction_to_installments" in sql:
            if erro:
                raise erro
            return {"plano": "plano-novo"}
        return dict(linha) if linha else None

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    return chamadas


@pytest.mark.asyncio
async def test_tool_passa_os_atuais_da_linha_para_a_rpc(monkeypatch):
    chamadas = _rpc(monkeypatch)
    r = await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=2))
    leitura = chamadas[0]
    assert "workspace_id = %s" in leitura[0] and leitura[1] == ("tx-w", WS)
    rpc = [a for q, a in chamadas if "convert_transaction_to_installments" in q]
    assert rpc == [("tx-w", 10499, 2, "2026-09-20", "Wardogs", "jogos", "Nuuvem", "card-nu")]
    assert not r.read_only and r.result_id == "tx-w"
    assert "2x" in r.message and "Nubank" in r.message


@pytest.mark.asyncio
async def test_tool_troca_so_o_que_foi_pedido(monkeypatch):
    chamadas = _rpc(monkeypatch)
    await finance.update_transaction(
        _ctx(), FinanceAction(type=UPD, installments=3, new_amount_cents=30000,
                              new_description="Wardogs Deluxe", new_category="Lazer",
                              new_occurred_at="2026-09-18"))
    rpc = [a for q, a in chamadas if "convert_transaction_to_installments" in q]
    assert rpc == [("tx-w", 30000, 3, "2026-09-18", "Wardogs Deluxe", "lazer", "Nuuvem",
                    "card-nu")]


@pytest.mark.asyncio
async def test_tool_linha_de_outro_workspace_nao_chama_a_rpc(monkeypatch):
    chamadas = _rpc(monkeypatch, linha=None)
    r = await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=2))
    assert r.read_only
    assert not any("convert_transaction_to_installments" in q for q, _ in chamadas)


@pytest.mark.asyncio
async def test_tool_sem_cartao_congelado_nao_escreve(monkeypatch):
    chamadas = _rpc(monkeypatch)
    ctx = _ctx()
    ctx.target.pop("convert_account")
    r = await finance.update_transaction(ctx, FinanceAction(type=UPD, installments=2))
    assert r.read_only and "cartão" in r.message
    assert chamadas == []


@pytest.mark.asyncio
async def test_tool_recusa_da_rpc_vira_mensagem(monkeypatch):
    import psycopg

    class Recusa(psycopg.errors.RaiseException):
        pass

    _rpc(monkeypatch, erro=Recusa("Esse lançamento já é uma compra parcelada. Edite a compra "
                                  "inteira em Parceladas."))
    with pytest.raises(Level1Error) as err:
        await finance.update_transaction(_ctx(), FinanceAction(type=UPD, installments=2))
    assert "já é uma compra parcelada" in err.value.mensagem_usuario
    assert "Ainda não mudei nada" in err.value.mensagem_usuario


# ---------------------------------------------------------------------------
# grafo — resolve → gate → a frase da conversão → SIM → execução
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grafo_pelo_resolvedor_real_confirma_a_conversao_e_executa(monkeypatch, grafo):  # noqa: F811
    from app.graph import nodes
    from tests.test_hitl_flow import _for_actions_real

    monkeypatch.setattr(nodes.resolve, "for_actions", _for_actions_real)
    _banco(monkeypatch)
    cfg = {"configurable": {"thread_id": "parcelar-wardogs"}}
    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "installments": 2}])
        | {"text": "na verdade eu comprei em 2x no cartao", "last_write_id": "tx-w"},
        config=cfg,
    )
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation"
    assert pausa["summary"] == (
        "parcelar Wardogs (R$ 104,99) em 2x no cartão Nubank, 1ª parcela em 20/09/2026")
    assert "EXECUTOU" not in estado.get("results", [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "EXECUTOU" in final["results"]
    assert final["targets"][0]["convert_account"]["id"] == "card-nu"


@pytest.mark.asyncio
async def test_grafo_conta_corrente_pergunta_o_cartao_sem_interrupt(monkeypatch, grafo):  # noqa: F811
    from app.graph import nodes
    from tests.test_hitl_flow import _for_actions_real

    monkeypatch.setattr(nodes.resolve, "for_actions", _for_actions_real)
    _banco(monkeypatch, [{**LINHA, "account_id": "chk-inter", "account_type": "checking"}])
    final = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "installments": 2}])
        | {"last_write_id": "tx-w"},
        config={"configurable": {"thread_id": "parcelar-sem-cartao"}},
    )
    assert "__interrupt__" not in final
    assert "Em qual cartão? Você tem: *BB*, *Nubank*. Me manda de novo dizendo o cartão." in final["results"]
    assert "EXECUTOU" not in final["results"]


def _empate(monkeypatch, segundo):
    from app.graph import nodes

    cand = dict(ALVO_CONV["candidates"][0])

    async def empate(workspace_id, acoes, texto_cru, antecedente=None):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [cand, {**cand, "id": "tx-2", **segundo}]}]

    monkeypatch.setattr(nodes.resolve, "for_actions", empate)


@pytest.mark.asyncio
async def test_grafo_empate_escolha_frase_de_conversao_sim(monkeypatch, grafo):  # noqa: F811
    _empate(monkeypatch, {"convert_account": {"id": "card-bb", "name": "BB"}})
    cfg = {"configurable": {"thread_id": "parcelar-empate"}}
    estado = await grafo.ainvoke(_estado([{"type": "update_transaction", "installments": 2}]),
                                 config=cfg)
    assert _valor(estado)["kind"] == "choice"
    estado = await grafo.ainvoke(Command(resume={"approved": True, "candidate_id": "tx-2"}),
                                 config=cfg)
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation"
    assert "parcelar Wardogs (R$ 104,99) em 2x no cartão BB" in pausa["summary"]
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "EXECUTOU" in final["results"]
    assert final["targets"][0]["convert_account"] == {"id": "card-bb", "name": "BB"}


@pytest.mark.asyncio
async def test_grafo_empate_escolhido_sem_cartao_para_antes_do_sim(monkeypatch, grafo):  # noqa: F811
    _empate(monkeypatch, {"convert_account": None,
                          "convert_error": "Em qual cartão? Você tem: *BB*. Me manda de novo dizendo o cartão."})
    cfg = {"configurable": {"thread_id": "parcelar-empate-sem"}}
    await grafo.ainvoke(_estado([{"type": "update_transaction", "installments": 2}]), config=cfg)
    final = await grafo.ainvoke(Command(resume={"approved": True, "candidate_id": "tx-2"}),
                                config=cfg)
    assert "__interrupt__" not in final
    assert any("Em qual cartão?" in r for r in final["results"])
    assert "EXECUTOU" not in final["results"]
