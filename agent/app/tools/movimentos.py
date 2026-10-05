"""Lote B da paridade com o app: guardar/retirar da meta (F11), aplicar/resgatar (F12), atualizar
valor e rendimento (F13) e o plano percentual do orçamento (F14).

Quatro RPCs do app, todas `auth.uid()` + recibo selado (`p_request_id`). Aqui só existe o ENCAIXE:

- **A frase do SIM sai do banco.** Cada comando roda de verdade numa transação do usuário que é
  DESFEITA no fim (`_previa`, o mesmo desenho do `preview_finance_write` do app), e os números da
  frase são os de antes e depois lidos nessa transação — o agente não faz conta de saldo. De quebra,
  a recusa de regra (saldo insuficiente, resgate maior que a posição, categoria que sumiu) chega
  ANTES do SIM, não depois.
- **O comando do SIM é o mesmo da prévia**, com a chave `request_id(mensagem, índice)`: reexecutar
  devolve o recibo. Revisão desatualizada (`PT409`) vira "mudou enquanto eu perguntava"
  (`guards.recusa_do_banco`).
- **Nenhum campo novo no `FinanceAction`** (teto medido): "guardei 300 na meta da nubank" e
  "transferi 200 para a conta de investimento" seguem como `goal_deposit` e `create_transfer`, e o
  desvio é decidido por `congelar`, que guarda o comando e a frase no ALVO; retirar, atualizar valor,
  rendimento e plano são campos virtuais de `ResourceAction`.
"""

from __future__ import annotations

import json
from datetime import date
from uuid import UUID, uuid4

import psycopg

from app import db
from app.domain.dates import format_date_br, local_iso_date
from app.domain.money import MAX_CENTS, cents_to_brl, parse_valor_em_centavos
from app.graph.schemas import FinanceActionType
from app.tools import guards
from app.tools.base import ExecContext, ToolResult, ensure_owned, request_id
from app.tools.guards import Level1Error

# O nome da RPC viaja no checkpoint; só estes valem.
RPCS = {"goal_money_command", "investment_command", "investment_value_command", "budget_plan_command"}

CAMPOS_RETIRAR = {"retirar_cents", "retirar_da_conta", "retirar_para_conta", "retirar_data"}
CAMPOS_VALOR = {"valor_atual_cents", "rendimento_cents", "rendimento_na_conta", "data_do_valor"}
CAMPOS_PLANO = {"aplicar_categorias", "aplicar_alcance", "aplicar_mes"}


class Recusa(Level1Error):
    """Recusa de regra com a frase pronta: não falta dado, não há o que perguntar."""


class _Desfaz(Exception):
    """Sai do bloco da transação do usuário para ela voltar inteira."""


def _brl(v) -> str:
    n = int(v)
    return f"-{cents_to_brl(-n)}" if n < 0 else cents_to_brl(n)


def _seta(a, b) -> str:
    return f"{_brl(a)} → {_brl(b)}"


async def _previa(user_id, corpo):
    """Roda `corpo(tx)` como o usuário e DESFAZ tudo; devolve o que o corpo devolveu."""
    try:
        async with db.como_usuario(user_id) as tx:
            raise _Desfaz(await corpo(tx))
    except _Desfaz as feito:
        return feito.args[0]
    except psycopg.Error as err:
        frase = guards.recusa_do_banco(err, fim="Nada foi alterado.")
        if frase is None:
            raise
        raise Recusa(frase) from err


async def _comando(tx, rpc: str, entrada: dict, rid) -> dict:
    row = await tx.fetch_one(f"select public.{rpc}(%s::jsonb, %s) as r", json.dumps(entrada), rid)  # noqa: S608
    return (row or {}).get("r") or {}


async def _conta(workspace_id, nome: str, papel: str) -> dict:
    """A conta citada pelo nome (ou uma PERGUNTA, nunca um palpite), com o tipo."""
    from app.tools.finance import conta_citada

    achada = await conta_citada(workspace_id, nome, papel=papel)
    for c in await db.accounts(workspace_id):
        if str(c["id"]) == str(achada):
            return c
    raise Recusa("🤷 Não achei essa conta. Nada foi alterado.")


