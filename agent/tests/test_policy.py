"""A regra que decide o que precisa de um SIM. Errar para menos apaga dado sem
perguntar; errar para muito faz o usuário confirmar cada café."""

import pytest

from app.config import get_settings
from app.graph.policy import describe_for_confirmation, needs_confirmation
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    FinanceQuery,
    FinanceQueryType,
    NotesAction,
    NotesActionType,
)


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("HITL_AMOUNT_THRESHOLD_CENTS", "100000")  # R$ 1.000
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_destrutiva_sempre_pergunta():
    assert needs_confirmation(FinanceAction(type=FinanceActionType.UNDO_LAST), 1.0) == "destrutiva"
    assert needs_confirmation(
        FinanceAction(type=FinanceActionType.DELETE_TRANSACTION), 1.0
    ) == "destrutiva"
    assert needs_confirmation(
        NotesAction(type=NotesActionType.DELETE_NOTE, search_term="mercado"), 1.0
    ) == "destrutiva"


def test_gasto_comum_tambem_pergunta():
    # 21/09/2026, decisão do dono: toda escrita pede SIM, inclusive o café
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500)
    assert needs_confirmation(acao, 1.0) == "registro novo"


def test_nota_e_lembrete_tambem_perguntam():
    nota = NotesAction(type=NotesActionType.CREATE_NOTE, content="ligar pro dentista")
    lembrete = NotesAction(type=NotesActionType.CREATE_REMINDER, content="pagar aluguel",
                           remind_at="2026-09-22T09:00:00")
    assert needs_confirmation(nota, 1.0) == "registro novo"
    assert needs_confirmation(lembrete, 1.0) == "registro novo"


def test_unknown_nao_pergunta_porque_nao_escreve():
    # o registry devolve a ajuda sem tocar no banco; perguntar "confirma?" seria nada
    assert needs_confirmation(FinanceAction(type=FinanceActionType.UNKNOWN), 1.0) is None
    assert needs_confirmation(NotesAction(type=NotesActionType.UNKNOWN), 1.0) is None


def test_conta_padrao_congelada_no_alvo_nao_vira_item_existente():
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500)
    alvo = {"default_account": {"name": "Nubank"}}
    assert needs_confirmation(acao, 1.0, alvo) == "registro novo"


def test_frase_do_gasto_diz_o_efeito_e_a_conta_padrao():
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500,
                         category="mercado")
    frase = describe_for_confirmation(acao, {"default_account": {"name": "Nubank"}})
    assert frase == "registrar gasto de R$ 45,00 em mercado, na conta Nubank"


def test_frase_da_receita_sem_conta_padrao_diz_sem_conta():
    acao = FinanceAction(type=FinanceActionType.CREATE_INCOME, amount_cents=50000,
                         description="freela")
    frase = describe_for_confirmation(acao, {"default_account": {"name": None}})
    assert frase == "registrar receita de R$ 500,00 em freela, sem conta"


def test_frase_com_conta_citada_usa_a_citada():
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500,
                         category="mercado", account="Itaú")
    assert describe_for_confirmation(acao) == "registrar gasto de R$ 45,00 em mercado, no Itaú"


def test_frase_da_nota_e_do_lembrete():
    nota = NotesAction(type=NotesActionType.CREATE_NOTE, content="ligar pro dentista",
                       folder="saúde")
    assert describe_for_confirmation(nota) == "criar a nota «ligar pro dentista» na pasta saúde"
    lembrete = NotesAction(type=NotesActionType.CREATE_REMINDER, content="pagar aluguel",
                           remind_at="2026-09-22T09:00:00")
    assert describe_for_confirmation(lembrete) == (
        "criar o lembrete «pagar aluguel» para 22/09/2026 às 09:00")


def test_valor_acima_do_teto_pergunta():
    assert needs_confirmation(
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=100_001), 1.0
    ) == "valor alto"
    # exatamente no teto não é "valor alto" — mas ainda pede SIM, como todo registro
    assert needs_confirmation(
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=100_000), 1.0
    ) == "registro novo"


def test_baixa_confianca_pergunta_em_vez_de_escalar():
    # escalar gastaria a cota de 20/dia do modelo maior; perguntar é grátis
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500)
    assert needs_confirmation(acao, 0.4) == "baixa confiança"


def test_consulta_nunca_pergunta():
    for tipo in (FinanceQueryType.QUERY_BALANCE, FinanceQueryType.SIMULATE_SCENARIO):
        assert needs_confirmation(FinanceQuery(type=tipo, amount_cents=999_999_00), 0.1) is None


