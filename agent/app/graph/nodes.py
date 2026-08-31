"""Nós do grafo.

Um princípio atravessa todos: o modelo só produz objeto validado. Nenhum nó
deixa texto do modelo virar resposta ao usuário ou argumento de banco — o que
vai para o WhatsApp é template Python sobre números que já lemos.
"""

from __future__ import annotations

import logging

from langgraph.types import interrupt

from app.domain.dates import local_datetime_iso
from app.graph.policy import describe_for_confirmation, needs_confirmation
from app.graph.prompts import FINANCE, FINANCE_QUERY, NOTES, ROUTER, user_turn
from app.graph.schemas import (
    Domain,
    FinanceAction,
    FinancePlan,
    FinanceQuery,
    FinanceQueryPlan,
    NotesAction,
    NotesPlan,
    RouterDecision,
)
from app.graph.state import AgentState
from app.services import gemini
from app.tools.base import ExecContext
from app.tools.finance import apply_rules
from app.tools.registry import AJUDA, execute

log = logging.getLogger(__name__)

AJUDA_GERAL = (
    "👋 Eu organizo suas finanças e suas notas por aqui. Manda coisas como:\n"
    "  • \"gastei 45 no mercado\"\n"
    "  • \"recebi 500 de freela\"\n"
    "  • \"me lembra de pagar o aluguel todo dia 5\"\n"
    "  • \"anota: ligar pro dentista\"\n"
    "  • \"quanto gastei esse mês?\""
)


# ---------------------------------------------------------------------------
# roteamento
# ---------------------------------------------------------------------------


