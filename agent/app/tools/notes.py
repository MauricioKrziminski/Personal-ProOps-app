"""Notas e lembretes — determinísticos, tipados.

Duas regras do produto que vivem aqui e não no prompt:
  - nota NUNCA some na hora: lixeira de 30 dias (`deleted_at`). Apagar de vez é
    o jeito mais rápido de perder a confiança do usuário.
  - acrescentar texto é APPEND numa nota existente, nunca uma nota nova — o
    modelo tende a criar duplicata quando o usuário diz "põe leite na lista".
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from app import db
from app.domain.categories import normalize as normalize_folder
from app.domain.dates import (
    format_date_br,
    local_iso_date,
    local_now,
    now_utc,
    to_instant,
    tz,
)
from app.domain.recurrence import descreve_rrule, em_pausa, next_occurrence
from app.graph.schemas import NotesAction
from app.tools import guards
from app.tools.base import ExecContext, ToolResult
from app.tools.guards import Level1Error
from app.domain import lembrete, matching

log = logging.getLogger(__name__)


def first_line(content: str | None, limite: int = 60) -> str:
    """Título de uma nota = primeira linha não vazia (a mesma regra da tela)."""
    linha = next((l.strip() for l in (content or "").split("\n") if l.strip()), "")
    if not linha:
        return "(nota vazia)"
    return linha if len(linha) <= limite else linha[: limite - 1] + "…"


SEP = " / "
PROFUNDIDADE_MAX = 5  # espelha o gatilho de note_folders (raiz = 1); o banco continua sendo a palavra final


def _colapsa(texto: str) -> str:
    return re.sub(r"\s*/\s*", "/", texto.strip().lower())


def caminhos(pastas: list[dict]) -> dict:
    """id -> "mãe / filha" para a árvore inteira (raiz = só o nome). Ciclo legado não trava."""
    por_id = {p["id"]: p for p in pastas}

    def sobe(p):
        nomes, visto = [], set()
        while p and p["id"] not in visto:
            visto.add(p["id"])
            nomes.append(p["name"])
            p = por_id.get(p.get("parent_id"))
        return SEP.join(reversed(nomes))

    return {p["id"]: sobe(p) for p in pastas}


def resolver(pastas: list[dict], texto: str | None) -> dict:
    """Pura: o que o texto do modelo quer dizer na árvore. `estado`:
    vazia | achada (id, name, caminho) | ambigua (opcoes) | falta (parent_id, faltam, caminho).
    Texto inteiro como nome exato vem primeiro (nome antigo com "/"), depois o caminho nível a nível;
    nome solto sem "/" vale em qualquer nível se for UM só, e é ambíguo se forem vários."""
    bruto = (texto or "").strip()
    if not bruto:
        return {"estado": "vazia"}
    nomes = caminhos(pastas)
    exatas = [p for p in pastas if _colapsa(p["name"]) == _colapsa(bruto)]
    if "/" not in bruto or exatas:
        nome = normalize_folder(bruto) if not exatas else None
        achadas = exatas or [p for p in pastas if p["name"] == nome]
        if len(achadas) == 1:
            p = achadas[0]
            return {"estado": "achada", "id": p["id"], "name": p["name"], "caminho": nomes[p["id"]]}
        if achadas:
            return {"estado": "ambigua", "nome": achadas[0]["name"],
                    "opcoes": sorted(nomes[p["id"]] for p in achadas)}
        return {"estado": "falta", "parent_id": None, "faltam": [nome], "caminho": nome, "nivel": 0}
    segs = [x for x in (normalize_folder(x) for x in bruto.split("/")) if x]
    if not segs:
        return {"estado": "vazia"}
    pai, andou = None, 0
    for seg in segs:
        filha = next((p for p in pastas if p.get("parent_id") == pai and p["name"] == seg), None)
        if not filha:
            break
        pai, andou = filha["id"], andou + 1
    if andou == len(segs):
        p = next(p for p in pastas if p["id"] == pai)
        return {"estado": "achada", "id": pai, "name": p["name"], "caminho": nomes[pai]}
    return {"estado": "falta", "parent_id": pai, "faltam": segs[andou:], "nivel": andou,
            "caminho": SEP.join(segs)}


async def carregar_pastas(workspace_id) -> list[dict]:
    return await db.fetch(
        "select id, parent_id, name from public.note_folders where workspace_id = %s", workspace_id
    )


async def resolver_pasta(workspace_id, texto: str | None) -> dict:
    return resolver(await carregar_pastas(workspace_id), texto)


def descendentes(pastas: list[dict], raiz) -> list:
    """O id da pasta e o de todas as que estão dentro dela."""
    ids = [raiz]
    for i in ids:  # a lista cresce enquanto se anda nela
        ids += [p["id"] for p in pastas if p.get("parent_id") == i and p["id"] not in ids]
    return ids


def pergunta_da_ambiguidade(r: dict, acao: str = "vai a nota", saida: str = " ou diz *sem pasta*") -> str:
    opcoes = ", ".join(f"*{o}*" for o in r["opcoes"])
    return (f"Tenho mais de uma pasta chamada *{r['nome']}*: {opcoes}. Em qual delas {acao}? "
            f"Responde com o caminho (ex.: *{r['opcoes'][0]}*){saida}.")


def _sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if not unicodedata.combining(c))


async def pergunta_da_pasta(workspace_id, action, texto: str | None = None) -> str | None:
    """Antes do SIM: nome de pasta que existe em mais de um lugar vira pergunta, nunca escolha.

    Ancoragem: se o modelo devolveu um caminho ("pessoal / 2026") cuja folha é ambígua, cada mãe tem
    que aparecer na FRASE da pessoa; mãe que só o modelo disse é dedução, e a folha vira nome solto."""
    if action.sem_pasta or not action.folder:
        return None
    pastas = await carregar_pastas(workspace_id)
    r = resolver(pastas, action.folder)
    segs = [x for x in (normalize_folder(x) for x in action.folder.split("/")) if x]
    if r["estado"] == "achada" and len(segs) > 1 and texto is not None:
        folha = resolver(pastas, segs[-1])
        frase = _sem_acento(texto)
        if folha["estado"] == "ambigua" and not all(_sem_acento(m) in frase for m in segs[:-1]):
            r = folha
    return pergunta_da_ambiguidade(r) if r["estado"] == "ambigua" else None


async def ensure_folder(
    workspace_id: UUID, user_id: UUID, nome: str | None, avisos: list | None = None
) -> dict | None:
    """Acha a pasta pelo caminho e cria o que faltar (mãe e filha). Falhar aqui devolve None e a
    nota nasce sem pasta — nota perdida seria pior —, mas o motivo vai em `avisos` para a pessoa.

    `user_id` explícito e obrigatório: note_folders NÃO tem `default auth.uid()`
    (sob um papel sem JWT isso viraria null e estouraria o not null). Insert SEM alvo no
    `on conflict`: vale no unique antigo (workspace, name) e no novo (workspace, mãe, name).
    """
    def falhou(frase):
        if avisos is not None:
            avisos.append(frase)
        return None

    try:
        r = await resolver_pasta(workspace_id, nome)
        if r["estado"] == "vazia":
            return None
        if r["estado"] == "achada":
            return {"id": r["id"], "name": r["name"], "caminho": r["caminho"]}
        if r["estado"] == "ambigua":
            return falhou(f"⚠️ Há mais de uma pasta chamada *{r['nome']}* "
                          f"({', '.join(r['opcoes'])}); a nota ficou sem pasta.")
        if r["nivel"] + len(r["faltam"]) > PROFUNDIDADE_MAX:
            return falhou(f"⚠️ Pastas vão até {PROFUNDIDADE_MAX} níveis; a nota ficou sem pasta.")
        pai, pasta = r["parent_id"], None
        for seg in r["faltam"]:
            pasta = await db.fetch_one(
                """
                insert into public.note_folders (workspace_id, user_id, parent_id, name)
                values (%s, %s, %s, %s)
                on conflict do nothing
                returning id, name
                """,
                workspace_id, user_id, pai, seg,
            ) or await db.fetch_one(
                "select id, name from public.note_folders "
                "where workspace_id = %s and parent_id is not distinct from %s and name = %s",
                workspace_id, pai, seg,
            )
            if not pasta:
                raise RuntimeError(f"pasta {seg!r} não criada nem achada")
            pai = pasta["id"]
        return {"id": pasta["id"], "name": pasta["name"], "caminho": r["caminho"]}
    except Exception as err:  # noqa: BLE001
        log.warning("ensure_folder falhou (nota fica sem pasta): %s", err)
        recusa = guards.recusa_do_banco(err, fim="A nota ficou sem pasta.")
        return falhou(recusa or "⚠️ Não consegui criar a pasta; a nota ficou sem pasta.")


async def _regra_que_cita(workspace_id, conteudo: str) -> dict | None:
    """A regra "nota que cita X vai para Y" que casa com o conteúdo: `{"rule_id", "pasta"}` ou None.
    Sob `AGENTE_RLS` a versão que confere a posse. Nunca levanta: a regra não derruba a nota."""
    funcao = "private.match_note_rule_do_membro" if db.rls_ativo() else "public._match_note_rule"
    try:
        regra = await db.fetch_one(
            f"select rule_id, folder_id from {funcao}(%s, %s)",  # noqa: S608 — nome fixo acima
            workspace_id, conteudo,
        )
        if not regra:
            return None
        pastas = await carregar_pastas(workspace_id)
        pasta = next((p for p in pastas if str(p["id"]) == str(regra["folder_id"])), None)
        if not pasta:
            return None
        return {"rule_id": regra["rule_id"], "pasta": {
            "id": pasta["id"], "name": pasta["name"], "caminho": caminhos(pastas)[pasta["id"]]}}
    except Exception as err:  # noqa: BLE001
        log.warning("regra de nota ignorada: %s", err)
        return None


async def _pasta_existe(workspace_id, texto: str) -> bool:
    return (await resolver_pasta(workspace_id, texto))["estado"] in {"achada", "ambigua"}


async def regra_da_nota(workspace_id, conteudo: str, folder: str | None) -> dict | None:
    """A regra que manda a nota, sem efeito (não conta `hits`). Vale com pasta vazia OU com um nome
    que ainda não existe (o modelo inventou); pasta que já existe e foi escolhida fica."""
    if folder and await _pasta_existe(workspace_id, folder):
        return None
    return await _regra_que_cita(workspace_id, conteudo)


async def _pasta_da_regra(ctx: ExecContext, conteudo: str, folder: str | None) -> dict | None:
    """Na execução: a regra vale com pasta vazia/inexistente OU quando a pasta já é a da regra
    (congelada antes do SIM). Conta o `hits` das notas que de fato foram para a pasta da regra."""
    regra = await _regra_que_cita(ctx.workspace_id, conteudo)
    if not regra:
        return None
    if folder:
        r = await resolver_pasta(ctx.workspace_id, folder)
        if r["estado"] == "ambigua" or (r["estado"] == "achada" and str(r["id"]) != str(regra["pasta"]["id"])):
            return None
    try:
        # direto na tabela (a RPC de contador não é do `authenticated`); a RLS já escopa
        await db.execute(
            "update public.categorization_rules set hits = hits + 1 where id = %s and workspace_id = %s",
            regra["rule_id"], ctx.workspace_id,
        )
    except Exception as err:  # noqa: BLE001
        log.warning("hits da regra de nota não contados: %s", err)
    return regra["pasta"]


def _folha(texto: str | None) -> str | None:
    """Só o último nível: é o que cabe na coluna legada `category` (40 chars)."""
    return normalize_folder((texto or "").split("/")[-1])


async def create_note(ctx: ExecContext, action: NotesAction) -> ToolResult:
    conteudo = guards.require_text(action.content, o_que="o que anotar", maximo=20_000)
    avisos: list[str] = []
    if action.sem_pasta:  # a pessoa pediu fora das pastas: nem regra, nem pasta
        pasta = None
    else:
        pasta = await _pasta_da_regra(ctx, conteudo, action.folder)
        if not pasta:
            pasta = await ensure_folder(ctx.workspace_id, ctx.user_id, action.folder, avisos)

    row = await db.fetch_one(
        """
        insert into public.notes
          (user_id, workspace_id, content, category, folder_id, source)
        values (%s, %s, %s, %s, %s, 'whatsapp')
        returning id
        """,
        ctx.user_id, ctx.workspace_id, conteudo,
        # grava os DOIS durante a transição da 0038: binário antigo ainda lê `category`
        pasta["name"] if pasta else (None if action.sem_pasta else _folha(action.folder)),
        pasta["id"] if pasta else None,
    )
    onde = f" em *{pasta['caminho']}*" if pasta else ""
    return ToolResult(
        f"📝 Nota salva{onde}: {first_line(conteudo)}" + "".join(f"\n{a}" for a in avisos),
        result_id=row["id"] if row else None,
    )


# O mesmo vocabulário de `src/lib/note-blocks.ts` (PREFIXO_DE_LISTA), mais os marcadores que chegam
# do WhatsApp ("•", "–", "1)").
_MARCADOR = re.compile(r"^\s*(?:[-*•–]\s\[(?: |x|X)\]\s?|[-*•–]\s+|\d{1,3}[.)]\s+)")
_TODO = re.compile(r"^\s*[-*]\s\[(?: |x|X)\]")
_ITEM = re.compile(r"^\s*[-*]\s+")
_NUMERO = re.compile(r"^\s*(\d{1,3})[.)]\s+")


def no_estilo_da_nota(trecho: str, nota: str | None) -> str:
    """O que se acrescenta segue a lista que a nota JÁ é (13/10/2026): "põe pão" numa checklist
    entra "- [ ] pão", numa numerada continua a contagem. Nota que não termina em lista: como veio."""
    ultima = next((l for l in reversed((nota or "").split("\n")) if l.strip()), "")
    numero = _NUMERO.match(ultima)
    if _TODO.match(ultima):
        prefixo = lambda _i: "- [ ] "  # noqa: E731
    elif _ITEM.match(ultima):
        prefixo = lambda _i: "- "  # noqa: E731
    elif numero:
        prefixo = lambda i: f"{int(numero.group(1)) + 1 + i}. "  # noqa: E731
    else:
        return trecho
    itens = [_MARCADOR.sub("", l).strip() for l in trecho.split("\n")]
    return "\n".join(prefixo(i) + item for i, item in enumerate(x for x in itens if x))


async def append_note(ctx: ExecContext, action: NotesAction) -> ToolResult:
    trecho = guards.require_text(action.append_text, o_que="o que acrescentar")

    # alvo congelado pela Fase Cognitiva
    nota_id = ctx.target["candidates"][0]["id"]
    rotulo = ctx.target["candidates"][0]["label"]

    # A leitura só escolhe o MARCADOR; o texto continua concatenado no SQL.
    atual = await db.fetch_one(
        "select content from public.notes where id = %s and workspace_id = %s", nota_id, ctx.workspace_id)
    trecho = no_estilo_da_nota(trecho, (atual or {}).get("content"))
    # Concatenação no SQL, não read-modify-write: entre o SELECT e o UPDATE a
    # nota pode ter sido editada no app, e a versão lida sobrescreveria a nova.
    linhas = await db.fetch(
        "update public.notes set content = rtrim(content) || E'\n' || %s, "
        "updated_at = now() where id = %s and workspace_id = %s returning id",
        trecho, nota_id, ctx.workspace_id,
    )
    if not linhas:
        return ToolResult("🤷 Essa nota não está mais aqui.", read_only=True)
    acrescentado = ", ".join(_MARCADOR.sub("", l).strip() for l in trecho.split("\n") if l.strip())
    return ToolResult(f"📝 Acrescentei *{acrescentado}* em: {rotulo}", result_id=nota_id)


async def query_notes(ctx: ExecContext, action: NotesAction) -> ToolResult:
    termo = (action.search_term or action.content or "").strip()
    pasta = (action.folder or "").strip()
    ids_da_pasta = None
    if pasta:
        pastas = await carregar_pastas(ctx.workspace_id)
        r = resolver(pastas, pasta)
        if r["estado"] == "ambigua":
            return ToolResult("🤷 " + pergunta_da_ambiguidade(r, "procuro"),
                              read_only=True)
        if r["estado"] == "achada":
            ids_da_pasta = descendentes(pastas, r["id"])
            pasta = r["caminho"]
        else:
            ids_da_pasta = []  # pasta que não existe: nenhuma nota

    sql = [
        """
        select n.id, n.content, n.updated_at, n.folder_id
        from public.notes n
        where n.workspace_id = %s and n.deleted_at is null
          and n.archived_at is null
        """
    ]
    args: list = [ctx.workspace_id]
    if termo:
        # plainto_tsquery escapa a entrada: termo do usuário nunca vira sintaxe de
        # tsquery. pt_unaccent (0038) faz "reuniao" achar "reunião".
        sql.append("and n.search_tsv @@ plainto_tsquery('public.pt_unaccent', %s)")
        args.append(termo)
    if pasta:
        sql.append("and n.folder_id = any(%s)")
        args.append(ids_da_pasta)
    if action.query_from:
        sql.append("and n.created_at >= %s")
        args.append(to_instant(action.query_from, ctx.timezone))
    if action.query_to:
        sql.append("and n.created_at <= %s")
        args.append(to_instant(f"{action.query_to}T23:59:59", ctx.timezone))
    # ⚠️ **`pinned desc` primeiro, igual à tela.** Sem ele o "topo" do agente e o
    # topo do app discordavam: a pessoa fixa uma nota, pergunta "o que eu anotei?"
    # e recebe outra lista — sem erro nenhum, só a sensação de que fixar não fez
    # nada. Arquivada some das DUAS (o filtro acima), pelo mesmo motivo.
    sql.append("order by n.pinned desc, n.updated_at desc limit 5")

    notas = await db.fetch(" ".join(sql), *args)
    if any(n["folder_id"] for n in notas):  # o caminho de cada nota, não só o nome da folha
        todos = caminhos(await carregar_pastas(ctx.workspace_id))
        for n in notas:
            n["folder"] = todos.get(n["folder_id"])
    else:
        for n in notas:
            n["folder"] = None
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


def _instante_dito(remind_at: str | None, timezone_name: str):
    """O instante que a pessoa DISSE (data E hora), ou None. Só data não é instante: a hora não
    se inventa (14/10/2026) — `to_instant` carimbava 00:00 e, ilegível, devolvia "agora"."""
    cru = (remind_at or "").strip()
    if len(cru) <= 10:  # sem componente de hora (ou vazio)
        return None
    try:
        lido = datetime.fromisoformat(cru[:-1] + "+00:00" if cru.endswith("Z") else cru)
    except ValueError:
        return None
    return (lido if lido.tzinfo else lido.replace(tzinfo=tz(timezone_name))).astimezone(UTC)


def instante_do_lembrete(remind_at: str | None, rrule: str | None, timezone_name: str):
    """Quando o lembrete toca, ou None se falta algo que só a pessoa sabe (hora dita, data legível,
    futuro, regra válida). UMA conta para a tool, a pergunta e a frase do SIM (`nodes._congela_lembrete`).
    Com recorrência a primeira é a próxima ocorrência NAQUELA hora."""
    dito = _instante_dito(remind_at, timezone_name)
    if dito is None:
        return None
    if rrule:
        proxima = next_occurrence(rrule, now_utc(), timezone_name, dtstart=dito)
        return proxima or (dito if dito > now_utc() else None)
    return dito if dito > now_utc() else None


def _dia_dito(remind_at: str | None, timezone_name: str) -> str:
    """" amanhã (15/10)" / " hoje (14/10)" / " dia 20/10", ou "" se a data não é legível."""
    dia = (remind_at or "").strip()[:10]
    try:
        date.fromisoformat(dia)
    except ValueError:
        return ""
    br = format_date_br(dia)
    if dia == local_iso_date(timezone_name):
        return f" hoje ({br[:5]})"
    if dia == local_iso_date(timezone_name, now_utc() + timedelta(days=1)):
        return f" amanhã ({br[:5]})"
    return f" dia {br}"


def pergunta_do_lembrete(titulo: str | None, remind_at: str | None, recurrence: str | None,
                         timezone_name: str) -> str | None:
    """A PERGUNTA do que falta para criar o lembrete, ou None se está completo (14/10/2026: "sempre
    pergunte e nunca deduza"). Valida ESTRUTURA (componente de hora, instante legível, futuro, RRULE)."""
    nome = f"*{(titulo or 'isso').strip()}*"
    regra = guards.clean_rrule(recurrence)
    if (recurrence or "").strip() and not regra:
        return f"Não entendi como {nome} se repete — todo dia, toda semana, todo mês…? Me diz também a hora."
    if instante_do_lembrete(remind_at, regra, timezone_name) is not None:
        return None
    if regra and next_occurrence(regra, now_utc(), timezone_name) is None:
        return f"Não entendi como {nome} se repete — todo dia, toda semana, todo mês…? Me diz também a hora."
    cru = (remind_at or "").strip()
    if len(cru) > 10 and _instante_dito(cru, timezone_name) is None:
        return f"Não entendi quando lembrar de {nome}. Me diz o dia e a hora (ex.: amanhã às 9)."
    if len(cru) > 10 and not regra:
        passou = _instante_dito(cru, timezone_name).astimezone(tz(timezone_name))
        return (f"Esse horário já passou ({passou.strftime('%d/%m às %H:%M')}): para quando eu te "
                f"lembro de {nome}?")
    onde = f" {descreve_rrule(regra)}" if regra else _dia_dito(cru, timezone_name)
    if not onde:
        return f"Quando eu te lembro de {nome}? Me diz o dia e a hora."
    return f"Que horas eu te lembro de {nome}{onde}?"


def pergunta_da_hora(titulo: str | None, remind_at: str | None) -> str | None:
    """Lembrete LIGADO a um lançamento só precisa da hora: o dia sai de cada vencimento."""
    hora = (remind_at or "").strip()[11:16] if len((remind_at or "").strip()) > 10 else ""
    if re.fullmatch(r"\d{2}:\d{2}", hora):
        return None
    return f"Que horas eu te lembro de *{(titulo or 'isso').strip()}*?"


async def canal_padrao(user_id) -> str:
    """O canal do Perfil (`lembrete.canal_do_perfil`): o lembrete nasce por onde a pessoa escolheu ser avisada."""
    p = await db.fetch_one(
        "select alerts_push_enabled as push, alerts_whatsapp_enabled as zap from public.profiles where id = %s", user_id)
    return lembrete.canal_do_perfil(bool(p and p["push"]), bool(p and p["zap"]))


# alvo do lembrete de conta -> coluna de `bill_reminders` e tabela do registro (allowlist literal)
ALVOS_DO_LEMBRETE = {
    "recurring": ("recurring_id", "recurring_transactions"),
    "plan": ("installment_plan_id", "installment_plans"),
    "debt": ("debt_id", "debts"),
    "transaction": ("transaction_id", "transactions"),
}


async def lancamentos_do_lembrete(workspace_id, termo: str | None, conteudo: str | None,
                                  timezone_name: str) -> list[dict]:
    """Os registros a que um lembrete pode se ligar e que ele cita (16/10/2026): série de gasto ativa, compra
    parcelada com parcela em aberto, dívida em aberto e gasto avulso que ainda vai vencer. As mesmas réguas
    de `save_bill_reminder` (só conta a pagar). Até 5, os de nome igual ao dito primeiro."""
    hoje = local_iso_date(timezone_name)
    valores = {"ws": workspace_id, "hoje": hoje, "fuso": timezone_name}
    sql = (
        """
        select 'recurring' as alvo, r.id::text as id, coalesce(r.description, r.merchant, r.category) as nome,
               r.rrule as regra,
               coalesce((select min(coalesce(t.due_at, t.occurred_at)) from public.transactions t
                         where t.recurring_id = r.id and t.status = 'pending' and t.invoice_id is null
                           and coalesce(t.due_at, t.occurred_at) >= %(hoje)s::date),
                        (r.next_run_at at time zone %(fuso)s)::date) as vence
        from public.recurring_transactions r
        where r.workspace_id = %(ws)s and r.kind = 'expense' and r.active
          and (r.end_date is null or r.end_date >= %(hoje)s::date)
        union all
        select 'plan', p.id::text, coalesce(p.description, p.merchant, p.category), null,
               (select min(coalesce(ci.due_date, t.due_at, t.occurred_at)) from public.transactions t
                left join public.card_invoices ci on ci.id = t.invoice_id
                where t.installment_plan_id = p.id
                  and ((t.invoice_id is null and t.status = 'pending')
                       or (t.invoice_id is not null and ci.status not in ('paid', 'rolled')))
                  and coalesce(ci.due_date, t.due_at, t.occurred_at) >= %(hoje)s::date)
        from public.installment_plans p
        where p.workspace_id = %(ws)s
        union all
        select 'debt', d.id::text, d.name, null,
               (select min(s.due_date) from private.debt_schedule_for(d.id) s where s.due_date >= %(hoje)s::date)
        from public.debts d
        where d.workspace_id = %(ws)s and not d.archived and d.remaining_cents > 0
        union all
        select * from (
          select 'transaction', t.id::text, coalesce(t.description, t.merchant, t.category), null,
                 coalesce(t.due_at, t.occurred_at)
          from public.transactions t
          where t.workspace_id = %(ws)s and t.kind = 'expense' and t.status = 'pending' and t.invoice_id is null
            and t.recurring_id is null and t.installment_plan_id is null and t.debt_id is null
            and t.pays_invoice_id is null and t.pix_fee_for_transaction_id is null
            and coalesce(t.due_at, t.occurred_at) >= %(hoje)s::date
          order by coalesce(t.due_at, t.occurred_at) limit 300) avulsos
        """
    )
    # `db.fetch` só aceita parâmetros posicionais: os nomes acima viram %s, na ordem em que aparecem
    linhas = await db.fetch(re.sub(r"%\(\w+\)s", "%s", sql), *[valores[n] for n in re.findall(r"%\((\w+)\)s", sql)])
    achados = [l for l in linhas
               if not (l["alvo"] == "plan" and l["vence"] is None)  # compra toda paga não tem o que lembrar
               and lembrete.casa_com_lembrete(l["nome"], termo, conteudo)]
    dito = matching.normalize(termo)
    achados.sort(key=lambda l: (matching.normalize(l["nome"]) != dito, str(l["vence"] or "9999")))
    return [{"alvo": l["alvo"], "id": l["id"], "nome": l["nome"],
             "regra": descreve_rrule(l["regra"]) if l["regra"] else None,
             "vence": l["vence"].isoformat() if l["vence"] else None} for l in achados[:5]]


def rotulo_do_vinculo(c: dict) -> str:
    """"*Aluguel* (todo dia 20)", "*TV* (compra parcelada)", "*Dentista* (vence 20/10/2026)"."""
    if c["alvo"] == "recurring":
        extra = c.get("regra") or "recorrente"
    elif c["alvo"] == "plan":
        extra = "compra parcelada"
    elif c["alvo"] == "debt":
        extra = "financiamento"
    else:
        extra = f"vence {format_date_br(c['vence'])}" if c.get("vence") else "conta a pagar"
    return f"*{c['nome']}* ({extra})"


async def _gravar_lembrete_ligado(ctx: ExecContext, vinculo: dict, dias: int, hora: str, canal: str):
    """Pela MESMA RPC do formulário do app (`save_bill_reminder`, sob `auth.uid()` = a pessoa): ela é quem
    recusa receita, conta paga, dívida quitada. Ela SUBSTITUI os avisos daquele alvo, então os que a pessoa já
    tinha vão junto. Devolve o id do aviso criado."""
    import json

    coluna, _ = ALVOS_DO_LEMBRETE[vinculo["alvo"]]
    filtro = f"user_id = %s and {coluna} = %s" + (" and debt_installment_no is null" if vinculo["alvo"] == "debt" else "")
    antes = await db.fetch(
        f"select days_before, to_char(at_time, 'HH24:MI') as at_time from public.bill_reminders where {filtro}",  # noqa: S608
        ctx.user_id, vinculo["id"])
    avisos = [{"days_before": a["days_before"], "at_time": a["at_time"]} for a in antes]
    if not any(a["days_before"] == dias and a["at_time"] == hora for a in avisos):
        avisos.append({"days_before": dias, "at_time": hora})
    await db.fetch_one("select public.save_bill_reminder(%s::jsonb, %s::jsonb, %s)",
                       json.dumps({coluna: vinculo["id"]}), json.dumps(avisos), canal)
    return await db.fetch_one(
        f"select id from public.bill_reminders where {filtro} and days_before = %s and at_time = %s::time",  # noqa: S608
        ctx.user_id, vinculo["id"], dias, hora)


async def _criar_lembrete_ligado(ctx: ExecContext, alvo: dict, action: NotesAction, canal: str) -> ToolResult:
    import psycopg

    from app.tools.base import ensure_owned

    vinculo = alvo["vinculo"]
    _, tabela = ALVOS_DO_LEMBRETE[vinculo["alvo"]]
    await ensure_owned(tabela, vinculo["id"], ctx.workspace_id)
    hora = alvo.get("hora") or (action.remind_at or "")[11:16]
    if not re.fullmatch(r"\d{2}:\d{2}", hora or ""):
        raise Level1Error(f"❌ {pergunta_da_hora(action.content, None)} Ainda não criei o lembrete.")
    dias = int(alvo.get("dias_antes") or 0)
    try:
        # bloco aninhado: a recusa do banco desfaz só ele (o `except` segue em frente)
        async with db.unidade_de_trabalho():
            if db.rls_ativo():
                row = await _gravar_lembrete_ligado(ctx, vinculo, dias, hora, canal)
            else:
                async with db.sob_rls(ctx.user_id):
                    row = await _gravar_lembrete_ligado(ctx, vinculo, dias, hora, canal)
    except psycopg.errors.RaiseException as err:
        return ToolResult(f"❌ {err.diag.message_primary}. Ainda não criei o lembrete.", read_only=True)
    return ToolResult(
        f"⏰ Lembrete vinculado a {rotulo_do_vinculo(vinculo)}: te aviso {lembrete.frase_dos_dias(dias)}, às {hora}, "
        f"por {lembrete.ROTULO_DO_CANAL[canal]}.",
        result_id=row["id"] if row else None,
    )


async def create_reminder(ctx: ExecContext, action: NotesAction) -> ToolResult:
    titulo = guards.require_text(action.content, o_que="o que lembrar", maximo=200)
    alvo = ctx.target or {}
    # o canal congelado antes do SIM (o dito ou o do Perfil); checkpoint antigo, sem ele: o de antes
    canal = alvo.get("canal") or lembrete.canal_dito(action.channel) or "push"
    if alvo.get("vinculo"):
        return await _criar_lembrete_ligado(ctx, alvo, action, canal)
    rrule = guards.clean_rrule(action.recurrence)

    quando = instante_do_lembrete(action.remind_at, rrule, ctx.timezone)
    if quando is None:
        raise Level1Error(
            "❌ " + pergunta_do_lembrete(titulo, action.remind_at, action.recurrence, ctx.timezone)
            + " Ainda não criei o lembrete."
        )

    row = await db.fetch_one(
        """
        insert into public.reminders
          (user_id, workspace_id, title, recurrence, next_run_at, timezone, channel, source)
        values (%s, %s, %s, %s, %s, %s, %s, 'whatsapp')
        returning id
        """,
        ctx.user_id, ctx.workspace_id, titulo, rrule, quando, ctx.timezone, canal,
    )
    repete = f", {descreve_rrule(rrule)}" if rrule else ""
    # no fuso da pessoa: `quando` é UTC, e das 21h à meia-noite a data UTC já é o dia seguinte
    local = quando.astimezone(tz(ctx.timezone))
    return ToolResult(
        f"⏰ Lembrete criado: *{titulo}* em {format_date_br(local.date())} às {local:%H:%M}{repete}, "
        f"por {lembrete.ROTULO_DO_CANAL[canal]}.",
        result_id=row["id"] if row else None,
    )


async def delete_reminder(ctx: ExecContext, action: NotesAction) -> ToolResult:
    # Só valida: o título exibido sai do alvo congelado, logo abaixo.
    guards.require_text(action.search_term or action.content, o_que="qual lembrete")
    # alvo congelado pela Fase Cognitiva (ver delete_note)
    achados = [{"id": ctx.target["candidates"][0]["id"],
                "title": ctx.target["candidates"][0]["label"]}]
    await db.execute(
        "delete from public.reminders where id = %s and workspace_id = %s",
        achados[0]["id"], ctx.workspace_id,
    )
    return ToolResult(f"🗑️ Lembrete apagado: {achados[0]['title']}", result_id=achados[0]["id"])


async def query_reminders(ctx: ExecContext, action: NotesAction) -> ToolResult:
    """Os lembretes agendados, do mais próximo para o mais distante.

    ⚠️ **Todo instante aqui é convertido para o FUSO DO USUÁRIO antes de virar data ou hora.**
    `reminders.next_run_at` é `timestamptz` e o container roda em UTC: um lembrete das 21h de
    Brasília é meia-noite do DIA SEGUINTE em UTC. Formatar o instante cru diria "amanhã" para
    algo que toca hoje à noite — e lembrete que anuncia o dia errado é pior que lembrete
    nenhum. Quem resolve é `local_iso_date` / `local_now` com `ctx.timezone`, que já cai em
    America/Sao_Paulo quando o profile não tem fuso.

    "Hoje" e "amanhã" também saem da data LOCAL, nunca de `now_utc().date()`.

    Escopo por `workspace_id`, tabela literal, nenhum id vindo do modelo.
    """
    termo = (action.search_term or action.content or "").strip()

    sql = [
        """
        select title, next_run_at, recurrence, channel, paused_from, paused_until
        from public.reminders
        where workspace_id = %s and active = true
        """
    ]
    args: list = [ctx.workspace_id]
    if termo:
        sql.append("and extensions.unaccent(title) ilike extensions.unaccent(%s)")
        args.append(matching.like_contem(termo))
    if action.query_from:
        sql.append("and next_run_at >= %s")
        args.append(to_instant(action.query_from, ctx.timezone))
    if action.query_to:
        sql.append("and next_run_at <= %s")
        args.append(to_instant(f"{action.query_to}T23:59:59", ctx.timezone))
    sql.append("order by next_run_at limit 10")

    rows = await db.fetch(" ".join(sql), *args)
    # Lembrete em pausa com prazo não é "próximo": nem hoje dentro da pausa, nem a data dentro dela.
    hoje_local = local_iso_date(ctx.timezone)
    rows = [
        r for r in rows
        if not em_pausa(hoje_local, r.get("paused_from"), r.get("paused_until"))
        and not em_pausa(local_iso_date(ctx.timezone, r["next_run_at"]), r.get("paused_from"), r.get("paused_until"))
    ]
    ligados = await _lembretes_ligados(ctx, termo, action.query_from, action.query_to)
    if not rows and not ligados:
        alvo = f' com "{termo}"' if termo else ""
        return ToolResult(
            f"⏰ Nenhum lembrete{alvo} por aqui. Tenta "
            '"me lembra de pagar o aluguel todo dia 5".',
            read_only=True,
        )

    hoje = local_iso_date(ctx.timezone)
    amanha = local_iso_date(ctx.timezone, now_utc() + timedelta(days=1))

    linhas = ["⏰ *Seus lembretes*"] if rows else []
    for r in rows:
        dia = local_iso_date(ctx.timezone, r["next_run_at"])
        hora = local_now(ctx.timezone, r["next_run_at"]).strftime("%H:%M")
        if dia == hoje:
            quando = f"hoje às {hora}"
        elif dia == amanha:
            quando = f"amanhã às {hora}"
        else:
            quando = f"{format_date_br(dia)} às {hora}"
        repete = descreve_rrule(r["recurrence"]) if r["recurrence"] else ""
        sufixo = f" · {repete}" if repete and repete != "sem recorrência" else ""
        canal = lembrete.ROTULO_CURTO_DO_CANAL.get(r.get("channel") or "")
        linhas.append(f"  • {r['title']} — {quando}{sufixo}" + (f" · {canal}" if canal else ""))
    if ligados:
        linhas += ["", "🔗 *Vinculados a lançamentos*" if rows else "🔗 *Seus lembretes vinculados a lançamentos*"]
        for l in ligados:
            avisos = ", ".join(f"{lembrete.frase_dos_dias(a['days_before'])} às {a['at_time']}" for a in l["avisos"])
            prox = f" · próximo vencimento {format_date_br(l['next_due'])}" if l["next_due"] else ""
            canal = lembrete.ROTULO_CURTO_DO_CANAL.get(l["channel"] or "")
            linhas.append(f"  • {l['title']} — {avisos}{prox}" + (f" · {canal}" if canal else ""))
    return ToolResult("\n".join(linhas).strip(), read_only=True)


async def _lembretes_ligados(ctx: ExecContext, termo: str, de: str | None, ate: str | None) -> list[dict]:
    """Os lembretes de conta DA PESSOA (`bill_reminders_overview`, a lista do app, sob `auth.uid()`). Falhar
    nunca derruba a lista dos lembretes soltos."""
    sql = "select title, channel, avisos, next_due from public.bill_reminders_overview()"
    try:
        if db.rls_ativo():
            linhas = await db.fetch(sql)
        else:
            async with db.unidade_de_trabalho():
                async with db.sob_rls(ctx.user_id):
                    linhas = await db.fetch(sql)
    except Exception:  # noqa: BLE001
        log.warning("lembretes de conta não lidos", exc_info=True)
        return []
    dito = matching.normalize(termo)
    return [
        l for l in linhas
        if (not dito or dito in matching.normalize(l["title"]))
        and (not de or (l["next_due"] and l["next_due"].isoformat() >= de))
        and (not ate or (l["next_due"] and l["next_due"].isoformat() <= ate))
    ]
