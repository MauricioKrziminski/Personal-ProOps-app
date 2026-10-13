"""Exportar os dados da pessoa (LGPD: acesso e portabilidade).

Escopo (decidido em 09/10/2026): o perfil dela, e-mail/telefone/criação do auth e TODO dado dos espaços de
que ela é MEMBRO — o que o app já mostra a ela. É genérico de propósito: toda tabela de `public` com
coluna `workspace_id` entra sem lista a manter, então tabela nova de dado do usuário é exportada sozinha.

NÃO entra (internos do agente e da operação, sem dado que a pessoa tenha informado):
  fila e execução do agente (messages_queue e messages_raw entram SÓ como `mensagens_whatsapp`, abaixo): executed_actions, pending_actions, draft_actions, user_sessions,
  messages_raw, agent_routing, transaction_embeddings, agent_feedback, ai_events;
  operação: whatsapp_sends, alerts_sent, billing_events (payload da loja), jobs;
  terceiros/internos do painel: workspace_invites (telefone de quem foi convidado), admin_account_notes,
  admin_audit_events, error_events, error_issues, app_config.
Recibos de idempotência e checkpoints do LangGraph moram em schemas fora de `public` e nunca são lidos aqui.
O que ela MANDOU pelo WhatsApp (`mensagens_whatsapp`) vai: só tipo, data e o texto das mensagens recebidas dela
(corpo de texto e título do botão/lista escolhido), do que ainda existir na fila (30 dias) e em `messages_raw`.
Nunca o payload cru, telefone, ids da Meta, tokens ou cabeçalhos; áudio e imagem saem só com tipo e data.
As tabelas filhas sem `workspace_id` (parcelas editadas e estimadas de dívida, mensagens do chat do app)
são lidas pelo pai, em `DERIVADAS`.

O PAINEL NÃO chama isto: o contrato LGPD do painel é não ver dado financeiro (docs/ADMIN-API.md).
ponytail: monta tudo em memória; uma conta com milhões de linhas pede streaming por tabela.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from app import db

FORMATO = 1

EXCLUIDAS = frozenset({
    "messages_queue", "executed_actions", "pending_actions", "draft_actions", "user_sessions", "messages_raw",
    "agent_routing", "transaction_embeddings", "agent_feedback", "ai_events",
    "whatsapp_sends", "alerts_sent", "billing_events", "jobs",
    "workspace_invites", "admin_account_notes", "admin_audit_events", "error_events", "error_issues", "app_config",
})

# filhas sem `workspace_id`: tabela -> filtro (o `%s` é a lista de espaços ou o usuário)
DERIVADAS = {
    "debt_installment_edits": ("workspaces", "debt_id in (select id from public.debts where workspace_id = any(%s))"),
    "debt_declared_due_dates": ("workspaces", "debt_id in (select id from public.debts where workspace_id = any(%s))"),
    "debt_declared_estimates": ("workspaces", "debt_id in (select id from public.debts where workspace_id = any(%s))"),
    "app_chat_messages": ("usuario", "session_id in (select id from public.user_sessions where user_id = %s)"),
}

_NOME = re.compile(r"^[a-z][a-z0-9_]*$")  # defesa em profundidade: o nome vem do catálogo, nunca do usuário


async def _tabelas_por_espaco() -> list[str]:
    linhas = await db.fetch(
        """
        select t.table_name
        from information_schema.tables t
        join information_schema.columns c
          on c.table_schema = t.table_schema and c.table_name = t.table_name and c.column_name = 'workspace_id'
        where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and pg_catalog.has_table_privilege('public.' || pg_catalog.quote_ident(t.table_name), 'select')
        order by t.table_name
        """
    )
    return [r["table_name"] for r in linhas if r["table_name"] not in EXCLUIDAS and _NOME.match(r["table_name"])]


# Campos escolhidos um a um (nunca `payload` inteiro): o corpo do texto e o título do botão/lista.
_TEXTO = ("coalesce(payload #>> '{text,body}', payload #>> '{interactive,button_reply,title}', "
          "payload #>> '{interactive,list_reply,title}', payload #>> '{button,text}')")
_MENSAGENS = f"""
select to_jsonb(m) as r from (
  select created_at, message_type as tipo, {_TEXTO} as texto from public.messages_queue where user_id = %s
  union all
  select created_at, message_type as tipo, {_TEXTO} as texto from public.messages_raw
   where user_id = %s and direction = 'inbound'
  order by created_at
) m
"""


async def _linhas(sql: str, *args) -> list[dict]:
    return [r["r"] for r in await db.fetch(sql, *args)]


_PERFIL = ("id, phone, whatsapp_verified, timezone, locale, created_at, updated_at, alerts_enabled, display_name, "
           "alerts_push_enabled, alerts_whatsapp_enabled, terms_version, terms_accepted_at, ai_consent_at, "
           "last_app_version, last_app_platform, last_seen_at, marketing_opt_out_at")  # sem expo_push_token: é credencial do aparelho


async def exportar(user_id: UUID) -> dict:
    """Os dados dos espaços são lidos SOB RLS como a própria pessoa (`db.sob_rls`): sai exatamente o que o app
    mostra a ela, e num espaço compartilhado nada que a policy esconde (lembrete de conta por pessoa, `import_*`,
    notas e lembretes de outro membro). Perfil, e-mail, chat do app e mensagens do WhatsApp são DELA por
    `user_id` (tabelas sem policy para o app) e vêm de fora do bloco RLS."""
    async with db.unidade_de_trabalho():
        perfil = await db.fetch_one(
            f"""select to_jsonb(q) as p, u.email::text as email, u.created_at as auth_created_at
               from (select {_PERFIL} from public.profiles where id = %s) q
               join public.profiles p on p.id = q.id
               join auth.users u on u.id = p.id""",
            user_id,
        ) or {}
        ws_ids = [r["workspace_id"] for r in await db.fetch(
            "select workspace_id from public.workspace_members where user_id = %s order by workspace_id", user_id)]
        mensagens = await _linhas(_MENSAGENS, user_id, user_id)
        chat = await _linhas(
            f'select to_jsonb(t) as r from public."app_chat_messages" t where t.{DERIVADAS["app_chat_messages"][1]}',
            user_id)

        tabelas: dict[str, list] = {}
        async with db.sob_rls(user_id):
            tabelas["workspaces"] = await _linhas(
                "select to_jsonb(t) as r from public.workspaces t where t.id = any(%s) order by t.created_at, t.id", ws_ids)
            for nome in await _tabelas_por_espaco():
                tabelas[nome] = await _linhas(
                    f'select to_jsonb(t) as r from public."{nome}" t where t.workspace_id = any(%s)', ws_ids)
            for nome, (escopo, filtro) in DERIVADAS.items():
                if escopo == "workspaces":
                    tabelas[nome] = await _linhas(f'select to_jsonb(t) as r from public."{nome}" t where t.{filtro}', ws_ids)
        tabelas["app_chat_messages"] = chat
        tabelas["mensagens_whatsapp"] = mensagens

    return {
        "gerado_em": datetime.now(timezone.utc).isoformat(),
        "versao_do_formato": FORMATO,
        "perfil": {
            **(perfil.get("p") or {}),
            "email": perfil.get("email"),
            "auth_created_at": perfil["auth_created_at"].isoformat() if perfil.get("auth_created_at") else None,
        },
        "tabelas": tabelas,
    }
