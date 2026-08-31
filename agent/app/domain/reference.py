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
