"""O nó de finanças roda até o fim quando o modelo omite descrição e conta.

## Por que este arquivo existe

`nodes.py` chamava `guards.extract_description_fallback` sem ter importado `guards`. Em produção
isso virava `NameError: name 'guards' is not defined` e o app respondia "Não consegui processar
essa mensagem" para QUALQUER compra parcelada — a primeira frase que o dono do produto digitou na
aba Agente ("Comprei uma TV em 12x de 300 no nubank") caiu exatamente aí.

O teste que existia (`TestDescriptionSlotAndFallback`) chamava as duas funções DIRETO do módulo
`guards`, então elas estavam cobertas e o caminho que as usa não estava. É a diferença entre
testar a peça e testar o encaixe: um `import` faltando só aparece quando alguém percorre a linha.

`ruff check app --select F,E9` também pega isto (F821) e entrou no passo de qualidade — mas linter
prova que o nome existe, não que o nó devolve as ações. Os dois têm dono diferente.
"""

from __future__ import annotations

import pytest

from app.graph import nodes
from app.graph.schemas import FinanceAction, FinanceActionType, FinancePlan
from app.services import gemini


class _ModeloFake:
    """O dublê do §Qualidade de `agent.md`: teste que fala com rede não entra."""

    def __init__(self, plano: FinancePlan) -> None:
        self._plano = plano

    async def ainvoke(self, _mensagens):
        return self._plano


@pytest.fixture
def sem_gemini(monkeypatch):
    def instalar(plano: FinancePlan) -> None:
        monkeypatch.setattr(gemini, "structured", lambda *_a, **_k: _ModeloFake(plano))
        monkeypatch.setattr(nodes.gemini, "structured", lambda *_a, **_k: _ModeloFake(plano))

    return instalar


ESTADO = {
    "text": "comprei uma tv em 12x de 300 no nubank",
    "timezone": "America/Sao_Paulo",
    "messages": None,
}


@pytest.mark.asyncio
async def test_parcelada_sem_conta_nem_descricao_completa_pelo_texto(sem_gemini):
    sem_gemini(
        FinancePlan(
            actions=[
                FinanceAction(
                    type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
                    amount_cents=360000,
                    installments=12,
                )
            ],
            confidence=0.9,
        )
    )

    saida = await nodes.finance_node(dict(ESTADO))

    (acao,) = saida["finance_actions"]
    # sem descrição do modelo não se inventa uma do texto: `required.py` pergunta "Do que se trata?"
    assert acao["description"] is None
    # "no nubank" sem a palavra "cartão" não é estrutura: a conta fica vazia e `faltando`
    # pergunta. Inferir daqui fazia "Na verdade..." virar o cartão *verdade*.
    assert acao["account"] is None


@pytest.mark.asyncio
async def test_na_verdade_no_cartao_generico_nao_vira_cartao_verdade(sem_gemini):
    """O incidente de 21/09/2026: "cartão" genérico + "Na verdade" no começo da frase."""
    sem_gemini(
        FinancePlan(
            actions=[
                FinanceAction(
                    type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
                    amount_cents=10499,
                    installments=2,
                    account="cartão",
                )
            ],
            confidence=0.9,
        )
    )

    saida = await nodes.finance_node({**ESTADO, "text": "Na verdade eu comprei em 2x no cartao"})

    (acao,) = saida["finance_actions"]
    assert acao["account"] is None


@pytest.mark.asyncio
async def test_despesa_simples_atravessa_o_no_sem_estourar(sem_gemini):
    """A despesa sem "comprei um X" não tem de onde tirar descrição — e isso é o certo.

    `extract_description_fallback` casa um SUBSTANTIVO depois de um verbo de compra; "gastei 45 no
    mercado" não tem um, e "mercado" está na lista de ignorados justamente para não virar
    descrição quando é categoria. O que este teste prende é que o nó **completa o que dá e segue**
    em vez de levantar — era o `NameError` que transformava "não achei descrição" em erro de
    processamento.
    """
    sem_gemini(
        FinancePlan(
            actions=[FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500)],
            confidence=1.0,
        )
    )

    saida = await nodes.finance_node({**ESTADO, "text": "gastei 45 no mercado"})

    (acao,) = saida["finance_actions"]
    assert acao["amount_cents"] == 4500
    # `account` só é preenchido na compra parcelada: sem cartão citado o lançamento nasce sem
    # conta (`finance.md`) em vez de adivinhar uma.
    assert acao["account"] is None