def test_frase_de_confirmacao_descreve_o_efeito():
    # ninguém confirma "delete_transaction", mas todo mundo entende a frase
    frase = describe_for_confirmation(
        FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, amount_cents=4500)
    )
    assert "apagar" in frase and "45,00" in frase
    assert "delete_transaction" not in frase


def test_frase_de_empate_nao_ecoa_o_modelo():
    """Com empate, a frase diz o EFEITO; as opções reais vão na lista.

    Caindo no texto do modelo aqui, o usuário voltava a ler "apagar a nota sobre
    esse item" — o eco que originou todo este trabalho.
    """
    from app.graph.policy import describe_for_confirmation
    from app.graph.schemas import NotesAction, NotesActionType

    acao = NotesAction(type=NotesActionType.DELETE_NOTE)
    alvo = {"status": "ambiguous", "candidates": [{"id": "a", "label": "x"}, {"id": "b", "label": "y"}]}

    frase = describe_for_confirmation(acao, alvo)

    assert "apagar" in frase
    assert "esse item" not in frase


# ---------------------------------------------------------------------------
# roteador inseguro pergunta o DOMÍNIO, antes de extrair
# ---------------------------------------------------------------------------


def test_confianca_baixa_do_roteador_pergunta_o_dominio():
    """Abaixo de 0,8 o agente não adivinha se é despesa ou nota.

    É uma pergunta DIFERENTE da confirmação de ação (0,6): esta acontece antes
    de extrair, e evita que "paguei o dentista" vire nota quando era gasto.
    """
    from app.graph.policy import dominio_incerto

    assert dominio_incerto(["financas"], 0.7)
    assert not dominio_incerto(["financas"], 0.95)
    # multi-intent explícito não é incerteza: o router disse que são os dois
    assert not dominio_incerto(["financas", "notas"], 0.7)
    # domínio sem ambiguidade de registro não pergunta
    assert not dominio_incerto(["geral"], 0.5)
    assert not dominio_incerto(["financas_consulta"], 0.5)


# ---------------------------------------------------------------------------
# new_description — "nome → X" nos dois ramos (com alvo e sem alvo)
# ---------------------------------------------------------------------------


def test_new_description_aparece_com_alvo_resolvido():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_description="Compra da TV")
    alvo = {"status": "found", "candidates": [{"id": "t1", "label": "gasto de R$ 45,00"}]}
    frase = describe_for_confirmation(acao, alvo)
    assert "nome → Compra da TV" in frase


def test_new_description_aparece_sem_alvo():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_description="Compra da TV")
    frase = describe_for_confirmation(acao)
    assert "nome → Compra da TV" in frase


# ---------------------------------------------------------------------------
# correção de plano de parcelamento — por parcela, no total, e sem dizer qual
# ---------------------------------------------------------------------------


def _alvo_plano(amount_unit=None, **overrides):
    candidato = {
        "id": "p1",
        "label": "TV",
        "table": "installment_plans",
        "editaveis": 8,
        "travado_cents": 60000,
        "total_cents": 300000,
        "plan_installments": 10,
    }
    candidato.update(overrides)
    alvo = {"table": "installment_plans", "status": "found", "candidates": [candidato]}
    if amount_unit:
        alvo["amount_unit"] = amount_unit
    return alvo


def test_correcao_de_plano_por_parcela():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=35000)
    frase = describe_for_confirmation(acao, _alvo_plano(amount_unit="parcela"))
    assert frase == (
        "corrigir TV: R$ 350,00 por parcela nas 8 que ainda podem mudar "
        "(novo total R$ 3.400,00; as pagas ficam como estão)"
    )


def test_correcao_de_plano_no_total():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=340000)
    frase = describe_for_confirmation(acao, _alvo_plano(amount_unit="total"))
    assert frase == (
        "corrigir o total de TV: R$ 3.000,00 → R$ 3.400,00 em 10x "
        "(R$ 2.800,00 divididos nas 8 que podem mudar)"
    )


def test_correcao_de_plano_sem_unidade_nao_finge_que_nada_muda():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=340000)
    frase = describe_for_confirmation(acao, _alvo_plano())
    assert "R$ 3.400,00" in frase
    assert "total" in frase and "parcela" in frase
    assert "nada muda" not in frase


def test_correcao_de_plano_por_parcela_com_nome_nao_perde_a_outra_correcao():
    acao = FinanceAction(
        type=FinanceActionType.UPDATE_TRANSACTION,
        new_amount_cents=35000,
        new_description="Nova TV",
    )
    frase = describe_for_confirmation(acao, _alvo_plano(amount_unit="parcela"))
    assert frase == (
        "corrigir TV: R$ 350,00 por parcela nas 8 que ainda podem mudar "
        "(novo total R$ 3.400,00; as pagas ficam como estão); "
        "nome → Nova TV em todas as parcelas"
    )


