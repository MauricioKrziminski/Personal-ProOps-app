"""Referência contextual: o que é termo de BUSCA e o que é ponteiro para o contexto.

"apagar essa última mensagem que gerou a nota" fez o agente buscar literalmente
por `'%última mensagem%'`. O modelo preencheu o campo de busca com um dêitico —
palavra que aponta para o contexto da conversa, não para o conteúdo do registro.

Aqui a recusa é determinística, e não instrução de prompt, pelo mesmo motivo de
`guards.py`: é a única forma do comportamento não mudar quando o modelo mudar.
"""

from __future__ import annotations

import re

# Casam o texto INTEIRO, nunca substring. É a diferença entre recusar "a última"
# (ponteiro) e preservar "última reunião" (nome de verdade de uma nota). Como
# substring, esta lista destruiria busca legítima.
_RECENCIA = re.compile(
    r"^\s*(o|a)?\s*(últim[oa]|ultim[oa]|mais\s+recente|de\s+agora|recente)"
    r"(\s+(lançamento|lancamento|nota|gasto|item|mensagem|coisa))?\s*$",
    re.IGNORECASE,
)
_VAGO = re.compile(
    r"^\s*(iss[oa]|aquil[oa]|aquel[ae]s?|ess[ea]s?"
    r"(\s+(item|coisa|mensagem|registro))?|o\s+que\s+existe|tudo)\s*$",
    re.IGNORECASE,
)


# Para varrer TEXTO LIVRE ("apaga o último"), sem âncora. Separado de propósito:
# usar este no clean_term recusaria "última reunião", que é nome legítimo. E usar
# o ancorado aqui não acharia nada dentro de uma frase. Dois usos, dois padrões.
_RECENCIA_SOLTA = re.compile(
    r"\b(últim[oa]|ultim[oa]|mais\s+recente|de\s+agora)\b", re.IGNORECASE
)


# "apaga a TV" e "apaga a TV por completo" pedem coisas diferentes: uma parcela
# ou a compra inteira. Sem âncora, igual ao _RECENCIA_SOLTA — é intenção de
# ESCOPO dita no meio da frase, não termo de busca.
_ESCOPO_TOTAL = re.compile(
    r"\b(por\s+completo|complet[oa]|inteir[oa]s?|"
    r"tod[oa]s?\s+as?\s+parcelas?|"
    r"a\s+compra\s+(toda|inteira)|o\s+parcelamento\s+(todo|inteiro)|"
    r"tudo)\b",
    re.IGNORECASE,
)


def wants_whole_plan(*textos: str | None) -> bool:
    """O usuário pediu a COMPRA INTEIRA, não uma parcela?

    Quando é sim, o alvo vira a linha de `installment_plans` — e a busca vai
    direto nessa tabela, nunca por dedução a partir das transações: a janela de
    resolução são os 40 lançamentos mais recentes, e as parcelas de uma compra
    antiga estão fora dela justamente quando alguém quer apagar tudo.
    """
    return any(t and _ESCOPO_TOTAL.search(t) for t in textos)


def clean_term(valor: str | None) -> str | None:
    """O termo utilizável para busca, ou None se for só um ponteiro."""
    if not valor:
        return None
    texto = valor.strip()
    if not texto:
        return None
    if _RECENCIA.match(texto) or _VAGO.match(texto):
        return None
    return texto


def wants_latest(*textos: str | None) -> bool:
    """Alguma das strings pede explicitamente o registro mais recente?

    Só é consultado quando NÃO sobrou termo de busca — aí "o último" deixa de ser
    string e vira intenção de recência, que é o que `undo_last` já significa.
    """
    for t in textos:
        if t and _RECENCIA_SOLTA.search(t):
            return True
    return False
