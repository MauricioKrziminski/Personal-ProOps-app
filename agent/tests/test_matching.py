"""Casamento de nome de conta/cartão.

O teste de usabilidade de 31/08/2026 pegou três falhas na mesma pergunta
("em qual cartão foi essa compra?"):

- a frase inteira virava o nome do cartão ("acabei de criar um pelo app, chama
  nubank cartao");
- acento derrubava a busca — "itau" não achava "Itaú" em nenhum dos três
  caminhos que buscavam conta por nome;
- e os três caminhos usavam matchers diferentes, então validar e executar
  podiam discordar.

Este módulo prende o comportamento do helper único que substituiu os três.
"""

import pytest

from app.domain import matching

CARTOES = [
    {"id": "1", "name": "Itaú"},
    {"id": "2", "name": "Nubank Cartão"},
    {"id": "3", "name": "Nu"},
]


def nomes(linhas):
    return [l["name"] for l in linhas]


class TestNormalize:
    def test_tira_acento_caixa_e_pontuacao(self):
        assert matching.normalize("Itaú Uniclass!") == "itau uniclass"

    def test_colapsa_espaco_e_aguenta_vazio(self):
        assert matching.normalize("  C6   Bank  ") == "c6 bank"
        assert matching.normalize(None) == ""


class TestAcentoECaixa:
    def test_itau_sem_acento_acha_Itau(self):
        assert nomes(matching.match_accounts("itau", CARTOES)) == ["Itaú"]

    def test_caixa_alta_nao_atrapalha(self):
        assert nomes(matching.match_accounts("NUBANK", CARTOES)) == ["Nubank Cartão"]


class TestFraseInteira:
    def test_o_bug_do_teste_de_usabilidade(self):
        """A queixa literal: o usuário conversa e o nome está no meio da frase."""
        frase = "acabei de criar um pelo app, chama nubank cartao"
        assert nomes(matching.match_accounts(frase, CARTOES)) == ["Nubank Cartão"]

    def test_nome_curto_nao_casa_com_qualquer_frase(self):
        """"Nu" está contido em quase todo texto — por isso a direção
        nome-dentro-do-termo exige 3 caracteres."""
        assert matching.match_accounts("usei o cartao novo", CARTOES) == []


class TestTypo:
    def test_erro_de_digitacao_ainda_acha(self):
        assert nomes(matching.match_accounts("nubamk", CARTOES)) == ["Nubank Cartão"]

    def test_banco_diferente_nao_vira_quase_acerto(self):
        assert matching.match_accounts("inter", CARTOES) == []


class TestCardinalidade:
    def test_sem_conta_correspondente_devolve_vazio(self):
        assert matching.match_accounts("banco do brasil", CARTOES) == []

    def test_empate_devolve_os_dois_e_nao_escolhe(self):
        """Escolher no empate é como o lançamento vai para o cartão errado.
        Quem chama decide se pergunta — aqui só se recusa a chutar."""
        parecidos = [
            {"id": "1", "name": "Nubank Roxinho"},
            {"id": "2", "name": "Nubank Ultravioleta"},
        ]
        assert len(matching.match_accounts("nubank", parecidos)) == 2

    def test_exato_ganha_do_parcial(self):
        linhas = [{"id": "1", "name": "Nubank Cartão"}, {"id": "2", "name": "Nubank"}]
        assert nomes(matching.match_accounts("nubank", linhas)) == ["Nubank"]

    def test_termo_vazio_nunca_casa_com_tudo(self):
        assert matching.match_accounts("", CARTOES) == []
        assert matching.match_accounts(None, CARTOES) == []