async def _achar(workspace_id, tabela: str, nome: str, o_que: str, extra: str = "") -> dict:
    """Meta ou conta pelo nome (sem caixa e sem acento): igual primeiro, depois "contém". Empate pergunta."""
    assert tabela in {"goals", "accounts"}
    base = f"select id, name, type from public.{tabela} where workspace_id = %s and not archived{extra} and " \
        if tabela == "accounts" else \
        "select id, name from public.goals where workspace_id = %s and not archived and "
    rows = await db.fetch(
        base + "extensions.unaccent(lower(name)) = extensions.unaccent(lower(%s)) limit 6",
        workspace_id, nome.strip(),
    )
    if not rows:
        rows = await db.fetch(
            base + "extensions.unaccent(lower(name)) like extensions.unaccent(lower(%s)) order by name limit 6",
            workspace_id, f"%{nome.strip()}%",
        )
    if not rows:
        raise Recusa(f"Não achei {o_que} com o nome *{nome}*. Nada foi alterado.")
    if len(rows) > 1:
        raise Level1Error(f"Qual {o_que}? {', '.join(r['name'] for r in rows)}. Nada foi alterado.")
    return rows[0]


# ---------------------------------------------------------------------------
# leituras do banco (dentro da transação da prévia)
# ---------------------------------------------------------------------------


async def _estado_meta(tx, goal_id) -> dict:
    return (await tx.fetch_one("select public.goal_money_state(%s) as s", goal_id))["s"]


def _no_estado(estado: dict, account_id) -> dict:
    return next((a for a in estado["accounts"] if str(a["account_id"]) == str(account_id)),
                {"goal_cents": "0", "cash_cents": "0", "free_cents": "0"})


async def _posicao(tx, account_id) -> dict:
    todas = (await tx.fetch_one("select public.investment_positions() as p"))["p"] or []
    return next((p for p in todas if str(p["account_id"]) == str(account_id)), {})


def _resultado(p: dict) -> str:
    if p.get("result_cents") is None or p.get("result_quality") == "indisponível":
        return "indisponível"
    return _brl(p["result_cents"])


# ---------------------------------------------------------------------------
# F11 — guardar na meta (alvo do goal_deposit) e retirar (campos virtuais da meta)
# ---------------------------------------------------------------------------


def _frase_meta(entrada: dict, meta: str, hoje: str, antes: dict, guardado0: int, r: dict, depois: dict,
                contas: dict) -> str:
    """O que muda, com os números lidos do banco. `contas` é id -> nome."""
    op, amt = entrada["op"], _brl(entrada["amount_cents"])
    nome = lambda k: contas.get(str(entrada.get(k)), "conta")  # noqa: E731
    conta_id = entrada.get("account_id")
    a0, a1 = _no_estado(antes, conta_id), _no_estado(depois, conta_id)
    dia = entrada.get("occurred_on")
    quando = f" em {format_date_br(dia)}" if dia and dia != hoje else ""
    guardado = f"guardado na meta {_seta(guardado0, r['saved_cents'])}"
    separado = f"separado para a meta {_seta(a0['goal_cents'], a1['goal_cents'])}"
    livre = f"livre na conta {_seta(a0['free_cents'], a1['free_cents'])}"
    if op == "allocate":
        return (f"separar {amt} da meta *{meta}* na conta {nome('account_id')}{quando}: o dinheiro continua na "
                f"conta e o saldo dela NÃO muda, ele só fica reservado; {livre}; {separado}; {guardado}")
    if op == "transfer_in":
        o0, o1 = _no_estado(antes, entrada["from_account_id"]), _no_estado(depois, entrada["from_account_id"])
        return (f"transferir {amt} da conta {nome('from_account_id')} para a conta {nome('account_id')}{quando} e "
                f"guardar na meta *{meta}*: é uma transferência de verdade, o saldo das duas contas muda "
                f"({nome('from_account_id')} {_seta(o0['cash_cents'], o1['cash_cents'])}; "
                f"{nome('account_id')} {_seta(a0['cash_cents'], a1['cash_cents'])}); {guardado}")
    if op == "release":
        if not conta_id:
            return (f"retirar {amt} da meta *{meta}*{quando} (dinheiro guardado sem conta de origem): "
                    f"nenhum saldo muda; {guardado}")
        return (f"liberar {amt} da meta *{meta}* na conta {nome('account_id')}{quando}: o dinheiro continua na "
                f"conta e o saldo dela NÃO muda, ele só volta a ficar livre; {livre}; {separado}; {guardado}")
    d0, d1 = _no_estado(antes, entrada["to_account_id"]), _no_estado(depois, entrada["to_account_id"])
    return (f"transferir {amt} da conta {nome('account_id')} (onde estava separado para a meta *{meta}*) para a "
            f"conta {nome('to_account_id')}{quando}: é uma transferência de verdade, o saldo das duas contas muda "
            f"({nome('account_id')} {_seta(a0['cash_cents'], a1['cash_cents'])}; "
            f"{nome('to_account_id')} {_seta(d0['cash_cents'], d1['cash_cents'])}); {guardado}")


