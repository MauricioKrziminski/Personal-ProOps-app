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
    phone: str
    timezone: str
    # texto cru do lote — rede de segurança quando a IA omite o valor
    texto: str
    # idempotência: (wa_message_id, action_index) impede que reprocessar duplique
    wa_message_id: str
    action_index: int = 0
    # alvo RESOLVIDO na Fase Cognitiva, congelado no checkpoint. As tools leem
    # daqui em vez de fazer o próprio SELECT — é o que garante que o registro
    # mutado seja o MESMO que o usuário leu na pergunta.
    target: dict | None = None
    # ids criados nesta mensagem (auditoria e desfazer)
    created: list[str] = field(default_factory=list)


@dataclass
class ToolResult:
    """Resultado de uma ação: a linha que vai para a confirmação do WhatsApp."""

    message: str
    result_id: UUID | None = None
    # True quando nada foi escrito (consulta, erro tratado, nada encontrado):
    # não gasta linha em executed_actions nem entra no desfazer.
    read_only: bool = False


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
