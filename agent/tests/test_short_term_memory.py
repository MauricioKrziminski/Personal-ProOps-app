"""Testes da Etapa 3.4: Short-Term Memory e Retenção de Contexto Conversacional."""

from datetime import datetime
from uuid import UUID
import pytest

from app.graph.prompts import user_turn
from app.graph.state import _history_reducer, _preserve_or_replace
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.tools.base import ExecContext, ToolResult


def test_history_reducer_limita_em_6_mensagens():
    """Garante que o buffer de histórico mantém no máximo as últimas 6 mensagens (3 turnos)."""
    mensagens_anteriores = [
        {"role": "user", "content": f"msg {i}"}
        for i in range(1, 6)
    ]
    novas = [
        {"role": "assistant", "content": "resp 5"},
        {"role": "user", "content": "msg 6"},
        {"role": "assistant", "content": "resp 6"},
    ]
    resultado = _history_reducer(mensagens_anteriores, novas)
    assert len(resultado) == 6
    assert resultado[-1]["content"] == "resp 6"
    assert resultado[0]["content"] == "msg 3"


def test_history_reducer_nao_duplica_mensagem_identica():
    antigo = [{"role": "user", "content": "olá"}]
    resultado = _history_reducer(antigo, [{"role": "user", "content": "olá"}])
    assert len(resultado) == 1


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