_FEITO_META = {
    "allocate": "🎯 Separei {amt} na conta {c} para a meta *{meta}*.",
    "transfer_in": "🎯 Transferi {amt} de {o} para {c} e guardei na meta *{meta}*.",
    "release": "↩️ Liberei {amt} da meta *{meta}*{c}.",
    "transfer_out": "↩️ Transferi {amt} de {c} para {d}; saiu da meta *{meta}*.",
}


async def _movimento_da_meta(ctx_ids: dict, meta: dict, entrada: dict, contas: dict) -> dict:
    """Roda a prévia do `goal_money_command` e devolve o `movimento` que viaja no alvo."""
    async def corpo(tx):
        antes = await _estado_meta(tx, meta["id"])
        g0 = int((await tx.fetch_one("select saved_cents from public.goals where id = %s", meta["id"]))["saved_cents"])
        r = await _comando(tx, "goal_money_command", entrada, uuid4())
        return antes, g0, r, await _estado_meta(tx, meta["id"])

    antes, g0, r, depois = await _previa(ctx_ids["user_id"], corpo)
    op = entrada["op"]
    nome = lambda k: contas.get(str(entrada.get(k)), "conta")  # noqa: E731
    feito = _FEITO_META[op].format(
        amt=_brl(entrada["amount_cents"]), meta=meta["name"], c=nome("account_id") if op != "release" else (
            f" (conta {nome('account_id')})" if entrada.get("account_id") else ""),
        o=nome("from_account_id"), d=nome("to_account_id"),
    )
    return {
        "rpc": "goal_money_command", "input": entrada, "alvo_id": str(meta["id"]), "tabela": "goals",
        "feito": feito, "cauda": "guardado na meta", "chave": "saved_cents",
        "frase": _frase_meta(entrada, meta["name"], ctx_ids["hoje"], antes, g0, r, depois, contas),
    }


async def congelar(user_id, workspace_id, tz: str, texto: str, acoes: list, alvos: list[dict],
                   pular: set[int] | None = None) -> list[dict]:
    """Guardar na meta com conta e aplicar/resgatar investimento: guarda o COMANDO e a FRASE no alvo.

    Roda na resolução (a confirmação é montada antes da tool), por isso a recusa vira
    `correction_error`, que é o que faz o gate parar antes de perguntar. Ação sem conta que importe
    passa direto — `goal_deposit` e `create_transfer` seguem como eram.
    """
    alvos = [*alvos] + [{}] * max(0, len(acoes) - len(alvos))
    hoje = local_iso_date(tz)
    for i, a in enumerate(acoes):
        tipo = getattr(a, "type", None)
        if i in (pular or set()) or alvos[i].get("correction_error"):
            continue
        try:
            if tipo == FinanceActionType.GOAL_DEPOSIT and (a.account or a.counterparty_account):
                mov = await _congelar_guardar(user_id, workspace_id, tz, hoje, texto, a, alvos[i])
            elif tipo == FinanceActionType.CREATE_TRANSFER:
                mov = await _congelar_aplicar(user_id, workspace_id, tz, hoje, texto, a, alvos[i])
            else:
                continue
        except Level1Error as err:
            alvos[i] = {**alvos[i], "correction_error": err.mensagem_usuario}
            continue
        if mov:
            alvos[i] = {**alvos[i], "movimento": mov}
    return alvos


