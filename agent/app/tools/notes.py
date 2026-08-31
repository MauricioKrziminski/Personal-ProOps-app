"""Notas e lembretes — determinísticos, tipados.

Duas regras do produto que vivem aqui e não no prompt:
  - nota NUNCA some na hora: lixeira de 30 dias (`deleted_at`). Apagar de vez é
    o jeito mais rápido de perder a confiança do usuário.
  - acrescentar texto é APPEND numa nota existente, nunca uma nota nova — o
    modelo tende a criar duplicata quando o usuário diz "põe leite na lista".
"""

from __future__ import annotations

import logging
from uuid import UUID

from app import db
from app.domain.categories import normalize as normalize_folder
from app.domain.dates import format_date_br, now_utc, to_instant
from app.domain.recurrence import next_occurrence
from app.graph.schemas import NotesAction
from app.tools import guards
from app.tools.base import ExecContext, ToolResult
from app.tools.guards import Level1Error

log = logging.getLogger(__name__)


def first_line(content: str | None, limite: int = 60) -> str:
    """Título de uma nota = primeira linha não vazia (a mesma regra da tela)."""
    linha = next((l.strip() for l in (content or "").split("\n") if l.strip()), "")
    if not linha:
        return "(nota vazia)"
    return linha if len(linha) <= limite else linha[: limite - 1] + "…"


async def ensure_folder(
    workspace_id: UUID, user_id: UUID, nome: str | None
) -> dict | None:
    """Cria/acha a pasta. Falhar aqui devolve None e a nota nasce sem pasta —
    nota perdida seria pior.

    `user_id` explícito e obrigatório: note_folders NÃO tem `default auth.uid()`
    (sob um papel sem JWT isso viraria null e estouraria o not null).
    """
    name = normalize_folder(nome)
    if not name:
        return None
    try:
        return await db.fetch_one(
            """
            insert into public.note_folders (workspace_id, user_id, name)
            values (%s, %s, %s)
            on conflict (workspace_id, name) do update set name = excluded.name
            returning id, name
            """,
            workspace_id, user_id, name,
        )
    except Exception as err:  # noqa: BLE001
        log.warning("ensure_folder falhou (nota fica sem pasta): %s", err)
        return None


async def create_note(ctx: ExecContext, action: NotesAction) -> ToolResult:
    conteudo = guards.require_text(action.content, o_que="o que anotar", maximo=20_000)
    pasta = await ensure_folder(ctx.workspace_id, ctx.user_id, action.folder)

    row = await db.fetch_one(
        """
        insert into public.notes
          (user_id, workspace_id, content, category, folder_id, source)
        values (%s, %s, %s, %s, %s, 'whatsapp')
        returning id
        """,
        ctx.user_id, ctx.workspace_id, conteudo,
        # grava os DOIS durante a transição da 0038: binário antigo ainda lê `category`
        normalize_folder(action.folder), pasta["id"] if pasta else None,
    )
    onde = f" em *{pasta['name']}*" if pasta else ""
    return ToolResult(
        f"📝 Nota salva{onde}: {first_line(conteudo)}", result_id=row["id"] if row else None
    )


async def append_note(ctx: ExecContext, action: NotesAction) -> ToolResult:
    trecho = guards.require_text(action.append_text, o_que="o que acrescentar")

    # alvo congelado pela Fase Cognitiva
    nota_id = ctx.target["candidates"][0]["id"]
    rotulo = ctx.target["candidates"][0]["label"]

    # Concatenação no SQL, não read-modify-write: entre o SELECT e o UPDATE a
    # nota pode ter sido editada no app, e a versão lida sobrescreveria a nova.
    linhas = await db.fetch(
        "update public.notes set content = rtrim(content) || E'\n' || %s, "
        "updated_at = now() where id = %s and workspace_id = %s returning id",
        trecho, nota_id, ctx.workspace_id,
    )
    if not linhas:
        return ToolResult("🤷 Essa nota não está mais aqui.", read_only=True)
    return ToolResult(f"📝 Acrescentei *{trecho}* em: {rotulo}", result_id=nota_id)


