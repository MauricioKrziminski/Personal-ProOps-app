"""Atributos de um lançamento novo pela conversa (lote C: F01 forma, F06 classificação, F09 detalhe).

Puro e sem rede. O modelo propõe (segunda chamada, `tools/atributos.py`); aqui mora o que decide
se a proposta vale: a compatibilidade forma x conta (espelho de `src/lib/payment-method.ts`, com
teste de paridade), o veto por ancoragem no texto e a montagem das colunas como o app grava.
"""

from __future__ import annotations

from app.domain.matching import normalize
from app.domain.payment_method import forma_de_pagamento

FORMAS = ("pix", "credit", "debit", "cash", "bank_transfer", "boleto")
PADROES = {"fixed": "fixed", "fixo": "fixed", "fixa": "fixed", "variable": "variable",
           "variavel": "variable"}
NECESSIDADES = {"essential": "essential", "essencial": "essential", "discretionary": "discretionary",
                "nao essencial": "discretionary", "superfluo": "discretionary"}
ROTULO_PADRAO = {"fixed": "fixo", "variable": "variável"}
ROTULO_NECESSIDADE = {"essential": "essencial", "discretionary": "não essencial"}

FRASE_DA_FORMA = {"pix": "no Pix", "credit": "no crédito", "debit": "no débito", "cash": "em dinheiro",
                  "bank_transfer": "por transferência", "boleto": "no boleto"}
_BANCARIAS = ("checking", "savings", "investment")

# O VETO da ancoragem: o modelo só vale se a frase tem a pista. Não infere nada — só recusa o que o
# texto não sustenta ("null nunca vira pix": um pix que a frase não disse é invenção do modelo).
_PISTAS_FORMA = {
    "pix": ("pix",), "credit": ("credito", "cartao"), "debit": ("debito",),
    "cash": ("dinheiro", "especie", "cash"), "bank_transfer": ("ted", "doc", "transfer"),
    "boleto": ("boleto",),
}
_PISTAS_PADRAO = {"fixed": ("fix",), "variable": ("variav",)}
_PISTAS_NECESSIDADE = {
    "essential": ("essenc", "necessar", "obrigat"),
    "discretionary": ("essenc", "superflu", "desnecess", "discricion", "opcional", "luxo", "dispens"),
}


def _tem_pista(texto: str, pistas: tuple[str, ...]) -> bool:
    palavras = normalize(texto).split()
    return any(p.startswith(pista) or (len(pista) > 3 and pista in p) for p in palavras for pista in pistas)


def erro_da_forma(metodo: str | None, tipo_conta: str | None) -> str | None:
    """Espelho de `paymentMethodError` (`src/lib/payment-method.ts`): None = combina.

    `tipo_conta` None = sem conta. O banco confere de novo no commit
    (`private.validate_payment_method`); aqui a pergunta sai ANTES do SIM.
    """
    if metodo is None:
        return None
    if metodo == "credit":
        return None if tipo_conta == "credit_card" else "Escolha um cartão para pagar no crédito."
    if tipo_conta is None:
        return None
    if metodo == "cash":
        return None if tipo_conta == "cash" else "Escolha uma conta de dinheiro para esta forma de pagamento."
    if metodo == "debit":
        return None if tipo_conta in _BANCARIAS else "Escolha uma conta para pagar no débito."
    return None if tipo_conta in (*_BANCARIAS, "credit_card") else (
        "Escolha uma conta bancária ou um cartão para esta forma de pagamento.")


def forma_proposta(valor: str | None, texto: str) -> str | None:
    """A forma que o modelo propôs, só se for conhecida E a frase a sustentar; senão None."""
    try:
        forma = forma_de_pagamento(valor)
    except ValueError:
        return None
    if forma is None or forma == "not_informed" or forma not in FORMAS:
        return None
    return forma if _tem_pista(texto, _PISTAS_FORMA[forma]) else None


def padrao_proposto(valor: str | None, texto: str) -> str | None:
    achado = PADROES.get(normalize(valor)) if valor else None
    return achado if achado and _tem_pista(texto, _PISTAS_PADRAO[achado]) else None


def necessidade_proposta(valor: str | None, texto: str) -> str | None:
    achado = NECESSIDADES.get(normalize(valor)) if valor else None
    return achado if achado and _tem_pista(texto, _PISTAS_NECESSIDADE[achado]) else None


def detalhe_ancorado(valor: str | None, texto: str) -> str | None:
    """O detalhe dito, só se está escrito na frase."""
    dito = (valor or "").strip()
    return dito if dito and normalize(dito) in normalize(texto) else None


def colunas_de_classificacao(kind: str, explicita: dict, padroes: dict | None) -> dict:
    """As quatro colunas F06 como o app grava (`resolveExpenseClassification`).

    Só gasto classifica. Dito = `explicit`; não dito = o padrão da categoria (`category_default`),
    ou nada. Nunca `explicit` com valor null, nem `category_default` sem valor.
    """
    if kind != "expense":
        return {}
    saida: dict = {}
    for dim, coluna, chave in (("pattern", "expense_pattern", "default_expense_pattern"),
                               ("necessity", "expense_necessity", "default_expense_necessity")):
        dito = explicita.get(coluna)
        padrao = (padroes or {}).get(chave)
        if dito:
            saida[coluna], saida[f"{coluna}_source"] = dito, "explicit"
        elif padrao:
            saida[coluna], saida[f"{coluna}_source"] = padrao, "category_default"
    return saida


def frase_dos_atributos(forma: str | None, padrao: str | None, necessidade: str | None,
                        detalhe: str | None, nota: str | None = None) -> str:
    """O que foi entendido, na frase do SIM: "no Pix · fixo · essencial · detalhe feira"."""
    partes = [
        FRASE_DA_FORMA.get(forma),
        ROTULO_PADRAO.get(padrao), ROTULO_NECESSIDADE.get(necessidade),
        f"detalhe {detalhe}" if detalhe else None, nota,
    ]
    return " · ".join(p for p in partes if p)