async def _congelar_guardar(user_id, workspace_id, tz, hoje, texto, a, alvo) -> dict | None:
    if alvo.get("status") != "found" or not alvo.get("candidates"):
        return None  # sem meta resolvida quem responde é o `_sem_alvo` do registry
    valor = a.amount_cents or parse_valor_em_centavos(texto)
    if not valor:
        return None  # a falta do valor é pergunta de `faltando`, não minha
    if not a.account:
        raise Level1Error(
            "🤔 De qual conta saiu esse dinheiro? Diga a conta onde ele está (ex.: \"guardei 300 na viagem, "
            "da Nubank\"). Ainda não guardei nada."
        )
    meta = {"id": alvo["candidates"][0]["id"], "name": alvo["candidates"][0]["label"]}
    dia = guards.require_date(a.occurred_at, tz)
    conta = await _conta(workspace_id, a.account, "a conta")
    entrada: dict = {"op": "allocate", "goal_id": str(meta["id"]), "account_id": str(conta["id"]),
                     "amount_cents": str(valor), "occurred_on": dia}
    contas = {str(conta["id"]): conta["name"]}
    if a.counterparty_account:
        # duas contas = o dinheiro SAI da primeira e CHEGA na segunda, onde fica separado
        destino = await _conta(workspace_id, a.counterparty_account, "a conta de destino")
        entrada = {"op": "transfer_in", "goal_id": str(meta["id"]), "from_account_id": str(conta["id"]),
                   "account_id": str(destino["id"]), "amount_cents": str(valor), "occurred_on": dia}
        contas[str(destino["id"])] = destino["name"]
    try:
        return await _movimento_da_meta({"user_id": user_id, "hoje": hoje}, meta, entrada, contas)
    except Recusa as err:
        raise Level1Error(err.mensagem_usuario) from err


# ---------------------------------------------------------------------------
# F12 — aplicar/resgatar: a transferência cuja ponta é uma conta de investimento
# ---------------------------------------------------------------------------


async def _congelar_aplicar(user_id, workspace_id, tz, hoje, texto, a, alvo) -> dict | None:
    if not a.counterparty_account:
        return None
    valor = a.amount_cents or parse_valor_em_centavos(texto)
    contas = await db.accounts(workspace_id)
    por_id = {str(c["id"]): c for c in contas}
    from app.tools.finance import conta_citada

    destino = por_id.get(str(await conta_citada(workspace_id, a.counterparty_account, papel="a conta de destino")))
    if a.account:
        origem = por_id.get(str(await conta_citada(workspace_id, a.account, papel="a conta de onde saiu")))
    else:
        padrao = (alvo.get("default_account") or {}).get("id")
        origem = por_id.get(str(padrao)) if padrao else None
    if not origem or not destino or "investment" not in (origem["type"], destino["type"]):
        return None
    if not valor:
        return None
    if origem["type"] == destino["type"]:
        raise Level1Error("❌ Entre duas contas de investimento não dá para aplicar nem resgatar: uma ponta "
                          "precisa ser uma conta comum. Ainda não registrei nada.")
    dia = guards.require_date(a.occurred_at, tz)
    aplicar = destino["type"] == "investment"
    pos, outra = (destino, origem) if aplicar else (origem, destino)
    entrada = ({"op": "contribute", "position_account_id": str(pos["id"]), "from_account_id": str(outra["id"])}
               if aplicar else
               {"op": "redeem", "position_account_id": str(pos["id"]), "to_account_id": str(outra["id"])})
    entrada |= {"amount_cents": str(valor), "occurred_on": dia}

    async def corpo(tx):
        antes = await _posicao(tx, pos["id"])
        await _comando(tx, "investment_command", entrada, uuid4())
        return antes, await _posicao(tx, pos["id"])

    try:
        antes, depois = await _previa(user_id, corpo)
    except Recusa as err:
        raise Level1Error(err.mensagem_usuario) from err
    quando = f" em {format_date_br(dia)}" if dia != hoje else ""
    amt = _brl(valor)
    if aplicar:
        o_que = f"aplicar {amt} em *{pos['name']}*, saindo de *{outra['name']}*{quando}"
        feito = f"📈 Apliquei {amt} em *{pos['name']}* (saiu de {outra['name']})."
    else:
        o_que = f"resgatar {amt} de *{pos['name']}* para *{outra['name']}*{quando}"
        feito = f"📉 Resgatei {amt} de *{pos['name']}* para {outra['name']}."
    return {
        "rpc": "investment_command", "input": entrada, "alvo_id": str(pos["id"]), "tabela": "accounts",
        "feito": feito, "cauda": "saldo da posição", "chave": "position_balance_cents",
        "frase": (f"{o_que}: é uma transferência de verdade entre as contas, não é gasto nem receita; saldo da "
                  f"posição {_seta(antes.get('balance_cents', 0), depois.get('balance_cents', 0))}; valor atual "
                  f"{_seta(antes.get('value_cents', 0), depois.get('value_cents', 0))}. O patrimônio só muda "
                  "quando houver rendimento"),
    }