async def query_notes(ctx: ExecContext, action: NotesAction) -> ToolResult:
    termo = (action.search_term or action.content or "").strip()
    pasta = normalize_folder(action.folder)

    sql = [
        """
        select n.id, n.content, n.updated_at, f.name as folder
        from public.notes n
        left join public.note_folders f on f.id = n.folder_id
        where n.workspace_id = %s and n.deleted_at is null
        """
    ]
    args: list = [ctx.workspace_id]
    if termo:
        # plainto_tsquery escapa a entrada: termo do usuário nunca vira sintaxe de
        # tsquery. pt_unaccent (0038) faz "reuniao" achar "reunião".
        sql.append("and n.search_tsv @@ plainto_tsquery('public.pt_unaccent', %s)")
        args.append(termo)
    if pasta:
        sql.append("and f.name = %s")
        args.append(pasta)
    if action.query_from:
        sql.append("and n.created_at >= %s")
        args.append(to_instant(action.query_from, ctx.timezone))
    if action.query_to:
        sql.append("and n.created_at <= %s")
        args.append(to_instant(f"{action.query_to}T23:59:59", ctx.timezone))
    sql.append("order by n.updated_at desc limit 5")

    notas = await db.fetch(" ".join(sql), *args)
    if not notas:
        alvo = termo or pasta
        return ToolResult(
            f"🤷 Não achei nota sobre *{alvo}*."
            if alvo
            else "📝 Você ainda não anotou nada. Manda \"anotar: ligar pro dentista\"!",
            read_only=True,
        )

    if len(notas) == 1:
        nome = notas[0]["folder"]
        corpo = (notas[0]["content"] or "").strip()
        prefixo = f"*{nome}* — " if nome else ""
        corpo = corpo if len(corpo) <= 600 else corpo[:600] + "…"
        return ToolResult(f"📝 {prefixo}{corpo}", read_only=True)

    linhas = [
        f"  • {first_line(n['content'])}" + (f" _({n['folder']})_" if n["folder"] else "")
        for n in notas
    ]
    cabecalho = "As 5 notas mais recentes" if len(notas) == 5 else f"Achei {len(notas)} notas"
    return ToolResult(f"📝 {cabecalho}:\n" + "\n".join(linhas), read_only=True)


async def delete_note(ctx: ExecContext, action: NotesAction) -> ToolResult:
    # Alvo congelado pela Fase Cognitiva. Antes daqui saía um
    # `content ilike '%termo%'` com o que o modelo tivesse escrito — e foi assim
    # que "apagar essa última mensagem" virou uma busca literal por
    # "última mensagem", que não casa com nada.
    achadas = [{"id": ctx.target["candidates"][0]["id"]}]

    # lixeira de 30 dias, nunca delete físico
    await db.execute(
        "update public.notes set deleted_at = now() where id = %s and workspace_id = %s",
        achadas[0]["id"], ctx.workspace_id,
    )
    return ToolResult("🗑️ Nota na lixeira — 30 dias para restaurar.", result_id=achadas[0]["id"])


async def create_reminder(ctx: ExecContext, action: NotesAction) -> ToolResult:
    titulo = guards.require_text(action.content, o_que="o que lembrar", maximo=200)
    rrule = guards.clean_rrule(action.recurrence)

    quando = to_instant(action.remind_at, ctx.timezone) if action.remind_at else None
    if quando is None or quando <= now_utc():
        # sem hora explícita (ou já passou), a recorrência define a próxima
        quando = next_occurrence(rrule, now_utc(), ctx.timezone) if rrule else None
    if quando is None:
        raise Level1Error(
            "❌ Não entendi quando lembrar. Tenta \"amanhã às 9\" ou \"todo dia 5\"."
        )

    row = await db.fetch_one(
        """
        insert into public.reminders
          (user_id, workspace_id, title, recurrence, next_run_at, timezone, source)
        values (%s, %s, %s, %s, %s, %s, 'whatsapp')
        returning id
        """,
        ctx.user_id, ctx.workspace_id, titulo, rrule, quando, ctx.timezone,
    )
    repete = " (e se repete)" if rrule else ""
    return ToolResult(
        f"⏰ Lembrete criado: *{titulo}* em {format_date_br(quando.date())}{repete}.",
        result_id=row["id"] if row else None,
    )


async def delete_reminder(ctx: ExecContext, action: NotesAction) -> ToolResult:
    termo = guards.require_text(action.search_term or action.content, o_que="qual lembrete")
    # alvo congelado pela Fase Cognitiva (ver delete_note)
    achados = [{"id": ctx.target["candidates"][0]["id"],
                "title": ctx.target["candidates"][0]["label"]}]
    await db.execute(
        "delete from public.reminders where id = %s and workspace_id = %s",
        achados[0]["id"], ctx.workspace_id,
    )
    return ToolResult(f"🗑️ Lembrete apagado: {achados[0]['title']}", result_id=achados[0]["id"])
