"""O alvo de uma mutação se resolve ANTES da pergunta, e empate nunca executa.

Dois bugs que este módulo existe para matar, ambos medidos em 31/08/2026:

1. `finance.resolve_transaction` devolvia `found` na transação MAIS RECENTE
   quando a ação não trazia nenhum campo de busca — então "apaga aquilo" apagava
   silenciosamente o último lançamento.
2. A pergunta de confirmação era montada com os campos CRUS do modelo, então o
   usuário lia "apagar a nota sobre última mensagem" em vez da linha real.
"""

import pytest

from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import resolve


def _tx(id_, cents, cat, desc=None, data="2026-08-30"):
    return {"id": id_, "kind": "expense", "amount_cents": cents,
            "category": cat, "description": desc, "occurred_at": data}


@pytest.fixture
def linhas(monkeypatch):
    """Dubla `db.fetch`; devolve a lista que o teste configurar."""
    caixa = {"linhas": []}

    async def fake_fetch(sql, *args):
        return caixa["linhas"]

    monkeypatch.setattr(resolve.db, "fetch", fake_fetch)
    return caixa


class TestVeredito:
    def test_zero_um_e_varios(self):
        assert resolve.veredito([], str, "notes")[0] == "none"
        assert resolve.veredito([{"id": "1"}], lambda r: "x", "notes")[0] == "found"
        est, cands = resolve.veredito([{"id": "1"}, {"id": "2"}], lambda r: "x", "notes")
        assert est == "ambiguous" and len(cands) == 2

    def test_candidato_carrega_rotulo_e_tabela(self):
        _, cands = resolve.veredito([{"id": "9"}], lambda r: "gasto de R$ 45", "transactions")
        assert cands[0]["id"] == "9"
        assert cands[0]["label"] == "gasto de R$ 45"


class TestPorTransacao:
    @pytest.mark.asyncio
    async def test_sem_pista_e_sem_recencia_NAO_elege_a_mais_recente(self, linhas):
        # este é o teste que mata o `if not filtrou: return "found", candidatos[:1]`
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber"),
                            _tx("c", 1200, "cafe"), _tx("d", 900, "pao")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "ambiguous", "sem pista nenhuma não pode eleger ninguém"
        # mostra os recentes para o usuário escolher; o teto é `MOSTRAR`, que
        # existe para caber na Lista Interativa (10 linhas, a última é "nenhuma")
        assert 1 < len(cands) <= resolve.MOSTRAR

    @pytest.mark.asyncio
    async def test_sem_pista_COM_recencia_pega_a_mais_recente(self, linhas):
        # "apaga o último" continua funcionando — agora explícito, não por acidente
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=True)

        assert estado == "found" and cands[0]["id"] == "a"

    @pytest.mark.asyncio
    async def test_filtro_por_valor_acha_um(self, linhas):
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, amount_cents=3000)

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "b"

    @pytest.mark.asyncio
    async def test_banco_vazio_e_none(self, linhas):
        linhas["linhas"] = []
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)
        estado, _ = await resolve.por_transacao("ws", acao, quer_recente=True)
        assert estado == "none"


def test_fonte_de_pendentes_aponta_para_a_tabela_REAL():
    """`mark_paid` usa a chave lógica "pendentes", mas o alvo precisa carregar
    "transactions" — a allowlist do `ensure_owned` rejeitaria a chave lógica."""
    assert resolve._FONTES["pendentes"]["table"] == "transactions"


def test_todo_tipo_de_TARGETS_tem_fonte():
    for tipo, fonte in resolve.TARGETS.items():
        assert fonte in resolve._FONTES or fonte == "transactions", (tipo, fonte)


class TestPlanoComoAlvo:
    """"apaga a TV" com 10 parcelas era um empate entre dez linhas iguais.

    A compra inteira passa a ser a PRIMEIRA opção — o que transforma o empate
    numa pergunta honesta ("a parcela ou a compra toda?") em vez de dez opções
    indistinguíveis.
    """

    def test_candidato_diz_de_que_tabela_e(self):
        """Sem isso, uma mesma pergunta não podia misturar plano e parcela: o
        `ensure_owned` receberia o id do plano com a tabela `transactions`."""
        estado, cands = resolve.veredito(
            [{"id": "p1", "description": "TV", "installments": 10,
              "total_cents": 840000, "first_occurred_at": "2026-05-31"}],
            resolve._rotulo_plano,
            "installment_plans",
            resolve._detalhe_plano,
        )
        assert estado == "found"
        assert cands[0]["table"] == "installment_plans"
        assert "10x" in cands[0]["label"]
        # valor e data vão na descrição, que tem 72 caracteres, não no título
        assert "R$ 8.400,00" in cands[0]["when"]

    def test_o_escopo_sobrevive_ao_corte_da_meta(self):
        """Nome longo é normal, e `_cut` corta no fim. O que não pode sumir é o
        "Tudo (10x)" — sem ele a compra inteira e uma parcela solta apareceriam
        na mesma pergunta com rótulos quase idênticos."""
        from app.services.whatsapp import ROW_TITLE_MAX, _cut

        rotulo = resolve._rotulo_plano(
            {"description": "Televisão da sala de estar", "installments": 10}
        )
        assert _cut(rotulo, ROW_TITLE_MAX).startswith("Tudo (10x)")

    @pytest.mark.asyncio
    async def test_compra_inteira_vira_a_primeira_opcao(self, monkeypatch):
        async def fetch_one(query, *args):
            return {"id": "p1", "description": "TV", "installments": 10,
                    "total_cents": 840000, "first_occurred_at": "2026-05-31"}

        monkeypatch.setattr(resolve.db, "fetch_one", fetch_one)
        cands = await resolve._com_plano(
            "ws", [{"id": "tx-1", "label": "TV (1/10)", "table": "transactions"}]
        )
        assert cands[0]["table"] == "installment_plans"
        assert cands[1]["id"] == "tx-1"

    @pytest.mark.asyncio
    async def test_parcelas_de_planos_DIFERENTES_nao_ganham_cabeca(self, monkeypatch):
        """Com duas compras parceladas no meio, "a compra inteira" não tem
        significado único — e adivinhar qual é o erro que a Fase Cognitiva existe
        para não cometer."""

        async def fetch_one(query, *args):
            return None  # o `distinct` do SQL não devolve linha única

        monkeypatch.setattr(resolve.db, "fetch_one", fetch_one)
        original = [{"id": "tx-1", "label": "TV (1/10)", "table": "transactions"}]
        assert await resolve._com_plano("ws", original) == original

    @pytest.mark.asyncio
    async def test_sem_candidato_nao_inventa_plano(self, monkeypatch):
        async def explode(*a, **k):
            raise AssertionError("não devia consultar o banco sem candidatos")

        monkeypatch.setattr(resolve.db, "fetch_one", explode)
        assert await resolve._com_plano("ws", []) == []