# ---------------------------------------------------------------------------
# execução (a mesma para os quatro) e o desvio das tools existentes
# ---------------------------------------------------------------------------


async def executar(ctx: ExecContext, mov: dict) -> ToolResult:
    """Roda o comando aprovado, como o usuário, com a chave da intenção. A recusa chega escrita
    pelo `registry.execute` (`guards.recusa_do_banco`)."""
    if mov.get("rpc") not in RPCS:
        raise Level1Error("A proposta não está pronta. Peça a operação novamente.")
    if mov.get("tabela"):
        await ensure_owned(mov["tabela"], mov["alvo_id"], ctx.workspace_id)
    async with db.como_usuario(ctx.user_id) as tx:
        r = await _comando(tx, mov["rpc"], mov["input"], request_id(ctx.source_message_id, ctx.action_index))
    texto = mov["feito"]
    if mov.get("chave") and r.get(mov["chave"]) is not None:
        texto += f" Agora: {mov['cauda']} {_brl(r[mov['chave']])}."
    if mov.get("fecho"):
        texto += " " + mov["fecho"]
    return ToolResult(texto, result_id=UUID(str(mov["alvo_id"])) if mov.get("alvo_id") else None)


# ---------------------------------------------------------------------------
# resources: meta (retirar), conta de investimento (valor, rendimento) e plano
# ---------------------------------------------------------------------------


def _recusar_se_misturar(values: dict, grupo: set[str], pelo_menos: str) -> None:
    if pelo_menos not in values:
        raise Level1Error("Me diz o valor. Nada foi alterado.")
    if values.keys() - grupo:
        raise Level1Error("Me diz uma coisa por vez. Nada foi alterado.")


def _data(valor, hoje: str, o_que: str) -> str:
    if not valor:
        return hoje
    try:
        return date.fromisoformat(str(valor)[:10]).isoformat()
    except ValueError:
        raise Level1Error(f"Me diz a data {o_que} (ex.: 20/09). Nada foi alterado.") from None


