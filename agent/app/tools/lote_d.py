"""Lote D da paridade com o app: reserva de emergência (F07, só consulta), plano de metas (F08, só
consulta), meta por prazo × por mês (F10), marcos/ícone/cor da meta (F19) e favoritos/duplicar (F22).

O desenho é o do lote B (`movimentos.py`): a leitura e a prévia rodam como o usuário
(`db.como_usuario`, porque as RPCs leem `auth.uid()`), a conta de calendário/dinheiro vem do BANCO
(`private.goal_contribution_result`, `emergency_reserve_state`, `goal_planning_state_v2`) e a frase
do SIM carrega os números que ele devolveu. Nenhum campo novo no `FinanceAction`/`FinanceQuery`.
"""

from __future__ import annotations

import json
from datetime import date

from app import db
from app.domain.dates import format_date_br, local_iso_date
from app.domain.money import cents_to_brl
from app.tools.base import ExecContext, ToolResult
from app.tools.guards import Level1Error
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


def _data_iso(valor: str) -> str:
    try:
        return date.fromisoformat(str(valor)[:10]).isoformat()
    except ValueError:
        raise Level1Error("Me diz a data certinha (ex.: 20/12/2027). Nada foi alterado.") from None
