"""Ação incompleta NUNCA vira pergunta — vira pedido do que falta.

Bug real de 31/08/2026: "comprei um mac em 12x" produziu
`create_installment_purchase` com `amount_cents=None`, e o agente perguntou
**"Confirma registrar None em 12x?"**. O usuário não tem como responder isso.

A `0040` já dizia, em comentário, que era para ser assim ("ActionSpec já validado
ANTES de virar pergunta"). O que faltava era o código.
"""

from app.domain.required import faltando
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    FinanceQuery,
    FinanceQueryType,
    NotesAction,
    NotesActionType,
)


class TestFinancas:
    def test_o_bug_do_mac_em_12x(self):
        acao = FinanceAction(type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE, installments=12)
        pergunta = faltando(acao, texto_cru="comprei um mac em 12x")
        assert pergunta is not None
        assert "None" not in pergunta
        assert "valor" in pergunta.lower()

    def test_valor_no_texto_cru_salva_a_acao(self):
        # a rede determinística já existente: o modelo omitiu, o texto tem UM
        # número plausível. Não faz sentido perguntar o que está escrito ali.
        acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, category="mercado")
        assert faltando(acao, texto_cru="gastei 45 no mercado") is None

    def test_dois_numeros_nao_chutam(self):
        acao = FinanceAction(type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE, installments=12)
        assert faltando(acao, texto_cru="comprei um mac em 12x na terceira parcela") is not None

    def test_gasto_completo_passa(self):
        acao = FinanceAction(
            type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500, category="mercado"
        )
        assert faltando(acao, texto_cru="gastei 45 no mercado") is None

    def test_categoria_serve_de_identificacao(self):
        # "o item/serviço" neste modelo mora em description OU category —
        # exigir só description reprovaria "gastei 45 no mercado", que é o
        # formato mais comum do produto
        acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500,
                             category="mercado")
        assert faltando(acao, texto_cru="") is None

    def test_valor_sem_nenhuma_identificacao_pergunta(self):
        acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500)
        p = faltando(acao, texto_cru="gastei 45")
        assert p is not None and "foi" in p.lower()


class TestNaoBloqueiaOQueNaoPrecisa:
    def test_consulta_nunca_e_bloqueada(self):
        q = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS)
        assert faltando(q, texto_cru="quanto gastei") is None

    def test_delecao_nao_exige_valor(self):
        # o alvo de uma deleção é resolvido pela Fase Cognitiva, não por valor
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)
        assert faltando(acao, texto_cru="apaga o último") is None

    def test_nota_sem_valor_passa(self):
        n = NotesAction(type=NotesActionType.CREATE_NOTE, content="ligar pro dentista")
        assert faltando(n, texto_cru="anota: ligar pro dentista") is None