async def preparar_retirada(ctx: ExecContext, values: dict, nome: str | None, prepared: dict) -> dict:
    """"Tirei 200 da meta viagem" / "libera 300 da meta, da conta nubank" / "passa 300 da meta para a
    poupança" — o Retirar do app: `release` (o dinheiro fica na conta) ou `transfer_out` (move de verdade)."""
    _recusar_se_misturar(values, CAMPOS_RETIRAR, "retirar_cents")
    if not nome:
        raise Level1Error("Qual meta? Me fala o nome dela. Nada foi alterado.")
    valor = int(values["retirar_cents"])
    if not 0 < valor <= MAX_CENTS:
        raise Level1Error("O valor da retirada precisa ser maior que zero. Nada foi alterado.")
    meta = await _achar(ctx.workspace_id, "goals", nome, "meta")
    hoje = local_iso_date(ctx.timezone)
    dia = _data(values.get("retirar_data"), hoje, "da retirada")
    contas: dict[str, str] = {}
    entrada: dict = {"op": "release", "goal_id": str(meta["id"]), "amount_cents": str(valor), "occurred_on": dia}
    if values.get("retirar_da_conta"):
        origem = await _conta(ctx.workspace_id, values["retirar_da_conta"], "a conta onde estava separado")
        entrada["account_id"] = str(origem["id"])
        contas[str(origem["id"])] = origem["name"]
    if values.get("retirar_para_conta"):
        if "account_id" not in entrada:
            raise Level1Error("Para transferir de volta, diga de qual conta o dinheiro sai e para qual vai. "
                              "Nada foi alterado.")
        destino = await _conta(ctx.workspace_id, values["retirar_para_conta"], "a conta de destino")
        entrada = {"op": "transfer_out", "goal_id": str(meta["id"]), "account_id": entrada["account_id"],
                   "to_account_id": str(destino["id"]), "amount_cents": str(valor), "occurred_on": dia}
        contas[str(destino["id"])] = destino["name"]
    elif "account_id" not in entrada:
        # Sem conta dita: se o dinheiro da meta está separado em conta(s), é pergunta, não palpite.
        async def ler(tx):
            return await _estado_meta(tx, meta["id"])

        estado = await _previa(ctx.user_id, ler)
        onde = [a for a in estado["accounts"] if int(a["goal_cents"]) > 0]
        if onde:
            lista = ", ".join(f"{a['name']} ({_brl(a['goal_cents'])})" for a in onde)
            raise Level1Error(f"De qual conta tiro? Na meta *{meta['name']}* há dinheiro separado em: {lista}. "
                              "Nada foi alterado.")
    try:
        mov = await _movimento_da_meta({"user_id": ctx.user_id, "hoje": hoje}, meta, entrada, contas)
    except Recusa as err:
        raise Recusa(err.mensagem_usuario) from err
    prepared["values"] = {}
    prepared["movimento"] = mov
    prepared["nome_real"] = meta["name"]
    prepared["summary"] = mov["frase"]
    return prepared