@pytest.mark.asyncio
async def test_comprei_isso_nao_vira_descricao_isso(sem_gemini):
    sem_gemini(FinancePlan(actions=[FinanceAction(
        type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE, amount_cents=20000, installments=2,
        account="nubank")], confidence=0.9))

    saida = await nodes.finance_node({**ESTADO, "text": "comprei isso em 2x de 100 no nubank"})

    (acao,) = saida["finance_actions"]
    assert acao["description"] is None
    from app.domain import required
    assert required.faltando(FinanceAction(**acao), "comprei isso em 2x de 100 no nubank")[0] == "description"


@pytest.mark.asyncio
async def test_nome_do_modelo_fica(sem_gemini):
    sem_gemini(FinancePlan(actions=[FinanceAction(
        type=FinanceActionType.CREATE_EXPENSE, amount_cents=8000, description="fone")],
        confidence=0.9))

    saida = await nodes.finance_node({**ESTADO, "text": "comprei um fone por 80"})

    assert saida["finance_actions"][0]["description"] == "fone"


@pytest.mark.asyncio
@pytest.mark.parametrize("generico", ["cartão", "cartao", "Crédito", "credito", " cartão "])
async def test_new_account_generico_vira_vazio(sem_gemini, generico):
    """"na verdade foi em 2x no cartão": cartão sem nome não é conta — o sistema usa o da linha."""
    sem_gemini(FinancePlan(actions=[FinanceAction(
        type=FinanceActionType.UPDATE_TRANSACTION, installments=2, new_account=generico)],
        confidence=0.9))

    saida = await nodes.finance_node({**ESTADO, "text": "na verdade foi em 2x no cartão"})

    assert saida["finance_actions"][0]["new_account"] is None


@pytest.mark.asyncio
async def test_new_account_nomeado_fica(sem_gemini):
    sem_gemini(FinancePlan(actions=[FinanceAction(
        type=FinanceActionType.UPDATE_TRANSACTION, new_account="Nubank")], confidence=0.9))

    saida = await nodes.finance_node({**ESTADO, "text": "na verdade foi no Nubank"})

    assert saida["finance_actions"][0]["new_account"] == "Nubank"


# ---------------------------------------------------------------------------
# E1 — conta que a pessoa NÃO escreveu não vale (emulador, 21/09/2026)
# ---------------------------------------------------------------------------

from app.tools import guards  # noqa: E402


@pytest.mark.parametrize("conta, texto, esperado", [
    ("carteira", "gastei 30 no cafe teste", None),       # o caso do emulador
    ("Itau", "gastei 45 no itaú", "Itau"),               # acento e caixa não importam
    ("BB", "gastei 45 no bb", "BB"),                     # nome curto inteiro vale
    ("Nubank Cartão", "gastei 45 no cartao nubank", "Nubank Cartão"),
    # custo aceito: apelido que não é token do nome vira "não citou" (conta padrão)
    ("Nubank", "gastei 45 no roxinho", None),
    # o que esta guarda NÃO pega: palavra do texto lida como conta (medido 2/20)
    ("teste", "gastei 30 no cafe teste", "teste"),
])
def test_conta_so_vale_se_esta_no_texto(conta, texto, esperado):
    assert guards.conta_do_texto(conta, texto) == esperado


@pytest.mark.asyncio
@pytest.mark.parametrize("tipo", [FinanceActionType.CREATE_EXPENSE, FinanceActionType.CREATE_INCOME])
async def test_no_node_conta_inventada_vira_nao_citou(sem_gemini, tipo):
    sem_gemini(FinancePlan(actions=[FinanceAction(type=tipo, amount_cents=3000,
                                                  account="carteira", description="cafe")],
                           confidence=0.9))
    out = await nodes.finance_node({**ESTADO, "text": "gastei 30 no cafe teste"})
    assert out["finance_actions"][0]["account"] is None


@pytest.mark.asyncio
async def test_no_node_conta_nova_da_correcao_nao_passa_pela_guarda(sem_gemini):
    """`new_account` tem tratamento próprio (resolvedor + pergunta); aqui não mexe."""
    sem_gemini(FinancePlan(actions=[FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION,
                                                  new_account="carteira")], confidence=0.9))
    out = await nodes.finance_node({**ESTADO, "text": "muda pra outra"})
    assert out["finance_actions"][0]["new_account"] == "carteira"
