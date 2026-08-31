"""O estado do grafo tem que ser ZERADO a cada turno.

O checkpointer guarda o estado por `thread_id`, e o thread é o MESMO durante
toda a conversa (é o que permite o resume do HITL). Consequência: qualquer chave
que o worker não reinicie sobrevive para o turno seguinte.

Foi assim que, em 31/08/2026, "comprei um mac parcelado em 12x" recebeu de volta
o resumo da mensagem ANTERIOR: `finance_queries` ficou no checkpoint da consulta
anterior, o nó de execução iterou nela de novo e recomputou a mesma resposta.
O usuário viu o agente repetir a si mesmo, sem erro em lugar nenhum.

Este teste é mecânico de propósito: chave nova no AgentState quebra o build até
alguém decidir explicitamente o que fazer com ela no início do turno.
"""

import ast
import pathlib
import typing

from app.graph import state as state_mod
from app.graph.state import AgentState

# `from __future__ import annotations` no state.py deixa as anotações como
# string; get_type_hints resolve, e include_extras preserva o Annotated (que é
# onde o reducer mora).
HINTS = typing.get_type_hints(AgentState, include_extras=True, globalns=vars(state_mod))

RAIZ = pathlib.Path(__file__).resolve().parents[1]


def _chaves_do_estado_inicial() -> set[str]:
    """Lê as chaves de `estado_inicial` em worker._run_graph pelo AST.

    Por AST e não por import/execução: montar o dict de verdade exigiria sessão,
    banco e lote. O que importa aqui é o conjunto de chaves, que é estático.
    """
    arvore = ast.parse((RAIZ / "app" / "worker.py").read_text())
    for no in ast.walk(arvore):
        # o dicionário mora no `return` de `_estado_base` (extraído para o
        # fast-path de rascunho reusar). Procurar pela função, e não pelo nome
        # da variável, é o que faz este teste sobreviver a refactor.
        if isinstance(no, ast.FunctionDef) and no.name == "_estado_base":
            for interno in ast.walk(no):
                if isinstance(interno, ast.Return) and isinstance(interno.value, ast.Dict):
                    return {
                        k.value for k in interno.value.keys if isinstance(k, ast.Constant)
                    }
    raise AssertionError("não achei o dicionário de estado em `_estado_base`")


def test_todo_campo_do_estado_e_reiniciado_no_turno():
    faltando = set(HINTS) - _chaves_do_estado_inicial()
    assert not faltando, (
        f"campos do AgentState que NÃO são zerados por turno: {sorted(faltando)}. "
        "Eles sobrevivem no checkpointer e vazam para a próxima mensagem da mesma "
        "conversa."
    )


def test_llm_calls_zera_entre_turnos():
    """`llm_calls` é somado no fan-out, mas não pode somar ENTRE turnos.

    Ele decide se a execução grava linha em `ai_events`, e `ai_events` é o que a
    cota do plano conta. Acumulando, toda mensagem depois da primeira chamada de
    modelo parece ter gastado token — inclusive fast-path (saudação, SIM/NÃO),
    que por definição não gastou. Medido em produção de staging: 2, 4, 6, 8, 10.
    """
    reducer = HINTS["llm_calls"].__metadata__[0]

    # dentro do turno: soma (router + domínio, ou fan-out de dois domínios)
    assert reducer(1, 1) == 2

    # início do turno: o worker manda 0, e isso é RESET, não soma
    assert reducer(10, 0) == 0