async def preparar_valor(ctx: ExecContext, values: dict, nome: str | None, prepared: dict) -> dict:
    """"Meu CDB está valendo 10.500" (atualizar valor) × "recebi 85 de rendimento do CDB" (receita real)."""
    if values.keys() - CAMPOS_VALOR:
        raise Level1Error("Me diz uma coisa por vez: o valor atual da posição OU um rendimento recebido. "
                          "Nada foi alterado.")
    if ("valor_atual_cents" in values) == ("rendimento_cents" in values):
        raise Level1Error("É o valor atual da posição (\"está valendo 10.500\") ou um rendimento que você "
                          "recebeu (\"recebi 85 de rendimento\")? Nada foi alterado.")
    if not nome:
        raise Level1Error("Qual investimento? Me fala o nome da conta de investimento. Nada foi alterado.")
    pos = await _achar(ctx.workspace_id, "accounts", nome, "conta de investimento", extra=" and type = 'investment'")
    hoje = local_iso_date(ctx.timezone)
    dia = _data(values.get("data_do_valor"), hoje, "do valor")
    if "valor_atual_cents" in values:
        valor = int(values["valor_atual_cents"])
        entrada = {"op": "valuation", "position_account_id": str(pos["id"]), "value_cents": str(valor), "as_of": dia}
        destino = None
    else:
        valor = int(values["rendimento_cents"])
        if valor <= 0:
            raise Level1Error("O rendimento precisa ser maior que zero. Nada foi alterado.")
        destino = pos
        if values.get("rendimento_na_conta"):
            destino = await _conta(ctx.workspace_id, values["rendimento_na_conta"], "a conta que recebeu")
        entrada = {"op": "income", "position_account_id": str(pos["id"]), "to_account_id": str(destino["id"]),
                   "amount_cents": str(valor), "occurred_on": dia}

    async def corpo(tx):
        antes = await _posicao(tx, pos["id"])
        await _comando(tx, "investment_value_command", entrada, uuid4())
        return antes, await _posicao(tx, pos["id"])

    try:
        antes, depois = await _previa(ctx.user_id, corpo)
    except Recusa as err:
        raise Recusa(err.mensagem_usuario) from err
    quando = f" em {format_date_br(dia)}" if dia != hoje else ""
    valor_atual = f"valor atual {_seta(antes.get('value_cents', 0), depois.get('value_cents', 0))}"
    if destino is None:
        frase = (f"atualizar o valor de *{pos['name']}* para {_brl(valor)}{quando}: só o patrimônio muda, "
                 f"nenhum dinheiro entra nem sai de conta; {valor_atual}; resultado "
                 f"{_resultado(antes)} → {_resultado(depois)}")
        feito = f"📈 Atualizei *{pos['name']}* para {_brl(valor)}{quando}."
    else:
        onde = "na própria posição" if destino["id"] == pos["id"] else f"na conta {destino['name']}"
        frase = (f"registrar um rendimento de {_brl(valor)} de *{pos['name']}*{quando}, recebido {onde}: vira "
                 f"uma receita de verdade (categoria rendimentos) e entra no caixa; {valor_atual}; rendimento "
                 f"recebido {_seta(antes.get('received_cents', 0), depois.get('received_cents', 0))}")
        feito = f"💰 Registrei o rendimento de {_brl(valor)} de *{pos['name']}*{quando}."
    prepared["values"] = {}
    prepared["nome_real"] = pos["name"]
    prepared["movimento"] = {
        "rpc": "investment_value_command", "input": entrada, "alvo_id": str(pos["id"]), "tabela": "accounts",
        "feito": feito, "cauda": "valor da posição", "chave": "position_value_cents", "frase": frase,
    }
    prepared["summary"] = frase
    return prepared


# ----- F14: plano percentual ------------------------------------------------


async def _estado_plano(tx, ws_esperado, mes: str | None = None) -> dict:
    estado = (await tx.fetch_one("select public.budget_plan_state(%s::date) as s", mes))["s"]
    # `budget_plan_state`/`budget_plan_command` valem para o espaço PADRÃO de quem chama: em outro
    # espaço o plano seria o de lá, em silêncio.
    if str(estado["workspace_id"]) != str(ws_esperado):
        raise Recusa("O plano percentual é do seu espaço padrão, e esta conversa é de outro. Use o app. "
                     "Nada foi alterado.")
    return estado


def _linhas_do_plano(estado: dict) -> list[dict]:
    plano = estado.get("plan")
    return list((plano or {}).get("lines") or [])


async def ler_plano(ctx: ExecContext) -> ToolResult:
    """Planejado × realizado do plano atual, no ciclo corrente."""
    async def ler(tx):
        return await _estado_plano(tx, ctx.workspace_id)

    estado = await _previa(ctx.user_id, ler)
    plano = estado.get("plan")
    if not plano:
        return ToolResult("📊 Você ainda não montou um plano percentual do orçamento. Monta no app, em "
                          "Finanças › Orçamento › Plano.", read_only=True)
    linhas = []
    for ln in _linhas_do_plano(estado):
        pct = guards_pct(ln["share_bp"])
        gasto = f", gastou {_brl(ln['spent_cents'])}" if ln.get("spent_cents") is not None else ""
        limite = ln.get("current_default_cents")
        em_uso = f", limite hoje {_brl(limite)}" if limite is not None else ", sem limite hoje"
        categoria = f" ({ln['category']})" if ln.get("category") else ""
        linhas.append(f"  • {ln['group']}{categoria}: {pct}% = {_brl(ln['amount_cents'])}{gasto}{em_uso}")
    solto = int(plano["undistributed_cents"])
    resto = f"\nSem destino: {guards_pct(plano['undistributed_bp'])}% ({_brl(solto)})." if solto else ""
    return ToolResult(
        f"📊 Plano v{plano['version']} sobre a renda-base de {_brl(plano['base_income_cents'])} "
        f"(período {format_date_br(estado['period_start'])} a {format_date_br(estado['period_end'])}):\n"
        + "\n".join(linhas) + resto
        + "\nPara usar como limite, diga \"aplica o plano nos meus orçamentos\".",
        read_only=True,
    )


