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
    assert acao["description"] == "tv"
    assert acao["account"] == "nubank"


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
