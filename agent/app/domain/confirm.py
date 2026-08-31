"""Interpretação de SIM/NÃO — determinística, zero token.

É a resposta mais comum do fluxo de confirmação. Gastar uma chamada de LLM para
decidir se "sim" quer dizer sim seria queimar cota do Flash-Lite (500/dia) na
pergunta mais fácil do produto.

Conservador de propósito: o que não casa devolve None e a mensagem é tratada como
INTENÇÃO NOVA, não como confirmação. Interpretar "acho que sim" como aprovação
para apagar um lançamento é exatamente o erro que o HITL existe para evitar.
"""

from __future__ import annotations

import logging
import re

# O SIM/NÃO por regex saiu em 31/08/2026, por decisão explícita: "sim, pode
# fazer", "manda bala", "cancela isso" são variações demais para uma lista de
# padrões. Quem classifica texto digitado agora é o modelo (`interpret_text`
# abaixo), e o clique no botão é igualdade exata (`parse_click`).
#
# A troca custa uma chamada por confirmação digitada e ~2s de latência. Em
# compensação, falha FECHADA: modelo fora do ar, cota estourada ou resposta
# ambígua devolvem None, que o worker trata como intenção nova — nunca aprovação.

# ---------------------------------------------------------------------------
# clique de botão / lista
# ---------------------------------------------------------------------------
# `interpret` acima NÃO é tocado: o caminho de texto é o mesmo de sempre, e é ele
# que atende quem digita "sim" ou está num cliente que não renderiza interativo.

log = logging.getLogger(__name__)

STALE = "stale"

# `pa:<uuid do pendente>:<sufixo>`. O uuid vai DENTRO do id do botão porque botão
# do WhatsApp continua clicável para sempre: um toque num "Confirmar" de três
# dias atrás, com outra pergunta aberta agora, aprovaria a ação errada. O índice
# único "uma pergunta aberta por thread" não protege disso — ele garante uma
# aberta, não que o clique se refira a ela.
# Sufixos válidos, comparados por IGUALDADE EXATA. Sem regex: o payload do
# botão é estruturado e escrito por nós, então casar padrão nele seria inventar
# ambiguidade onde não existe.
_PREFIXO = "pa:"
_SUFIXOS = {"ok", "no", "none"}
_ESCOLHA = "c:"

_ORDINAL = {
    "primeira": 1, "primeiro": 1, "segunda": 2, "segundo": 2,
    "terceira": 3, "terceiro": 3, "a de cima": 1,
}


def parse_click(clicked_id: str, pending_id: str) -> dict | None:
    """Decisão do clique, ou None se o id não se refere a ESTE pendente.

    Igualdade exata, campo a campo. O id tem a forma `pa:<uuid>:<sufixo>` e foi
    ESCRITO por nós — não há nada a interpretar. O uuid do pendente vai dentro
    porque botão do WhatsApp continua clicável para sempre: um toque num
    "Confirmar" de três dias atrás aprovaria a pergunta aberta agora.
    """
    if not clicked_id or not clicked_id.startswith(_PREFIXO):
        return None
    partes = clicked_id[len(_PREFIXO):].split(":", 1)
    if len(partes) != 2:
        return None
    uuid_do_clique, sufixo = partes
    if uuid_do_clique.lower() != str(pending_id).lower():
        return None

    if sufixo.startswith(_ESCOLHA):
        escolhido = sufixo[len(_ESCOLHA):]
        return {"approved": True, "candidate_id": escolhido} if escolhido else None
    if sufixo not in _SUFIXOS:
        return None
    if sufixo == "ok":
        return {"approved": True}
    return {"approved": False, "none_of_these": sufixo == "none"}


# ---------------------------------------------------------------------------
# resposta DIGITADA: semântica, não regex
# ---------------------------------------------------------------------------
# Decisão de 31/08/2026: "sim, pode fazer", "manda bala", "cancela isso" são
# variações demais para uma lista de padrões. Quem classifica é o modelo.
#
# A trava que não pode cair: só "approve" aprova. Ambíguo, resposta fora do
# enum, cota estourada ou modelo fora do ar caem todos em None — que o worker
# trata como intenção NOVA, não como aprovação. Um portão que abre quando o
# classificador falha não é portão.

_PROMPT_CONFIRMACAO = """Você classifica a resposta de um usuário a uma pergunta de confirmação.

A pergunta feita foi: {resumo}

Responda com UMA palavra:
- approve  — o usuário concordou claramente ("sim", "pode", "manda bala", "isso aí")
- reject   — o usuário recusou claramente ("não", "cancela", "deixa pra lá")
- unclear  — qualquer outra coisa: dúvida ("acho que sim"), condição
             ("sim, mas muda pra 50"), ou assunto novo ("gastei 45 no mercado")

Na dúvida, responda unclear. Aprovar por engano apaga dado do usuário."""


async def _classificar(texto: str, resumo: str) -> str:
    from app.graph.schemas import ConfirmDecision
    from app.security import wrap_untrusted
    from app.services.gemini import structured

    modelo = structured(ConfirmDecision)
    resposta = await modelo.ainvoke(
        [
            ("system", _PROMPT_CONFIRMACAO.format(resumo=resumo or "uma ação")),
            # o texto do usuário é DADO, nunca instrução — mesmo envelope do resto
            ("human", wrap_untrusted("user_input", texto)),
        ]
    )
    return resposta.decision


async def interpret_text(
    texto: str | None, resumo: str = "", uso: dict | None = None
) -> bool | None:
    """True aprova, False recusa, None = não é confirmação (vira intenção nova).

    `uso` conta a chamada de modelo: este caminho roda fora do grafo, e desde que
    o SIM/NÃO deixou de ser regex ele gasta token de verdade — sem contar aqui,
    o consumo não chega em `ai_events` e o paywall mensal subconta.
    """
    if not texto or not texto.strip():
        return None
    try:
        decisao = await _classificar(texto, resumo)
    except Exception:  # noqa: BLE001
        log.warning("classificador de confirmação falhou — tratando como não-confirmação",
                    exc_info=True)
        return None
    if uso is not None:
        uso["llm_calls"] = uso.get("llm_calls", 0) + 1
    if decisao == "approve":
        return True
    if decisao == "reject":
        return False
    return None


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


async def decide(
    conteudo: dict, pendente: dict | None, uso: dict | None = None
) -> dict | str | None:
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

    # Sem pendência aberta não há o que confirmar — e classificar aqui gastaria
    # uma chamada de modelo em toda mensagem comum do usuário.
    if not pendente:
        return None

    decisao = await interpret_text(texto, (pendente or {}).get("summary", ""), uso)
    return None if decisao is None else {"approved": decisao}
