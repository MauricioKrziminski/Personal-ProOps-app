"""Estado do grafo.

Só tipos serializáveis: o checkpointer grava isto no Postgres a cada passo, e é
daqui que uma execução interrompida (interrupt do HITL, container reciclado)
recomeça exatamente de onde parou.

As ações trafegam como dict, não como modelo Pydantic: o que volta do checkpoint
é revalidado no nó que executa, então um schema que mude entre um deploy e outro
falha na validação em vez de virar escrita torta no banco.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


def _replace(_antigo: Any, novo: Any) -> Any:
    """Reducer explícito: o último nó a escrever manda.

    Sem reducer declarado, o fan-out do router (finanças e notas rodando em
    paralelo) levantaria InvalidUpdateError se os dois tocassem a mesma chave.
    """
    return novo


class AgentState(TypedDict, total=False):
    # identidade
    thread_id: str
    phone: str
    user_id: str
    workspace_id: str
    timezone: str

    # entrada (lote consolidado pelo debounce)
    wa_message_id: str          # o id da ÚLTIMA mensagem do lote: chave de idempotência
    text: str                   # texto já sanitizado, pronto para o envelope
    media: dict[str, str] | None  # {mime_type, data_b64}
    raw_texts: list[str]

    # roteamento
    domains: Annotated[list[str], _replace]
    confidence: float
    # chamadas de modelo desta execução. Aditivo porque o fan-out (finanças e
    # notas em paralelo) soma as duas. É o que alimenta `ai_events`, e `ai_events`
    # é o que a cota do plano conta — fast-path que não chamou modelo não pode
    # consumir mensagem do usuário.
    llm_calls: Annotated[int, operator.add]

    # planos por domínio (chaves distintas: fan-out sem conflito)
    finance_actions: Annotated[list[dict], _replace]
    finance_queries: Annotated[list[dict], _replace]
    notes_actions: Annotated[list[dict], _replace]

    # execução
    approved: bool
    results: Annotated[list[str], _replace]
    reply: str
    halted: bool                # True = sai sem executar (usuário desconhecido, etc.)
