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
# O substantivo que pode vir depois do ponteiro. UMA lista, usada pelos dois
# padrões abaixo — eram duas listas diferentes, e a diferença entre elas era o
# defeito: `_VAGO` conhecia "esse item" e não conhecia "esse lançamento", que é
# como quem fala de dinheiro fala. Resultado medido em produção (09/09/2026):
# "apague esse lançamento" virou busca literal por `%esse lançamento%`, não
# casou com nada, e o agente ofereceu os NOVE lançamentos mais recentes.
#
# ⚠️ "conta" está aqui e é a única palavra da lista que também nomeia uma
# ENTIDADE de verdade ("Conta corrente"). Hoje não colide: `clean_term` só é
# chamado para resolver transação, nota, lembrete, meta e bem — nunca para
# achar conta pelo nome. Quem for resolver conta por nome passando por aqui
# precisa tirar "conta" da lista ou usar outro caminho.
_SUBSTANTIVO = (
    r"lançamento|lancamento|gasto|despesa|receita|compra|pagamento|recebimento"
    r"|transação|transacao|conta|nota|lembrete|item|coisa|mensagem|registro"
)

_RECENCIA = re.compile(
    r"^\s*(o|a)?\s*(últim[oa]|ultim[oa]|mais\s+recente|de\s+agora|recente)"
    rf"(\s+({_SUBSTANTIVO}))?\s*$",
    re.IGNORECASE,
)
# ⚠️ O substantivo opcional pende do GRUPO de demonstrativos, não do último
# deles. Escrito como `a|b|c(\s+N)?`, a alternância corta antes do parêntese e
# só `c` aceita substantivo — foi o erro que fez "esse lançamento" continuar
# passando enquanto "este lançamento" passava a casar.
_VAGO = re.compile(
    r"^\s*((iss[oa]|aquil[oa]|aquel[ae]s?|ess[ea]s?|est[ea]s?)"
    rf"(\s+({_SUBSTANTIVO}))?|o\s+que\s+existe|tudo)\s*$",
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
