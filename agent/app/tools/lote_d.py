"""Lote D da paridade com o app: reserva de emergência (F07, só consulta), plano de metas (F08, só
consulta), meta por prazo × por mês (F10), marcos/ícone/cor da meta (F19) e favoritos/duplicar (F22).

O desenho é o do lote B (`movimentos.py`): a leitura e a prévia rodam como o usuário
(`db.como_usuario`, porque as RPCs leem `auth.uid()`), a conta de calendário/dinheiro vem do BANCO
(`private.goal_contribution_result`, `emergency_reserve_state`, `goal_planning_state_v2`) e a frase
do SIM carrega os números que ele devolveu. Nenhum campo novo no `FinanceAction`/`FinanceQuery`.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal

import psycopg

from app import db
from app.domain import goal_appearance as ga
from app.domain import matching
from app.domain.dates import format_date_br, local_iso_date
from app.domain.money import cents_to_brl
from app.tools.base import ExecContext, ToolResult
from app.tools.guards import Level1Error, optional_date
from app.tools.movimentos import Recusa, _brl, _previa

# ---------------------------------------------------------------------------
# F07 — reserva de emergência (só consulta)
# ---------------------------------------------------------------------------


def _int(v) -> int:
    return int(str(v))


def resumo_da_reserva(estado: dict) -> dict:
    """Espelho de `getEmergencyReserveSummary` (src/lib/emergency-reserve.ts), em inteiros.

    `base` diz por que não há número: `nao_configurada`, `sem_revisao`, `sem_classificar`,
    `base_zero` ou `ok` (manual/observada).
    """
    fontes = estado.get("sources") or []
    meses = estado.get("months") or []
    cfg = estado.get("config")
    planejado = sum(_int(s["allocated_cents"]) for s in fontes)
    reservado = sum(_int(s["effective_cents"]) for s in fontes)
    base, mensal = "ok", None
    if not cfg:
        base = "nao_configurada"
    elif cfg["base_mode"] == "manual":
        mensal = _int(cfg["manual_monthly_cents"]) if cfg.get("manual_monthly_cents") is not None else None
        if not mensal:
            base, mensal = "nao_configurada", None
    elif any(m["unclassified_count"] > 0 for m in meses):
        base = "sem_classificar"
    elif len(meses) != 3 or not all(m["reviewed"] for m in meses):
        base = "sem_revisao"
    else:
        total = sum(_int(m["essential_cents"]) for m in meses)
        if total == 0:
            base = "base_zero"
        else:
            mensal = (total + 2) // 3
    meta = mensal * int(cfg["target_months"]) if mensal and cfg else None
    return {
        "base": base, "mensal": mensal, "reservado": reservado, "planejado": planejado,
        "sem_lastro": planejado - reservado, "meta": meta,
        "falta": None if meta is None else max(meta - reservado, 0),
        "meses": cfg["target_months"] if cfg else None,
    }


def cobertura_em_texto(reservado: int, mensal: int) -> str:
    """Décimos por divisão inteira, como `formatEmergencyReserveCoverage`: nunca arredonda para cima."""
    decimos = reservado * 10 // mensal
    if decimos == 0:
        return "menos de 0,1 mês"
    inteiro, fracao = divmod(decimos, 10)
    return f"{inteiro}{f',{fracao}' if fracao else ''} {'mês' if decimos == 10 else 'meses'}"


_SEM_BASE = {
    "nao_configurada": "Você ainda não definiu a base da reserva de emergência (quanto você gasta de essencial por mês).",
    "sem_classificar": "A base da sua reserva é a média do gasto essencial dos últimos 3 meses, mas ainda há "
                       "gasto sem classificar (essencial ou não).",
    "sem_revisao": "A base da sua reserva é a média do gasto essencial dos últimos 3 meses, mas esses meses ainda "
                   "não foram revisados.",
    "base_zero": "Os 3 meses revisados não têm gasto essencial, então a base da reserva é zero.",
}


def frase_da_reserva(r: dict) -> str:
    reservado = _brl(r["reservado"])
    if r["base"] != "ok":
        extra = f" Reservado hoje: {reservado}." if r["reservado"] else ""
        return (f"🛟 {_SEM_BASE[r['base']]} Por isso não calculo quantos meses ela cobre."
                f"{extra} Para definir a base, é no app (Finanças › Metas › Reserva de emergência).")
    if r["reservado"] == 0:
        cobre = "Ainda não há nenhum valor separado para a reserva"
    else:
        cobre = (f"Sua reserva de emergência cobre {cobertura_em_texto(r['reservado'], r['mensal'])} "
                 f"({reservado} reservados ÷ {_brl(r['mensal'])} de gasto essencial por mês)")
    texto = f"🛟 {cobre}. Meta: {r['meses']} meses = {_brl(r['meta'])}; "
    texto += "a meta está batida." if r["falta"] == 0 else f"faltam {_brl(r['falta'])}."
    if r["sem_lastro"] > 0:
        texto += (f" Atenção: {_brl(r['sem_lastro'])} do que você escolheu para a reserva não tem saldo "
                  "disponível hoje (fora da conta).")
    return texto


async def ler_reserva(ctx: ExecContext) -> ToolResult:
    async def ler(tx):
        row = await tx.fetch_one("select public.emergency_reserve_state(%s, %s::date) as s",
                                 ctx.workspace_id, local_iso_date(ctx.timezone))
        return row["s"]

    estado = await _previa(ctx.user_id, ler)
    if str(estado["workspace_id"]) != str(ctx.workspace_id):
        raise Recusa("Não consegui conferir o espaço da reserva. Nada foi alterado.")
    return ToolResult(frase_da_reserva(resumo_da_reserva(estado)), read_only=True)


# ---------------------------------------------------------------------------
# F08 — plano de metas (só consulta)
# ---------------------------------------------------------------------------


def frase_do_plano_de_metas(s: dict, hoje: str) -> str:
    metas = [g for g in s["goals"] if g["included"]]
    if not metas:
        return ("🎯 Você não tem meta em andamento no plano (metas concluídas ficam de fora). "
                "Cria uma meta e eu monto o plano.")
    linhas = []
    for g in metas:
        mensal = f"{_brl(g['monthly_cents'])} por mês" if g.get("monthly_cents") not in (None, "0") else "sem aporte definido"
        prazo = f" até {format_date_br(g['deadline'])}" if g.get("deadline") else ""
        linhas.append(f"  • {g['name']}: {mensal}{prazo}")
    texto = "🎯 Seu plano de metas:\n" + "\n".join(linhas)
    avisos = []
    if s["incomplete_goal_ids"]:
        nomes = [g["name"] for g in metas if g["goal_id"] in s["incomplete_goal_ids"]]
        avisos.append("Falta dado para calcular: " + ", ".join(nomes) + ".")
    if s["missed_deadline_goal_ids"]:
        nomes = [g["name"] for g in metas if g["goal_id"] in s["missed_deadline_goal_ids"]]
        avisos.append("Não chega no prazo: " + ", ".join(nomes) + ".")
    pressao = s.get("first_pressure_on")
    minimo = s.get("minimum_available_cents")
    if not s["income_present"]:
        # nunca "cabe" sem renda: a disponibilidade do banco não conta o que ainda vai entrar
        avisos.append("Não dá para dizer que cabe: não há renda lançada no período, então o plano não tem de onde "
                      "sair.")
        if pressao:
            avisos.append(f"Só com o caixa de hoje, o plano aperta a partir de {format_date_br(pressao)} "
                          f"(menor disponível: {_brl(minimo)}).")
    elif pressao:
        avisos.append(f"Aperta em {format_date_br(pressao)}: o disponível fica negativo (menor valor "
                      f"{_brl(minimo)}). Não cabe sem ajustar.")
    else:
        avisos.append(f"Cabe: o disponível não fica negativo no período (menor valor {_brl(minimo)}).")
    return texto + "\n" + " ".join(avisos)


async def ler_plano_de_metas(ctx: ExecContext) -> ToolResult:
    async def ler(tx):
        view = (await tx.fetch_one("select coalesce(cycle_view, 'civil') as v from public.workspaces where id = %s",
                                   ctx.workspace_id) or {}).get("v") or "civil"
        row = await tx.fetch_one("select public.goal_planning_state_v2(%s, 365, %s, 'month') as r",
                                 ctx.workspace_id, view)
        return row["r"]["state"]

    estado = await _previa(ctx.user_id, ler)
    if str(estado["workspace_id"]) != str(ctx.workspace_id):
        raise Recusa("Não consegui conferir o espaço do plano. Nada foi alterado.")
    return ToolResult(frase_do_plano_de_metas(estado, local_iso_date(ctx.timezone)), read_only=True)


ARTIGO = {"reserva": "a", "plano_metas": "o"}
LEITURAS = {"reserva": ler_reserva, "plano_metas": ler_plano_de_metas}


# ---------------------------------------------------------------------------
# F10 — meta por prazo × por mês (a conta é do banco)
# ---------------------------------------------------------------------------


async def contribuicao(tx_ou_none, *, alvo: int, guardado: int, hoje: str, prazo: str | None = None,
                       mensal: int | None = None) -> dict:
    """`private.goal_contribution_result`: por prazo (quanto por mês) ou por mês (quando chega).

    A âncora é o dia de hoje — o mesmo `first_on = today` que `goal_planning_state_v2` sugere para
    meta sem plano gravado. É função imutável: nenhuma escrita, nenhuma transação a desfazer.
    """
    entrada = {
        "target_cents": alvo, "saved_cents": guardado, "as_of": hoje,
        "mode": "deadline" if prazo else "monthly", "monthly_cents": None if prazo else mensal,
        "first_on": hoje, "deadline_on": prazo, "initial_cents": 0, "initial_on": None,
    }
    row = await db.fetch_one("select private.goal_contribution_result(%s::jsonb) as r", json.dumps(entrada))
    return row["r"]


def frase_da_contribuicao(r: dict) -> str | None:
    """O que o cálculo do banco diz, em português. `None` quando não há o que dizer."""
    estado = r["status"]
    if estado == "reached":
        return "a meta já está batida"
    if estado == "unreachable":
        return "o prazo já passou ou não tem nenhuma data de aporte até ele"
    if estado == "out_of_range":
        return "o cálculo passa do calendário que eu consigo mostrar"
    if estado != "ready":
        return None
    n = int(r["monthly_count"])
    mensal = int(r["monthly_cents"])
    ultimo = int(r["last_cents"])
    cauda = "" if n <= 1 or ultimo == mensal else f" (o último sai {cents_to_brl(ultimo)})"
    return (f"{cents_to_brl(mensal)} por mês, em {n} {'aporte' if n == 1 else 'aportes'}, do dia "
            f"{format_date_br(r['first_monthly_on'])} ao dia {format_date_br(r['estimated_on'])}{cauda}")


async def frase_de_prazo_ou_mensal(*, alvo: int, guardado: int, hoje: str, prazo: str | None,
                                   mensal: int | None) -> str | None:
    """A frase que se junta ao SIM de criar/editar a meta; `None` se nada a calcular."""
    if prazo is None and not mensal:
        return None
    r = await contribuicao(None, alvo=alvo, guardado=guardado, hoje=hoje, prazo=prazo, mensal=mensal)
    if r["status"] != "ready":
        return (f"{'para chegar em ' + format_date_br(prazo) if prazo else 'guardando ' + cents_to_brl(mensal) + ' por mês'}"
                f": {frase_da_contribuicao(r) or 'ainda falta dado para calcular'}")
    if prazo:
        return f"para chegar em {format_date_br(prazo)} dá {frase_da_contribuicao(r)}"
    n, ultimo = int(r["monthly_count"]), int(r["last_cents"])
    cauda = f", o último de {cents_to_brl(ultimo)}" if n > 1 and ultimo != int(r["monthly_cents"]) else ""
    return (f"guardando {cents_to_brl(mensal)} por mês, a meta chega em {format_date_br(r['estimated_on'])} "
            f"({n} {'aporte' if n == 1 else 'aportes'}{cauda})")


async def congelar(tz: str, texto: str, acoes: list, alvos: list[dict], pular: set[int] | None = None) -> list[dict]:
    """"Quero juntar 10 mil até dezembro de 2027": a conta de quanto por mês fica no alvo, para a
    frase do SIM (`policy.describe_for_confirmation`). Best-effort: sem o cálculo a meta se cria igual."""
    from app.domain.money import parse_valor_em_centavos
    from app.graph.schemas import FinanceActionType

    alvos = [*alvos] + [{}] * max(0, len(acoes) - len(alvos))
    for i, a in enumerate(acoes):
        if i in (pular or set()) or getattr(a, "type", None) != FinanceActionType.CREATE_GOAL:
            continue
        try:
            prazo = optional_date(a.occurred_at, tz)
            valor = a.amount_cents or parse_valor_em_centavos(texto)
            if not prazo or not valor:
                continue
            frase = await frase_de_prazo_ou_mensal(alvo=int(valor), guardado=0, hoje=local_iso_date(tz),
                                                   prazo=str(prazo)[:10], mensal=None)
        except (Level1Error, psycopg.Error):
            continue
        if frase:
            alvos[i] = {**alvos[i], "contribuicao": frase}
    return alvos


# ---------------------------------------------------------------------------
# F10 + F19 no recurso `goals`: campos VIRTUAIS (`mensal_cents`, `marcos`, `icone`, `cor`)
# ---------------------------------------------------------------------------

CAMPOS_META = {"mensal_cents", "marcos", "icone", "cor"}
_LIMPAR = {"nenhum", "nenhuma", "sem", "tira", "tirar", "remove", "remover", "limpa", "limpar", "padrao", "normal"}
MAX_MARCOS = 20


def _pct_ou_none(item: str) -> Decimal | None:
    """`lerPercentual` do app, mas deixando 100 passar: 100% é o próprio alvo e a recusa diz isso."""
    limpo = item.strip().replace("%", "").replace(",", ".").strip()
    if not re.fullmatch(r"\d{1,3}(\.\d)?", limpo):
        return None
    p = Decimal(limpo)
    return p if 0 < p <= 100 else None


def percentual_para_centavos(pct: Decimal, alvo: int) -> int:
    """`percentualParaCentavos` do app: arredonda ao centavo, meio para cima."""
    return (alvo * int(pct * 10) + 500) // 1000


def _pct_texto(cents: int, alvo: int) -> str:
    """`centavosParaPercentual`: uma casa, sem zero sobrando (33,3 / 25)."""
    d = (cents * 2000 + alvo) // (alvo * 2)  # arredonda meio para cima, em décimos de ponto
    return f"{d // 10}" if d % 10 == 0 else f"{d // 10},{d % 10}"


def ler_marcos(texto: str | None, alvo: int, atuais: list[int]) -> list[int]:
    """"25%, 50%" ou "250000; 500000" (centavos) -> marcos em centavos. Lista completa, como o formulário do
    app; se TODOS os itens começam com "+", somam aos que já existem. Recusa antes do SIM o que o banco
    recusaria depois."""
    if texto is None or matching.normalize(texto) in _LIMPAR | {"sem marcos", "nenhum marco"}:
        return []
    itens = [i.strip() for i in re.split(r";|,(?!\d)|\se\s", texto) if i.strip()]
    if not itens:
        return []
    somar = all(i.startswith("+") for i in itens)
    marcos = list(atuais) if somar else []
    for item in itens:
        item = item.lstrip("+").strip()
        pct = _pct_ou_none(item) if "%" in item else None
        if "%" in item and pct is None:
            raise Level1Error(f"Não entendi o marco *{item}*: percentual entre 0 e 100, com até uma casa "
                              "(25%, 33,3%). Nada foi alterado.")
        if pct is not None:
            cents = percentual_para_centavos(pct, alvo)
        elif re.fullmatch(r"\d{1,16}", item):
            cents = int(item)
        else:
            raise Level1Error(f"Não entendi o marco *{item}*. Diga em porcentagem (25%) ou em reais "
                              "(R$ 2.500). Nada foi alterado.")
        if cents <= 0:
            raise Level1Error(f"O marco *{item}* dá R$ 0,00 para essa meta. Nada foi alterado.")
        if cents >= alvo:
            raise Level1Error(f"O marco de {cents_to_brl(cents)} precisa ficar abaixo do alvo "
                              f"({cents_to_brl(alvo)}); 100% é o próprio alvo. Nada foi alterado.")
        if cents in marcos:
            raise Level1Error("Tem marco repetido. Nada foi alterado.")
        marcos.append(cents)
    if len(marcos) > MAX_MARCOS:
        raise Level1Error(f"São marcos demais (o máximo é {MAX_MARCOS}). Nada foi alterado.")
    return sorted(marcos)


def _lista_de_marcos(marcos: list[int], alvo: int) -> str:
    return "; ".join(f"{_pct_texto(m, alvo)}% = {cents_to_brl(m)}" for m in marcos) or "nenhum"


def icone_da_meta(texto: str | None) -> str | None:
    """O ícone pelo nome em português da grade do app (ou o próprio id); fora dela, pergunta."""
    if texto is None or matching.normalize(texto) in _LIMPAR:
        return None
    chave = matching.normalize(texto)
    for icone, rotulo in ga.ROTULO_DO_ICONE.items():
        if chave in {matching.normalize(rotulo), matching.normalize(icone)}:
            return icone
    nomes = ", ".join(ga.ROTULO_DO_ICONE[i] for i in ga.ICONES)
    raise Level1Error(f"Não tenho o ícone *{texto}*. Os que o app oferece: {nomes}. Qual deles? Nada foi alterado.")


def cor_da_meta(texto: str | None, aliases: dict[str, str]) -> str | None:
    if texto is None or matching.normalize(texto) in _LIMPAR:
        return None
    chave = matching.normalize(texto)
    cor = aliases.get(chave, chave)
    if cor not in ga.CORES:
        raise Level1Error(f"Não tenho a cor *{texto}*. As do app: {', '.join(ga.CORES)}. Qual delas? "
                          "Nada foi alterado.")
    return cor


async def simular_mensal(ctx: ExecContext, nome: str | None, mensal: int | None) -> str:
    """"E se eu guardar 500 por mês na Viagem?" numa meta que existe: só responde, não grava nada."""
    from app.tools.movimentos import _achar

    if not nome:
        raise Level1Error("Qual meta? Me fala o nome dela. Nada foi alterado.")
    if not mensal or mensal <= 0:
        raise Level1Error("Quanto você guarda por mês? Me diz o valor. Nada foi alterado.")
    meta = await _achar(ctx.workspace_id, "goals", nome, "meta")
    g = await db.fetch_one(
        "select target_cents, saved_cents, deadline from public.goals where id = %s and workspace_id = %s",
        meta["id"], ctx.workspace_id)
    alvo, guardado, hoje = int(g["target_cents"]), int(g["saved_cents"]), local_iso_date(ctx.timezone)
    frase = await frase_de_prazo_ou_mensal(alvo=alvo, guardado=guardado, hoje=hoje, prazo=None, mensal=mensal)
    atraso = ""
    if g["deadline"]:
        r = await contribuicao(None, alvo=alvo, guardado=guardado, hoje=hoje, mensal=mensal)
        prazo = str(g["deadline"])[:10]
        if r["status"] == "ready":
            atraso = (f" Isso passa do prazo da meta ({format_date_br(prazo)})." if str(r["estimated_on"]) > prazo
                      else f" Dentro do prazo da meta ({format_date_br(prazo)}).")
    return f"🎯 Meta *{meta['name']}*: {frase}.{atraso}"


async def completar_meta(ctx: ExecContext, action_type: str, prepared: dict, values: dict, old: dict,
                         merged: dict, display: dict) -> str | None:
    """Fim do `prepare` de uma meta (criar ou editar): marcos em centavos contra o alvo FINAL, ícone/cor
    legíveis e a conta de prazo × mês do banco. Devolve o que se junta à frase do SIM."""
    meta_d = prepared.pop("_meta_d", None) or {}
    criando = action_type == "resource_create"
    if not meta_d and not (criando or values.keys() & {"deadline", "target_cents"}):
        return None  # arquivar ou renomear não calcula nada
    alvo = int(merged.get("target_cents") or 0)
    if alvo <= 0:
        return None
    partes = []
    if "icone" in meta_d:
        display["icon"] = ga.ROTULO_DO_ICONE.get(values.get("icon")) or "padrão"
    if "cor" in meta_d:
        display["color"] = values.get("color") or "padrão"
    if "marcos" in meta_d:
        atuais: list[int] = []
        if not criando:
            atuais = [int(m["amount_cents"]) for m in await db.fetch(
                "select amount_cents from public.goal_milestones where goal_id = %s and workspace_id = %s "
                "order by amount_cents", old["id"], ctx.workspace_id)]
        novos = ler_marcos(meta_d["marcos"], alvo, atuais)
        prepared["marcos"] = novos
        antes = f" (antes: {_lista_de_marcos(atuais, alvo)})" if atuais else ""
        partes.append(f"marcos: {_lista_de_marcos(novos, alvo)}{antes}")
    hoje = local_iso_date(ctx.timezone)
    guardado = 0 if criando else int(old.get("saved_cents") or 0)
    prazo = merged.get("deadline")
    prazo = str(prazo)[:10] if prazo else None
    mensal = meta_d.get("mensal_cents")
    mudou = criando or "deadline" in values or "target_cents" in values
    try:
        if mensal:
            frase = await frase_de_prazo_ou_mensal(alvo=alvo, guardado=guardado, hoje=hoje, prazo=None,
                                                   mensal=int(mensal))
            if frase and prazo:
                r = await contribuicao(None, alvo=alvo, guardado=guardado, hoje=hoje, mensal=int(mensal))
                if r["status"] == "ready":
                    frase += (f"; isso passa do prazo de {format_date_br(prazo)}" if str(r["estimated_on"]) > prazo
                              else f"; dentro do prazo de {format_date_br(prazo)}")
        elif mudou and prazo:
            frase = await frase_de_prazo_ou_mensal(alvo=alvo, guardado=guardado, hoje=hoje, prazo=prazo, mensal=None)
        else:
            frase = None
    except psycopg.Error:
        frase = None
    if frase:
        partes.append(frase)
    return "; ".join(partes) or None


async def gravar_marcos(ctx: ExecContext, goal_id, marcos: list[int]) -> None:
    """O que o app faz ao salvar a meta: apaga os que saíram e insere os novos (a tabela não tem UPDATE).
    A meta já foi conferida no UPDATE/INSERT; o espaço vai nas duas pontas por garantia."""
    atuais = {int(m["amount_cents"]) for m in await db.fetch(
        "select amount_cents from public.goal_milestones where goal_id = %s and workspace_id = %s",
        goal_id, ctx.workspace_id)}
    for m in atuais - set(marcos):
        await db.execute(
            "delete from public.goal_milestones where goal_id = %s and workspace_id = %s and amount_cents = %s",
            goal_id, ctx.workspace_id, m)
    for m in sorted(set(marcos) - atuais):
        await db.execute(
            "insert into public.goal_milestones (workspace_id, goal_id, amount_cents) values (%s, %s, %s) "
            "on conflict (goal_id, amount_cents) do nothing", ctx.workspace_id, goal_id, m)


async def linha_do_proximo_marco(workspace_id, metas: list[dict]) -> dict[str, str]:
    """Para `query_goals`: por meta, "Próximo marco: R$ X · faltam R$ Y" (`textoDoProximoMarco` do app)."""
    if not metas:
        return {}
    rows = await db.fetch(
        "select goal_id, amount_cents from public.goal_milestones where workspace_id = %s and goal_id = any(%s) "
        "order by amount_cents", workspace_id, [m["id"] for m in metas])
    por_meta: dict[str, list[int]] = {}
    for r in rows:
        por_meta.setdefault(str(r["goal_id"]), []).append(int(r["amount_cents"]))
    saida = {}
    for m in metas:
        alvo, guardado = int(m["target_cents"]), int(m["saved_cents"])
        visiveis = [x for x in por_meta.get(str(m["id"]), []) if 0 < x < alvo]
        if not visiveis or guardado >= alvo:
            continue
        proximo = next((x for x in visiveis if x > guardado), None)
        saida[str(m["id"])] = (f"Faltam {cents_to_brl(alvo - guardado)} para o alvo" if proximo is None else
                               f"Próximo marco: {cents_to_brl(proximo)} ({_pct_texto(proximo, alvo)}%) · "
                               f"faltam {cents_to_brl(proximo - guardado)}")
    return saida
