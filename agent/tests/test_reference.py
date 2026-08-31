"""Termo temporal/ordinal NÃO é termo de busca.

Em 31/08/2026 o pedido "apagar essa última mensagem que gerou a nota" fez o
agente rodar `content ilike '%última mensagem%'` e não achar nada. O modelo tinha
preenchido o campo de busca com um dêitico — palavra que aponta para o contexto,
não para o conteúdo.

A recusa é CÓDIGO e não prompt porque é a única forma do comportamento não mudar
quando o modelo mudar (mesma lição de guards.py).
"""

from app.domain.reference import clean_term, wants_latest


class TestCleanTerm:
    def test_deitico_temporal_nao_e_termo(self):
        for t in ("o último", "a última", "última", "a mais recente", "de agora"):
            assert clean_term(t) is None, t

    def test_deitico_vago_nao_e_termo(self):
        for t in ("isso", "aquilo", "aquele", "essa", "esse item", "o que existe", "tudo"):
            assert clean_term(t) is None, t

    def test_termo_legitimo_que_CONTEM_a_palavra_sobrevive(self):
        # o casamento é do texto INTEIRO. Substring destruiria busca boa: quem
        # tem uma nota chamada "última reunião" precisa poder achá-la.
        for t in ("última reunião", "mercado", "aluguel de agosto", "isso é importante"):
            assert clean_term(t) == t, t

    def test_vazio_e_none_viram_none(self):
        assert clean_term("") is None
        assert clean_term(None) is None
        assert clean_term("   ") is None


class TestWantsLatest:
    def test_reconhece_pedido_de_recencia(self):
        assert wants_latest("apaga o último")
        assert wants_latest(None, "quero apagar a última nota")

    def test_texto_comum_nao_pede_recencia(self):
        assert not wants_latest("gastei 45 no mercado")
        assert not wants_latest(None, None)