def guards_pct(bp) -> str:
    """Pontos-base como o app escreve: 1250 -> 12,5 ; 3000 -> 30 (mesma regra de `budget_plan_pct`)."""
    bp = int(bp)
    inteiro, resto = divmod(bp, 100)
    if resto == 0:
        return str(inteiro)
    return f"{inteiro},{resto:02d}".rstrip("0")


async def preparar_aplicacao_do_plano(ctx: ExecContext, values: dict, prepared: dict) -> dict:
    """"Aplica o plano nos orçamentos": o `apply` do app, com o antes → depois que o BANCO devolve."""
    if values.keys() - CAMPOS_PLANO:
        raise Level1Error("Me diz o que aplicar do plano: todas as categorias ou algumas, e se é o limite "
                          "padrão ou só este mês. Nada foi alterado.")
    alcance = (values.get("aplicar_alcance") or "padrao").strip().lower()
    mes_dito = values.get("aplicar_mes")
    if mes_dito:
        mes_dito = _data(mes_dito, "", "do mês")[:8] + "01"
        alcance = "mes"
    if alcance not in {"padrao", "mes"}:
        raise Level1Error("Aplico como limite padrão ou só neste mês? Nada foi alterado.")
    pedidas = [c.strip() for c in (values.get("aplicar_categorias") or "").split(",") if c.strip()]
    if len(pedidas) == 1 and pedidas[0].lower() in {"todas", "todos", "tudo", "todas as categorias"}:
        pedidas = []

    async def corpo(tx):
        estado = await _estado_plano(tx, ctx.workspace_id, mes_dito)
        plano = estado.get("plan")
        if not plano:
            raise Recusa("Você ainda não montou um plano percentual. Monta no app, em Finanças › Orçamento › "
                         "Plano. Nada foi alterado.")
        categorias = pedidas or [ln["category"] for ln in plano["lines"] if ln.get("category")]
        if not categorias:
            raise Recusa("O plano não tem categoria ligada a nenhuma linha: não há limite para aplicar. "
                         "Ajuste o plano no app. Nada foi alterado.")
        mes = estado["month"] if alcance == "mes" else None
        entrada = {"op": "apply", "version": plano["version"], "categories": categorias, "scope": "default" if alcance == "padrao" else "month",
                   "month": mes}
        return estado, entrada, await _comando(tx, "budget_plan_command", entrada, uuid4())

    estado, entrada, r = await _previa(ctx.user_id, corpo)
    plano = estado["plan"]
    por_categoria = {ln["category"].casefold(): ln for ln in plano["lines"] if ln.get("category")}
    linhas = []
    for item in r["applied"]:
        antes = item["before_cents"]
        if antes is None and alcance == "mes":
            ln = por_categoria.get(item["category"].casefold(), {})
            antes = ln.get("current_default_cents")  # em "só o mês" o antes é o padrão que vale
        de = "sem limite" if antes is None else _brl(antes)
        linhas.append(f"{item['category']} {de} → {_brl(item['applied_cents'])}")
    onde = "como limite padrão" if alcance == "padrao" else f"só em {format_date_br(estado['month'])[3:]}"
    corpo_txt = "; ".join(linhas[:12]) + (f" e mais {len(linhas) - 12}" if len(linhas) > 12 else "")
    frase = (f"aplicar o plano v{plano['version']} (renda-base {_brl(plano['base_income_cents'])}) aos limites do "
             f"orçamento, {onde}: {corpo_txt}. O acumular sobra de cada limite fica como está")
    prepared["values"] = {}
    prepared["movimento"] = {
        "rpc": "budget_plan_command", "input": entrada, "frase": frase,
        "feito": f"✅ Apliquei o plano v{plano['version']} aos limites {onde}: {corpo_txt}.",
    }
    prepared["summary"] = frase
    return prepared