async def route(state: AgentState) -> dict:
    """Classifica a mensagem em um ou mais domínios.

    Fast-path determinístico ANTES do modelo: mensagem curta de saudação não
    merece uma chamada de LLM. Com a cota gratuita do Flash-Lite em 500/dia e
    duas chamadas por mensagem (router + domínio), cada fast-path é uma mensagem
    a mais que o usuário consegue mandar no dia.
    """
    texto = (state.get("text") or "").strip()
    if not texto and not state.get("media"):
        return {"domains": [Domain.GERAL.value], "confidence": 1.0, "llm_calls": 0}

    curto = texto.lower().strip(" !?.,")
    if curto in {"oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "obrigado", "obrigada", "vlw", "valeu"}:
        return {"domains": [Domain.GERAL.value], "confidence": 1.0, "llm_calls": 0}

    # Documento anexo é quase sempre cupom/fatura: vai direto para finanças.
    if state.get("media"):
        return {"domains": [Domain.FINANCAS.value], "confidence": 1.0, "llm_calls": 0}

    modelo = gemini.structured(RouterDecision, gemini.GEMINI_ROUTER)
    decisao: RouterDecision = await modelo.ainvoke(
        [
            ("system", ROUTER),
            ("human", user_turn(texto, local_datetime_iso(state["timezone"]), state["timezone"])),
        ]
    )
    dominios = [d.value for d in decisao.domains] or [Domain.GERAL.value]
    return {"domains": dominios, "confidence": decisao.confidence, "llm_calls": 1}


def pick_domains(state: AgentState) -> list[str]:
    """Aresta condicional com fan-out: o grafo roda os nós escolhidos em paralelo.

    Lista, não string: "gastei 45 e me lembra do aluguel" precisa dos dois nós, e
    escolher um só perderia metade da mensagem.
    """
    mapa = {
        Domain.FINANCAS.value: "financas",
        Domain.FINANCAS_CONSULTA.value: "financas_consulta",
        Domain.NOTAS.value: "notas",
        Domain.GERAL.value: "geral",
    }
    escolhidos = [mapa[d] for d in state.get("domains", []) if d in mapa]
    return escolhidos or ["geral"]


# ---------------------------------------------------------------------------
# domínios
# ---------------------------------------------------------------------------


async def finance_node(state: AgentState) -> dict:
    modelo = gemini.structured(FinancePlan, gemini.GEMINI_PARSE)
    plano: FinancePlan = await modelo.ainvoke(
        [
            ("system", FINANCE),
            (
                "human",
                user_turn(
                    state.get("text", ""),
                    local_datetime_iso(state["timezone"]),
                    state["timezone"],
                    tem_anexo=bool(state.get("media")),
                ),
            ),
        ]
    )
    acoes = [a for a in plano.actions if a.type.value != "unknown"]
    return {
        "finance_actions": [a.model_dump() for a in acoes],
        "confidence": min(state.get("confidence", 1.0), plano.confidence),
        "llm_calls": 1,
    }


async def finance_query_node(state: AgentState) -> dict:
    """Consultas. Schema próprio (7 × 9) porque o de escrita não cabia junto —
    ver o orçamento medido em schemas.py."""
    modelo = gemini.structured(FinanceQueryPlan, gemini.GEMINI_PARSE)
    plano: FinanceQueryPlan = await modelo.ainvoke(
        [
            ("system", FINANCE_QUERY),
            (
                "human",
                user_turn(
                    state.get("text", ""),
                    local_datetime_iso(state["timezone"]),
                    state["timezone"],
                ),
            ),
        ]
    )
    acoes = [a for a in plano.actions if a.type.value != "unknown"]
    return {
        "finance_queries": [a.model_dump() for a in acoes],
        "confidence": min(state.get("confidence", 1.0), plano.confidence),
        "llm_calls": 1,
    }


async def notes_node(state: AgentState) -> dict:
    modelo = gemini.structured(NotesPlan, gemini.GEMINI_PARSE)
    plano: NotesPlan = await modelo.ainvoke(
        [
            ("system", NOTES),
            (
                "human",
                user_turn(
                    state.get("text", ""),
                    local_datetime_iso(state["timezone"]),
                    state["timezone"],
                ),
            ),
        ]
    )
    acoes = [a for a in plano.actions if a.type.value != "unknown"]
    return {
        "notes_actions": [a.model_dump() for a in acoes],
        "confidence": min(state.get("confidence", 1.0), plano.confidence),
        "llm_calls": 1,
    }


async def general_node(state: AgentState) -> dict:
    """Conversa geral SEM chamar o modelo.

    Deixar o LLM escrever livremente aqui seria a única porta de texto não
    verificado no produto — e a mais barata de fechar: respostas de saudação e
    ajuda são finitas e conhecidas. De quebra, economiza uma chamada.
    """
    # Só fala quando é o único domínio: "gastei 45 e oi" não pode responder o
    # bloco de ajuda inteiro colado na confirmação do gasto.
    if len(state.get("domains", [])) > 1:
        return {}
    return {"results": [AJUDA_GERAL]}


# ---------------------------------------------------------------------------
# portão: validação + HITL
# ---------------------------------------------------------------------------


def _actions(state: AgentState) -> list[FinanceAction | FinanceQuery | NotesAction]:
    """Revalida o que veio do checkpoint. Schema que mudou entre deploys falha
    aqui, e não como escrita torta no banco."""
    saida: list[FinanceAction | FinanceQuery | NotesAction] = []
    for bruto in state.get("finance_actions", []):
        saida.append(FinanceAction.model_validate(bruto))
    for bruto in state.get("finance_queries", []):
        saida.append(FinanceQuery.model_validate(bruto))
    for bruto in state.get("notes_actions", []):
        saida.append(NotesAction.model_validate(bruto))
    return saida


async def gate(state: AgentState) -> dict:
    """Decide se executa direto ou pausa esperando confirmação.

    O interrupt() do LangGraph guarda o checkpoint e devolve o controle. Quem
    manda a pergunta ao WhatsApp e grava pending_actions é o worker — o grafo não
    fala com o mundo, ele só para.

    Este nó reinicia do zero quando o grafo é retomado (comportamento do
    interrupt), por isso ele é puro: mesma entrada, mesma decisão.
    """
    if state.get("halted"):
        return {}

    acoes = _actions(state)
    if not acoes:
        return {}

    confidence = state.get("confidence", 1.0)
    motivos = [(a, needs_confirmation(a, confidence)) for a in acoes]
    pendentes = [(a, m) for a, m in motivos if m]
    if not pendentes:
        return {"approved": True}

    acao, motivo = pendentes[0]
    resposta = interrupt(
        {
            "kind": "confirmation",
            "reason": motivo,
            "summary": describe_for_confirmation(acao),
            "action_type": acao.type.value,
        }
    )

    if resposta is True or (isinstance(resposta, str) and resposta.lower() in {"sim", "s", "true"}):
        return {"approved": True}
    return {"approved": False, "results": ["👍 Ok, não fiz nada."], "halted": True}


def after_gate(state: AgentState) -> str:
    return "executar" if state.get("approved") else "compor"


# ---------------------------------------------------------------------------
# execução e composição
# ---------------------------------------------------------------------------


async def execute_node(state: AgentState) -> dict:
    ctx = ExecContext(
        user_id=state["user_id"],
        workspace_id=state["workspace_id"],
        phone=state["phone"],
        timezone=state["timezone"],
        texto=state.get("text", ""),
        wa_message_id=state["wa_message_id"],
    )

    linhas: list[str] = list(state.get("results", []))
    for indice, acao in enumerate(_actions(state)):
        ctx.action_index = indice
        # regra do usuário GANHA da IA — mas só em ESCRITA. Em consulta,
        # `category` é filtro: deixar a regra reescrevê-lo devolveria o total de
        # outra categoria, em silêncio. Em nota, `folder` é pasta e
        # `search_term` é busca, mesmo problema.
        if isinstance(acao, FinanceAction):
            acao = await apply_rules(ctx.workspace_id, acao)
        resultado = await execute(ctx, acao)
        if resultado.message:
            linhas.append(resultado.message)

    return {"results": linhas}


async def compose(state: AgentState) -> dict:
    """Uma mensagem consolidada. Template puro, zero LLM."""
    linhas = [l for l in state.get("results", []) if l]
    if not linhas:
        linhas = [AJUDA]
    return {"reply": "\n".join(linhas)}