def test_correcao_de_plano_no_total_com_categoria_nao_perde_a_outra_correcao():
    acao = FinanceAction(
        type=FinanceActionType.UPDATE_TRANSACTION,
        new_amount_cents=340000,
        new_category="eletronicos",
    )
    frase = describe_for_confirmation(acao, _alvo_plano(amount_unit="total"))
    assert frase == (
        "corrigir o total de TV: R$ 3.000,00 → R$ 3.400,00 em 10x "
        "(R$ 2.800,00 divididos nas 8 que podem mudar); "
        "categoria → eletronicos em todas as parcelas"
    )


def test_correcao_de_plano_sem_unidade_nao_explode_com_candidato_de_hoje():
    """Estado intermediário entre T1 e T3: o resolvedor ainda não congela
    `editaveis`/`travado_cents` no candidato — só o ramo sem `amount_unit` roda
    nele, e não pode levantar `KeyError` no meio de uma confirmação."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=340000)
    alvo = {
        "table": "installment_plans",
        "status": "found",
        "candidates": [{"id": "p1", "label": "TV", "table": "installment_plans", "plan_installments": 10}],
    }
    frase = describe_for_confirmation(acao, alvo)
    assert "R$ 3.400,00" in frase


def test_correcao_de_plano_com_uma_editavel_fala_no_singular():
    """E4: "divididos nas 1 que podem mudar" — medido no emulador em 21/09/2026."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=13500)
    frase = describe_for_confirmation(
        acao, _alvo_plano(amount_unit="total", editaveis=1, travado_cents=6749,
                          total_cents=13498, plan_installments=2))
    assert frase == (
        "corrigir o total de TV: R$ 134,98 → R$ 135,00 em 2x "
        "(R$ 67,51 na única que pode mudar)"
    )
    frase = describe_for_confirmation(
        FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=7000),
        _alvo_plano(amount_unit="parcela", editaveis=1, travado_cents=6749))
    assert frase == (
        "corrigir TV: R$ 70,00 por parcela na única que ainda pode mudar "
        "(novo total R$ 137,49; as pagas ficam como estão)"
    )


def test_correcao_de_plano_sem_unidade_com_nome_diz_que_o_nome_vale_para_todas():
    """T-a: nome e categoria mudam em TODAS as parcelas, inclusive as pagas; "as pagas
    ficam como estão de qualquer forma" prometia o contrário."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=340000,
                         new_description="Nova TV")
    frase = describe_for_confirmation(acao, _alvo_plano())
    assert frase == (
        "corrigir TV: novo valor R$ 3.400,00 — é o total da compra ou o valor de cada "
        "parcela? No valor, as pagas ficam como estão; nome → Nova TV em todas as parcelas"
    )


def test_empate_de_conversao_pergunta_parcelar_qual():
    """T-b: o empate da conversão perguntava "corrigir … qual?"."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, installments=2,
                         description="wardogs")
    alvo = {"table": "transactions", "status": "ambiguous",
            "candidates": [{"id": "a", "label": "x"}, {"id": "b", "label": "y"}]}
    assert describe_for_confirmation(acao, alvo) == "parcelar wardogs em 2x — qual?"


# ---------------------------------------------------------------------------
# D1 — adotar um lançamento avulso como parcela 1 de uma compra parcelada nova
# ---------------------------------------------------------------------------


def test_conversao_em_parcelas():
    acao = FinanceAction(
        type=FinanceActionType.UPDATE_TRANSACTION, installments=2, new_amount_cents=10499
    )
    alvo = {
        "table": "transactions",
        "status": "found",
        "convert_account": {"id": "acc1", "name": "Nubank"},
        "candidates": [
            {"id": "t1", "label": "wardogs", "table": "transactions", "when": "21/09/2026"}
        ],
    }
    frase = describe_for_confirmation(acao, alvo)
    assert frase == "parcelar wardogs (R$ 104,99) em 2x no cartão Nubank, 1ª parcela em 21/09/2026"


def test_conversao_em_parcelas_sem_valor_nao_inventa_zero():
    """Sem `new_amount_cents` e sem o campo (ainda não congelado no candidato),
    a frase não pode afirmar 'R$ 0,00' — que seria dinheiro inventado."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, installments=2)
    alvo = {
        "table": "transactions",
        "status": "found",
        "convert_account": {"id": "acc1", "name": "Nubank"},
        "candidates": [
            {"id": "t1", "label": "wardogs", "table": "transactions", "when": "21/09/2026"}
        ],
    }
    frase = describe_for_confirmation(acao, alvo)
    assert "R$ 0,00" not in frase


def test_conversao_exige_tabela_transactions():
    """`convert_account` sozinho não basta — alvo fora de `transactions` (ex.:
    um plano) não é a conversão D1, mesmo com `installments >= 2`."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, installments=2)
    alvo = {
        "table": "installment_plans",
        "status": "found",
        "convert_account": {"id": "acc1", "name": "Nubank"},
        "candidates": [
            {"id": "p1", "label": "TV", "table": "installment_plans", "plan_installments": 10}
        ],
    }
    frase = describe_for_confirmation(acao, alvo)
    assert "parcelar" not in frase
    assert "cartão Nubank" not in frase


