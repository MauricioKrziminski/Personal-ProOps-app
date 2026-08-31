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


# ---------------------------------------------------------------------------
# clique de botão / lista
# ---------------------------------------------------------------------------
# `interpret` acima NÃO é tocado: o caminho de texto é o mesmo de sempre, e é ele
# que atende quem digita "sim" ou está num cliente que não renderiza interativo.

STALE = "stale"

# `pa:<uuid do pendente>:<sufixo>`. O uuid vai DENTRO do id do botão porque botão
# do WhatsApp continua clicável para sempre: um toque num "Confirmar" de três
# dias atrás, com outra pergunta aberta agora, aprovaria a ação errada. O índice
# único "uma pergunta aberta por thread" não protege disso — ele garante uma
# aberta, não que o clique se refira a ela.
_CLIQUE = re.compile(r"^pa:([0-9a-f-]{36}):(ok|no|none|c:(?P<cand>.+))$", re.IGNORECASE)

_ORDINAL = {
    "primeira": 1, "primeiro": 1, "segunda": 2, "segundo": 2,
    "terceira": 3, "terceiro": 3, "a de cima": 1,
}


def parse_click(clicked_id: str, pending_id: str) -> dict | None:
    """Decisão do clique, ou None se o id não se refere a ESTE pendente."""
    m = _CLIQUE.match(clicked_id or "")
    if not m or m.group(1).lower() != str(pending_id).lower():
        return None
    if m.group("cand"):
        return {"approved": True, "candidate_id": m.group("cand")}
    sufixo = m.group(2).lower()
    if sufixo == "ok":
        return {"approved": True}
    return {"approved": False, "none_of_these": sufixo == "none"}


def interpret_choice(texto: str | None, n: int) -> int | None:
    """1..n escolheu; 0 = nenhuma dessas; None = não é escolha.

    A guarda `1 <= k <= n` é essencial: "45" com 3 candidatos NÃO é escolha, é
    intenção nova. Sem ela, um valor digitado viraria seleção de candidato.
    """
    if not texto:
        return None
    t = texto.strip().lower()
    if re.match(r"^(nenhuma|nenhum|nenhuma dessas|outra|outro)\W*$", t):
        return 0
    if re.match(r"^(a de baixo|a última|a ultima)\W*$", t):
        return n
    for palavra, k in _ORDINAL.items():
        if re.match(rf"^(a |o )?{palavra}\W*$", t):
            return k if 1 <= k <= n else None
    m = re.match(r"^(\d+)\W*$", t)
    if m:
        k = int(m.group(1))
        return k if 1 <= k <= n else None
    return None


def decide(conteudo: dict, pendente: dict | None) -> dict | str | None:
    """dict = decisão · STALE = clique de outra pergunta · None = intenção nova."""
    clique = conteudo.get("clicked_id")
    if clique:
        # Clique NUNCA entra no grafo. Sem pendência aberta, o rótulo do botão
        # ("1) R$45 mercado") seria parseado como um lançamento de verdade —
        # a mesma classe do clique cruzado, e a pior, porque escreve dinheiro.
        if not pendente:
            return STALE
        return parse_click(clique, pendente["id"]) or STALE

    texto = conteudo.get("text")
    if pendente:
        candidatos = (pendente.get("action") or {}).get("candidates") or []
        if candidatos:
            k = interpret_choice(texto, len(candidatos))
            if k == 0:
                return {"approved": False, "none_of_these": True}
            if k:
                return {"approved": True, "candidate_id": candidatos[k - 1]["id"]}

    decisao = interpret(texto)
    return None if decisao is None else {"approved": decisao}