class TestResolveAccount:
    """`resolve_account` CASA, e não decide o que fazer quando não dá.

    Ele trata o tier de semelhança diferente do rascunho: acertar um typo é ótimo
    quando dá para confirmar, e é um jeito novo de escolher a conta errada quando
    não dá. Empate — exato ou por semelhança — devolve `None`; quem transforma
    esse `None` em pergunta é `conta_citada`, e é por ele que passam gasto,
    receita, transferência, parcelamento e pagamento de fatura.
    """

    @pytest.fixture
    def contas(self, monkeypatch):
        from app import db

        linhas = []

        async def falso(workspace_id, *, only_cards=False):
            return linhas

        monkeypatch.setattr(db, "accounts", falso)
        return linhas

    @pytest.mark.asyncio
    async def test_acento_errado_resolve(self, contas):
        from app.tools.finance import resolve_account

        contas.append({"id": "c1", "name": "Itaú", "type": "checking"})
        assert await resolve_account("ws", "itau") == "c1"

    @pytest.mark.asyncio
    async def test_typo_unico_ainda_resolve(self, contas):
        from app.tools.finance import resolve_account

        contas.append({"id": "c1", "name": "Bradesco", "type": "checking"})
        assert await resolve_account("ws", "bradeso") == "c1"

    @pytest.mark.asyncio
    async def test_typo_com_dois_quase_acertos_NAO_chuta(self, contas):
        from app.tools.finance import resolve_account

        contas.extend([
            {"id": "c1", "name": "Nubank Roxinho", "type": "credit_card"},
            {"id": "c2", "name": "Nubank Ultravioleta", "type": "credit_card"},
        ])
        # sem ninguém para perguntar, chutar a conta é pior que lançar sem conta
        assert await resolve_account("ws", "nubankk") is None

    @pytest.mark.asyncio
    async def test_conta_desconhecida_nunca_derruba_o_lancamento(self, contas):
        from app.tools.finance import resolve_account

        contas.append({"id": "c1", "name": "Itaú", "type": "checking"})
        assert await resolve_account("ws", "banco do brasil") is None


class TestAddMonths:
    """Espelha `private.add_months` da 0013 — as duas pontas precisam concordar
    sobre em que MÊS cada parcela cai, senão a retroação erra a fatura."""

    def test_recua_preservando_o_dia(self):
        from app.domain.dates import add_months

        assert add_months("2026-08-31", -3) == "2026-05-31"
        assert add_months("2026-03-31", -3) == "2025-12-31"

    def test_clampa_no_ultimo_dia_do_mes_curto(self):
        from app.domain.dates import add_months

        assert add_months("2026-05-31", -3) == "2026-02-28"
        assert add_months("2026-01-31", 1) == "2026-02-28"

    def test_o_mes_sempre_volta_certo(self):
        """O dia pode driftar quando clampa; o mês, nunca — e é o mês que decide
        a fatura."""
        from app.domain.dates import add_months

        for dia in ("2026-05-31", "2026-08-15", "2026-01-31"):
            volta = add_months(add_months(dia, -3), 3)
            assert volta[:7] == dia[:7]


class TestColisaoDeNome:
    """Nome de banco vira nome dos DOIS — e o cadastro na hora torna isso comum.

    Quem tem a conta corrente "Itaú" e cria o cartão "Itaú" pelo WhatsApp passa a
    ter duas linhas que normalizam igual. Sem filtro de tipo, o parcelamento podia
    cair na conta corrente, e aí `set_invoice` grava `invoice_id := null` em
    silêncio — o estado que "cartão obrigatório em parcelado" existe para impedir.
    """

    @pytest.fixture
    def duas_contas(self, monkeypatch):
        from app import db

        linhas = [
            {"id": "conta", "name": "Itaú", "type": "checking"},
            {"id": "cartao", "name": "Itaú", "type": "credit_card"},
        ]

        async def falso(workspace_id, *, only_cards=False):
            return [l for l in linhas if not only_cards or l["type"] == "credit_card"]

        monkeypatch.setattr(db, "accounts", falso)

    @pytest.mark.asyncio
    async def test_parcelado_resolve_para_o_CARTAO(self, duas_contas):
        from app.tools.finance import resolve_account

        assert await resolve_account("ws", "itau", only_cards=True) == "cartao"

    @pytest.mark.asyncio
    async def test_sem_filtro_o_empate_NAO_escolhe_por_ordem(self, duas_contas):
        """Sem o filtro as duas linhas casam — e aí ninguém escolhe.

        ⚠️ Este teste já afirmou o contrário (`in ("conta", "cartao")`), com o
        comentário "quem decide é a ordem". Ele estava DOCUMENTANDO um defeito:
        "gastei 45 no itau", com conta e cartão de mesmo nome, gravava em quem
        viesse primeiro do banco. É a mesma confusão que lançou um salário de
        R$ 4.000 dentro da fatura pelo app, e aqui não havia nem tela mostrando
        a escolha.
        """
        from app.tools.finance import resolve_account

        assert await resolve_account("ws", "itau") is None

    @pytest.mark.asyncio
    async def test_o_empate_vira_pergunta_com_os_dois_nomes(self, duas_contas):
        from app.tools.finance import conta_citada
        from app.tools.guards import Level1Error

        with pytest.raises(Level1Error) as erro:
            await conta_citada("ws", "itau")
        assert "mais de uma" in str(erro.value)
