"""Estado do grafo.

Só tipos serializáveis: o checkpointer grava isto no Postgres a cada passo, e é
daqui que uma execução interrompida (interrupt do HITL, container reciclado)
recomeça exatamente de onde parou.

As ações trafegam como dict, não como modelo Pydantic: o que volta do checkpoint
é revalidado no nó que executa, então um schema que mude entre um deploy e outro
falha na validação em vez de virar escrita torta no banco.
"""

from __future__ import annotations

from typing import Annotated, Any, TypedDict


def _soma_no_turno(antigo: int, novo: int) -> int:
    """Soma dentro do turno; `0` na entrada é RESET, não soma.

    `operator.add` puro estava errado por um motivo que só aparece na segunda
    mensagem: o checkpointer guarda o estado por `thread_id`, e o thread é o
    mesmo durante toda a conversa. O worker manda `llm_calls: 0` a cada turno
    achando que zera, mas o reducer fazia `anterior + 0 = anterior` — medido em
    staging, a contagem foi 2, 4, 6, 8, 10 em cinco mensagens.

    Isso não é cosmético: `llm_calls > 0` é o que decide gravar em `ai_events`, e
    `ai_events` é o que a cota do plano CONTA. Acumulando, todo fast-path depois
    da primeira chamada de modelo (saudação, SIM/NÃO) cobrava mensagem sem ter
    gasto token.

    Nenhum nó soma 0 — quem não chamou modelo devolve `llm_calls: 0` justamente
    para dizer "não gastei", e o único 0 que importa é o da entrada do turno.
    """
    return novo if not novo else (antigo or 0) + novo


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
    llm_calls: Annotated[int, _soma_no_turno]

    # planos por domínio (chaves distintas: fan-out sem conflito)
    finance_actions: Annotated[list[dict], _replace]
    finance_queries: Annotated[list[dict], _replace]
    notes_actions: Annotated[list[dict], _replace]

    # alvos resolvidos na Fase Cognitiva, ALINHADOS POR POSIÇÃO com _actions().
    # Entrada: {} para ação que não mira registro existente, ou
    # {"table": "transactions", "status": "found|ambiguous|none",
    #  "candidates": [{"id": "...", "label": "..."}]}.
    # Só strings: o checkpointer serializa isto, e UUID/date crus não sobrevivem.
    targets: Annotated[list[dict], _replace]

    # extração incompleta a guardar como rascunho (o worker é quem grava)
    draft: Annotated[dict, _replace]

    # execução
    approved: bool
    # id escolhido pelo usuário num empate — congelado, vem do pendente
    chosen_id: str
    results: Annotated[list[str], _replace]
    reply: str
    halted: bool                # True = sai sem executar (usuário desconhecido, etc.)