def test_conversao_com_uma_parcela_nao_dispara():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, installments=1, new_amount_cents=10499)
    alvo = {
        "table": "transactions",
        "status": "found",
        "convert_account": {"id": "acc1", "name": "Nubank"},
        "candidates": [
            {"id": "t1", "label": "wardogs", "table": "transactions", "when": "21/09/2026"}
        ],
    }
    frase = describe_for_confirmation(acao, alvo)
    assert "parcelar" not in frase


def test_conversao_sem_data_omite_o_trecho():
    acao = FinanceAction(
        type=FinanceActionType.UPDATE_TRANSACTION, installments=2, new_amount_cents=10499
    )
    alvo = {
        "table": "transactions",
        "status": "found",
        "convert_account": {"id": "acc1", "name": "Nubank"},
        "candidates": [{"id": "t1", "label": "wardogs", "table": "transactions"}],  # sem "when"
    }
    frase = describe_for_confirmation(acao, alvo)
    assert frase == "parcelar wardogs (R$ 104,99) em 2x no cartão Nubank"
    assert "1ª parcela em" not in frase


# ---------------------------------------------------------------------------
# par_de_substituicao — puro: criar algo novo no mesmo lote que muda o que já existe
# ---------------------------------------------------------------------------


def test_par_de_substituicao_com_create_e_delete_encontrado():
    from app.graph.policy import par_de_substituicao

    acoes = [
        FinanceAction(type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE),
        FinanceAction(type=FinanceActionType.DELETE_TRANSACTION),
    ]
    alvos = [{}, {"status": "found", "candidates": [{"id": "x"}]}]
    assert par_de_substituicao(acoes, alvos) == {0, 1}


def test_par_de_substituicao_com_update_ambiguo_tambem_conta():
    from app.graph.policy import par_de_substituicao

    acoes = [
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE),
        FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION),
    ]
    alvos = [{}, {"status": "ambiguous", "candidates": [{"id": "a"}, {"id": "b"}]}]
    assert par_de_substituicao(acoes, alvos) == {0, 1}


def test_par_de_substituicao_alvo_none_nao_dispara():
    from app.graph.policy import par_de_substituicao

    acoes = [
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE),
        FinanceAction(type=FinanceActionType.DELETE_TRANSACTION),
    ]
    alvos = [{}, {"status": "none", "candidates": []}]
    assert par_de_substituicao(acoes, alvos) == set()


def test_par_de_substituicao_sem_create_nao_dispara():
    from app.graph.policy import par_de_substituicao

    acoes = [FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)]
    alvos = [{"status": "found", "candidates": [{"id": "x"}]}]
    assert par_de_substituicao(acoes, alvos) == set()


def test_par_de_substituicao_undo_last_conta_mesmo_sem_alvo():
    """`undo_last` sempre mira o mais recente — conta mesmo sem alvo resolvido."""
    from app.graph.policy import par_de_substituicao

    acoes = [
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE),
        FinanceAction(type=FinanceActionType.UNDO_LAST),
    ]
    alvos = [{}, {}]
    assert par_de_substituicao(acoes, alvos) == {0, 1}


def test_uma_parcela_do_snapshot_nao_pergunta_total_ou_parcela():
    """"muda a 3ª parcela para 300": o alvo é UMA linha congelada; perguntar "é o total
    da compra ou cada parcela?" ali não tem resposta que faça sentido."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=30000)
    alvo = _alvo_plano(installment_snapshot={"rows": [{"id": "tx3"}]}, label="parcela 3 — TV")
    frase = describe_for_confirmation(acao, alvo)
    assert "total da compra" not in frase and "parcelas em aberto" not in frase
    assert "R$ 300,00" in frase


def test_renomear_a_compra_inteira_diz_que_vale_para_todas_as_parcelas():
    """Nome e categoria vão pela `update_installment_plan`, que os aplica também às
    pagas (Reparcelar, finance.md) — a frase não pode prometer o contrário."""
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_description="TV sala")
    frase = describe_for_confirmation(acao, _alvo_plano())
    assert "inclusive as pagas" in frase and "só as parcelas em aberto" not in frase
