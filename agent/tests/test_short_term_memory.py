"""Testes da Etapa 3.4: Short-Term Memory e Retenção de Contexto Conversacional."""

from datetime import datetime
from uuid import UUID
import pytest

from app.graph.prompts import user_turn
from app.graph.state import AgentState, _preserve_or_replace
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.tools.base import ExecContext, ToolResult


def test_messages_substitui_em_vez_de_acumular():
    """A janela deixou de morar num reducer cego.

    Ela cortava em 6 mensagens fixas DENTRO do grafo — uma segunda regra de
    janela, escondida do canal que sabe qual janela vale (o app usa 10 pares, o
    WhatsApp 5). Hoje quem corta é `conversation.trim_prompt_history`, na borda,
    e o estado só carrega o vetor pronto.
    """
    import typing

    from app.graph import state as state_mod

    hints = typing.get_type_hints(
        AgentState, include_extras=True, globalns=vars(state_mod)
    )
    reducer = typing.get_args(hints["messages"])[1]
    assert reducer is state_mod._replace
    assert not hasattr(state_mod, "_history_reducer"), (
        "o reducer cego voltou — ele reintroduz uma janela invisível ao canal"
    )


def test_compose_devolve_o_historico_inteiro_com_a_resposta():
    """Com substituição, devolver só a resposta apagaria a conversa."""
    import asyncio

    from app.graph.nodes import compose

    anteriores = [
        {"role": "user", "content": "quanto gastei?"},
        {"role": "assistant", "content": "R$ 1.234,00"},
        {"role": "user", "content": "e no mercado?"},
    ]
    saida = asyncio.run(
        compose({"messages": list(anteriores), "results": ["R$ 300,00"]})
    )

    assert saida["messages"][:3] == anteriores
    assert saida["messages"][-1] == {"role": "assistant", "content": "R$ 300,00"}


def test_preserve_or_replace_mantem_cache_se_novo_vazio():
    cache_antigo = {"filtro_conta": "Nubank", "total": 5000}
    # Turno sem consulta nova (novo={})
    assert _preserve_or_replace(cache_antigo, {}) == cache_antigo

    # Turno com consulta nova
    cache_novo = {"filtro_conta": "Itaú", "total": 12000}
    assert _preserve_or_replace(cache_antigo, cache_novo) == cache_novo


def test_user_turn_injeta_bloco_de_historico():
    history = [
        {"role": "user", "content": "lançamentos do nubank"},
        {"role": "assistant", "content": "💳 Lançamentos - Nubank Cartão: 3 compras mostradas..."},
    ]
    texto = user_turn(
        texto="me mostre todos",
        agora_local="2026-09-01T22:00:00",
        timezone="America/Sao_Paulo",
        history=history,
    )
    assert "Histórico recente de mensagens anteriores da conversa:" in texto
    assert "Usuário: lançamentos do nubank" in texto
    assert "Assistente: 💳 Lançamentos - Nubank Cartão" in texto
    assert "<user_input>\nme mostre todos\n</user_input>" in texto
