"""Interpretação de SIM/NÃO — determinística, zero token.

É a resposta mais comum do fluxo de confirmação. Gastar uma chamada de LLM para
decidir se "sim" quer dizer sim seria queimar cota do Flash-Lite (500/dia) na
pergunta mais fácil do produto.

Conservador de propósito: o que não casa devolve None e a mensagem é tratada como
INTENÇÃO NOVA, não como confirmação. Interpretar "acho que sim" como aprovação
para apagar um lançamento é exatamente o erro que o HITL existe para evitar.
"""

from __future__ import annotations

import re

_SIM = re.compile(
    r"^(sim|s|isso|isso a[ií]|pode|pode sim|confirma|confirmar|confirmado|manda|"
    r"ok|okay|okey|claro|beleza|blz|bora|👍|✅)\W*$",
    re.IGNORECASE,
)
_NAO = re.compile(
    r"^(n[ãa]o|n|nop|nao pode|cancela|cancelar|deixa|deixa pra l[áa]|para|"
    r"esquece|melhor n[ãa]o|❌|🚫)\W*$",
    re.IGNORECASE,
)


def interpret(texto: str | None) -> bool | None:
    """True = aprovou, False = recusou, None = falou outra coisa."""
    limpo = (texto or "").strip()
    if not limpo:
        return None
    if _SIM.match(limpo):
        return True
    if _NAO.match(limpo):
        return False
    return None
