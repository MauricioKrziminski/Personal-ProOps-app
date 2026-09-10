"""Infraestrutura comum das tools.

Por que NÃO são @tool do LangChain ligadas ao modelo: tool-calling deixa o
modelo escolher QUAIS ferramentas chamar e em que ordem — exatamente o
"raciocínio livre" que este projeto quer eliminar do caminho da escrita. Aqui o
modelo produz UM objeto validado (FinanceAction/NotesAction) e um dispatcher
determinístico escolhe a função. O modelo não tem como inventar uma chamada.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID


@dataclass
class ExecContext:
    """Escopo de uma execução: quem escreveu, onde, e de qual mensagem veio."""

    user_id: UUID
    workspace_id: UUID
    # None no app: aquela conversa não tem número. Segue existindo no WhatsApp,
    # onde algumas tools ainda falam com a Meta.
    phone: str | None
    timezone: str
    # texto cru do lote — rede de segurança quando a IA omite o valor
    texto: str
    # idempotência: (source_message_id, action_index) impede que reprocessar
    # duplique. É o id da Meta no WhatsApp e `app:<uuid do cliente>` no app.
    source_message_id: str
    action_index: int = 0
    # alvo RESOLVIDO na Fase Cognitiva, congelado no checkpoint. As tools leem
    # daqui em vez de fazer o próprio SELECT — é o que garante que o registro
    # mutado seja o MESMO que o usuário leu na pergunta.
    target: dict | None = None
    # ids criados nesta mensagem (auditoria e desfazer)
    created: list[str] = field(default_factory=list)
    # cache da última consulta executada (para herança de contexto e trava de entidade)
    last_query_data: dict | None = None
    # id do botão ou linha clicada (para paginação determinística e filtros)
    clicked_id: str | None = None
    # as ações deste turno que VÃO RODAR, como `(action_index, ação)`. Existe para a
    # simulação de cenário poder empilhar as hipóteses numa resposta só, como o "E se…?" da
    # tela — responder duas vezes, cada uma ignorando a outra, dá dois saldos e nenhum deles
    # é o saldo.
    #
    # ⚠️ São as que rodam, não todas as do plano. Quem "responde pelo grupo" é eleita aqui
    # dentro; se a eleita pudesse estar fora da execução (bloqueada por campo faltando, ou
    # segurada pelo HITL), as outras sairiam caladas esperando por ela e a resposta sumiria
    # inteira — sem erro nenhum.
    siblings: list[tuple[int, object]] = field(default_factory=list)


@dataclass
class ToolResult:
    """Resultado de uma ação: a linha que vai para a confirmação do WhatsApp."""

    message: str
    result_id: UUID | None = None
    # True quando nada foi escrito (consulta, erro tratado, nada encontrado):
    # não gasta linha em executed_actions nem entra no desfazer.
    read_only: bool = False
    # Especificação interativa para WhatsApp (botões/listas de paginação/filtros)
    interactive_spec: dict | None = None
    # Dados brutos estruturados (para cache de estado de consultas)
    data: dict | None = None


# ---------------------------------------------------------------------------
# escopo: o que RLS fazia, agora é responsabilidade nossa
# ---------------------------------------------------------------------------
# ATENÇÃO. O serviço conecta no Postgres com um papel que IGNORA RLS (não há JWT
# de usuário, `auth.uid()` é null). Toda a proteção de "um workspace não enxerga
# o outro", que antes o banco garantia sozinho, passou a ser código nosso.
#
# Regra sem exceção: toda leitura e toda escrita filtra por `workspace_id`, e
# todo id que veio do modelo passa por `ensure_owned` antes de virar argumento
# de RPC. As RPCs públicas (goal_deposit, pay_invoice, ...) são `security
# invoker` e confiavam na RLS — chamadas daqui, elas NÃO checam nada.


async def ensure_owned(table: str, row_id, workspace_id) -> None:
    """Confirma que a linha pertence ao workspace da conversa."""
    from app import db
    from app.tools.guards import Level1Error

    # nome de tabela nunca vem do modelo: só destas constantes
    if table not in {
        "transactions",
        "notes",
        "reminders",
        "goals",
        "recurring_transactions",
        "accounts",
        "assets",
        "card_invoices",
        "installment_plans",
    }:
        raise ValueError(f"tabela fora da allowlist: {table}")

    row = await db.fetch_one(
        f"select 1 from public.{table} where id = %s and workspace_id = %s",  # noqa: S608
        row_id,
        workspace_id,
    )
    if row is None:
        raise Level1Error("🤷 Não achei esse item por aqui.", f"{table}:{row_id} fora do workspace")
