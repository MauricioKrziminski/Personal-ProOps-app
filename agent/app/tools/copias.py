"""Lote D, F22: lançar um FAVORITO (`transaction_templates`) e DUPLICAR um lançamento.

Reverte a decisão de 05/10/2026 de deixar isso "fora do escopo" (pedido do dono do produto, "Sim,
todos"). As duas portas desembocam no mesmo executor, com as mesmas réguas do app:

- `decode_modelo` espelha `decodeModelo` (src/lib/favoritos.ts): chave desconhecida é ignorada e valor
  inválido zera o campo — nunca lança, porque a linha pode ser de uma versão futura;
- `campos_da_copia` espelha `paramsDaCopia` (src/lib/duplicar.ts): só `COLUNAS_COPIADAS` viajam. Id,
  fatura, plano, série, dívida, `pays_invoice_id`, `rollover_of_invoice_id`, juro do Pix, entrada,
  `status`/`paid_at`/`auto_confirm`, `due_at`, anexo, `source` e chave de requisição NUNCA são copiados;
  parcela vira lançamento à vista no valor dela e sem o "(n/N)"; pagamento de fatura, de dívida e juro do
  Pix não se duplicam (`podeDuplicar`).

Sempre com SIM e sempre com a data de HOJE (cada cópia é uma intenção nova). A conta que o favorito
guarda e não existe mais (ou foi arquivada) NÃO é substituída em silêncio: vira pergunta. A prévia é o
próprio INSERT rodado numa transação que se desfaz — gatilhos e CHECKs do banco (forma de pagamento ×
conta, classificação, detalhe) recusam ANTES do SIM, não depois.
"""

from __future__ import annotations

import re
from datetime import date

from app import db
from app.domain import matching
from app.domain.atributos import frase_dos_atributos
from app.domain.dates import format_date_br, local_iso_date
from app.domain.money import cents_to_brl
from app.tools.base import ExecContext, ToolResult
from app.tools import guards
from app.tools.guards import Level1Error
from app.tools.movimentos import _previa

# espelho de COLUNAS_COPIADAS (src/lib/duplicar.ts); `tests/test_copias.py` compara com o arquivo
COLUNAS_COPIADAS = (
    "kind", "description", "merchant", "amount_cents", "category", "subcategory_id",
    "account_id", "counterparty_account_id", "payment_method",
    "expense_pattern", "expense_pattern_source", "expense_necessity", "expense_necessity_source",
)
KINDS = ("expense", "income", "transfer")
FORMAS = {"pix": "Pix", "credit": "Crédito", "debit": "Débito", "cash": "Dinheiro",
          "bank_transfer": "Transferência", "boleto": "Boleto"}
PADROES = ("fixed", "variable")
NECESSIDADES = ("essential", "discretionary")
FONTES = ("explicit", "category_default")
ROTULO_KIND = {"expense": "gasto", "income": "receita", "transfer": "transferência"}
SUFIXO_DE_PARCELA = re.compile(r"\s*\(\d+/\d+\)\s*$")
CHAVES_DE_CLASSE = ("expense_pattern", "expense_pattern_source", "expense_necessity", "expense_necessity_source")
MAX_SEGURO = 9007199254740991


class PerguntaDeCartao(Level1Error):
    """Crédito sem cartão: a pergunta do lote C (`atributos.PERGUNTA_CARTAO`), que fica pendente como
    cadastro incompleto — a resposta ("o Nubank Cartão") completa o pedido."""


def _texto(raw: dict, k: str, maximo: int):
    v = raw.get(k)
    return v if isinstance(v, str) and v.strip() and len(v) <= maximo else None


def _classe_valida(raw: dict) -> dict:
    """`expenseClassificationFromRecord` + o `catch` do `decodeModelo`: inválida zera as quatro."""
    vazio = dict.fromkeys(CHAVES_DE_CLASSE)
    c = {k: raw.get(k) for k in CHAVES_DE_CLASSE}
    ok = (c["expense_pattern"] in (None, *PADROES) and c["expense_necessity"] in (None, *NECESSIDADES)
          and c["expense_pattern_source"] in (None, *FONTES) and c["expense_necessity_source"] in (None, *FONTES))
    if not ok:
        return vazio
    for valor, fonte in (("expense_pattern", "expense_pattern_source"), ("expense_necessity", "expense_necessity_source")):
        if (c[valor] is not None and c[fonte] is None) or (c[valor] is None and c[fonte] == "category_default"):
            return vazio
    return c


def _valor_positivo(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return v if isinstance(v, int) and 0 < v <= MAX_SEGURO else None


def decode_modelo(raw) -> dict:
    """`decodeModelo`: nunca lança; devolve SEMPRE as 13 colunas copiáveis (null onde não vale)."""
    r = raw if isinstance(raw, dict) else {}
    out = {
        "kind": r.get("kind") if r.get("kind") in KINDS else "expense",
        "description": _texto(r, "description", 200),
        "merchant": _texto(r, "merchant", 200),
        "amount_cents": _valor_positivo(r.get("amount_cents")),
        "category": _texto(r, "category", 80),
        "subcategory_id": _texto(r, "subcategory_id", 80),
        "account_id": _texto(r, "account_id", 80),
        "counterparty_account_id": _texto(r, "counterparty_account_id", 80),
        "payment_method": r.get("payment_method") if r.get("payment_method") in FORMAS else None,
        **_classe_valida(r),
    }
    return {c: out.get(c) for c in COLUNAS_COPIADAS}


def campos_da_copia(tx: dict) -> tuple[dict, str | None]:
    """`paramsDaCopia`: a linha vira os dados da pessoa. Devolve também a nota da parcela."""
    eh_parcela = bool(tx.get("installment_plan_id"))
    titulo = tx.get("description") if isinstance(tx.get("description"), str) else ""
    if eh_parcela:
        titulo = SUFIXO_DE_PARCELA.sub("", titulo)
    src = {k: tx.get(k) for k in COLUNAS_COPIADAS}
    for k in ("account_id", "counterparty_account_id", "subcategory_id"):
        if src[k] is not None:
            src[k] = str(src[k])  # uuid -> texto, como o app lê
    src["description"] = titulo or None
    nota = f"Cópia da parcela {tx.get('installment_no') or '?'} — vira um lançamento à vista" if eh_parcela else None
    return decode_modelo(src), nota


def pode_duplicar(tx: dict) -> bool:
    """`podeDuplicar`: pagamento de dívida, de fatura e juros do Pix não duplicam."""
    return not (tx.get("debt_id") or tx.get("pays_invoice_id") or tx.get("pix_fee_for_transaction_id"))


# ---------------------------------------------------------------------------
# o executor comum: validar contra o espaço, provar no banco (INSERT desfeito), frasear
# ---------------------------------------------------------------------------


def _insert(ws, user_id, c: dict, hoje: str, template_id: str | None = None):
    colunas = ["user_id", "workspace_id", "kind", "amount_cents", "currency", "description", "merchant", "category",
               "account_id", "counterparty_account_id", "payment_method", "occurred_at", "source"]
    valores = [user_id, ws, c["kind"], c["amount_cents"], "BRL", c["description"], c["merchant"], c["category"],
               c["account_id"], c["counterparty_account_id"], c["payment_method"], hoje, "whatsapp"]
    if c.get("subcategory_id"):
        colunas += ["subcategory_id", "subcategory_snapshot_set"]
        valores += [c["subcategory_id"], True]
    if c["kind"] == "expense" and any(c.get(k) for k in CHAVES_DE_CLASSE):
        colunas += list(CHAVES_DE_CLASSE)
        valores += [c.get(k) for k in CHAVES_DE_CLASSE]
    # a conta tem que continuar viva no instante da escrita (entre a pergunta e o SIM ela pode ser arquivada)
    guardas, args = "", []
    for k in ("account_id", "counterparty_account_id"):
        if c.get(k):
            guardas += (" and exists (select 1 from public.accounts a where a.id = %s and a.workspace_id = %s "
                        "and not a.archived)")
            args += [c[k], ws]
    insere = (f"insert into public.transactions ({', '.join(colunas)}) select {', '.join(['%s'] * len(colunas))} "
              f"where true{guardas} returning id")
    if template_id is None:
        return insere, [*valores, *args]
    # lançar E contar o uso do favorito num statement só: ou os dois acontecem ou nenhum
    sql = (f"with novo as ({insere}), uso as (update public.transaction_templates set use_count = use_count + 1, "
           "last_used_at = now() where id = %s and workspace_id = %s and exists (select 1 from novo) returning id) "
           "select id from novo")
    return sql, [*valores, *args, template_id, ws]


async def _contas(ws) -> dict[str, dict]:
    return {str(a["id"]): a for a in await db.accounts(ws)}


def _pergunta_do_cartao(contas: dict) -> PerguntaDeCartao:
    from app.tools.atributos import PERGUNTA_CARTAO

    cartoes = [a["name"] for a in contas.values() if a["type"] == "credit_card"]
    tenho = f" Tenho: {', '.join(cartoes[:8])}." if cartoes else " Você ainda não tem cartão cadastrado."
    return PerguntaDeCartao(PERGUNTA_CARTAO + tenho + ' Diga o nome (ex.: "... no cartão Nubank").')


async def validar_e_frasear(ctx: ExecContext, c: dict, *, origem: str, nota: str | None,
                            conta_dita: str | None = None, categoria_dita: str | None = None,
                            valor_dito: int | None = None) -> dict:
    """Aplica o que a pessoa disse por cima da cópia, confere cada referência neste espaço e devolve o
    `copia` que viaja no alvo (campos + hoje + frase). Dúvida vira pergunta, nunca palpite."""
    from app.tools import finance

    c = dict(c)
    ws, hoje = ctx.workspace_id, local_iso_date(ctx.timezone)
    avisos = []
    contas = await _contas(ws)
    credito = c.get("payment_method") == "credit"
    if conta_dita:
        # crédito só tem cartão como resposta: a mesma régua (e o mesmo casador) do lote C
        achada = await finance.conta_citada(ws, conta_dita, only_cards=credito)
        if not achada:
            raise Level1Error(f"🤔 Não achei a conta *{conta_dita}*. Nada foi lançado.")
        c["account_id"] = str(achada)
    if categoria_dita:
        nova = guards.clean_category(categoria_dita)
        if nova != (c.get("category") or ""):
            c["subcategory_id"] = None  # o detalhe é filho da categoria antiga
        c["category"] = nova
    if valor_dito:
        c["amount_cents"] = valor_dito
    if not c.get("amount_cents"):
        raise Level1Error(f"💬 O original {origem} não guarda o valor. Quanto foi? Diga assim: \"lança o favorito "
                          "Almoço de 40\". Nada foi lançado.")
    if c["kind"] != "transfer":
        c["counterparty_account_id"] = None
    if c["kind"] != "expense":
        c.update(dict.fromkeys(CHAVES_DE_CLASSE))
    if credito and (contas.get(c.get("account_id") or "") or {}).get("type") != "credit_card":
        raise _pergunta_do_cartao(contas)
    if not c.get("account_id") and c["kind"] != "transfer":
        padrao = await finance.default_account(ws)
        if padrao and str(padrao) in contas:
            c["account_id"] = str(padrao)
            avisos.append(PADRAO)
    for campo, papel in (("account_id", "a conta"), ("counterparty_account_id", "a conta de destino")):
        if campo == "counterparty_account_id" and c["kind"] != "transfer":
            continue
        ref = c.get(campo)
        if ref and ref not in contas:
            lista = ", ".join(a["name"] for a in list(contas.values())[:8])
            raise Level1Error(f"🤔 {papel.capitalize()} {origem} não existe mais ou foi arquivada. Em qual conta eu "
                              f"lanço? Tenho: {lista or 'nenhuma conta'}. Diga o nome (ex.: \"... na conta Nubank\"). "
                              "Nada foi lançado.")
        if not ref and c["kind"] == "transfer":
            raise Level1Error(f"🤔 Para a transferência eu preciso das duas contas, e {papel} de {origem} está "
                              "vazia. Qual é? Nada foi lançado.")
    if c["kind"] == "transfer" and c["account_id"] == c["counterparty_account_id"]:
        raise Level1Error("❌ Origem e destino são a mesma conta. Nada foi lançado.")
    detalhe_nome = None
    if c.get("subcategory_id"):
        achado = c.get("category") and await db.fetch(
            "select id, name from public.subcategories where id = %s and workspace_id = %s "
            "and parent_key = private.fold(%s)", c["subcategory_id"], ws, c["category"])
        if not achado:
            c["subcategory_id"] = None
            avisos.append("sem detalhe da categoria (o do original não existe mais)")
        else:
            detalhe_nome = achado[0].get("name") or "do original"
    sql, args = _insert(ws, ctx.user_id, c, hoje)

    async def prova(tx):
        row = await tx.fetch_one(sql, *args)
        if row is None:
            raise Level1Error("🤔 A conta mudou enquanto eu conferia. Me peça de novo. Nada foi lançado.")
        # os gatilhos de forma de pagamento e de detalhe são DIFERIDOS (rodam no commit, que aqui não
        # existe): sem isto a prova passava com Pix em cartão e a recusa só viria depois do SIM
        await tx.execute("set constraints public.payment_method_compatibility, public.owned_fee_graph, "
                         "public.transactions_subcategory_scope_fkey immediate")
        return row

    await _previa(ctx.user_id, prova)  # o INSERT real, numa transação que volta: CHECK e gatilho recusam aqui
    nomes = {k: contas[c[k]]["name"] for k in ("account_id", "counterparty_account_id") if c.get(k) in contas}
    return {"campos": c, "hoje": hoje, "workspace_id": str(ws), "nomes": nomes,
            "frase": _frase(c, nomes, hoje, origem, nota, avisos, detalhe_nome)}


PADRAO = "conta padrão"


def _frase(c: dict, nomes: dict, hoje: str, origem: str, nota: str | None, avisos: list[str],
           detalhe: str | None) -> str:
    texto = f"{ROTULO_KIND[c['kind']]} de {cents_to_brl(c['amount_cents'])}"
    if c.get("description"):
        texto += f" — *{c['description']}*"
    if c.get("merchant"):
        texto += f" (estabelecimento {c['merchant']})"
    padrao_conta = PADRAO in avisos
    avisos = [a for a in avisos if a != PADRAO]
    if c["kind"] == "transfer":
        texto += f", da conta {nomes.get('account_id', '?')} para a conta {nomes.get('counterparty_account_id', '?')}"
    else:
        if c.get("category"):
            texto += f", categoria {c['category']}"
        if "account_id" in nomes:
            texto += f", na conta {nomes['account_id']}" + (" (a conta padrão)" if padrao_conta else "")
        else:
            texto += ", sem conta"
    atributos_ = frase_dos_atributos(c.get("payment_method"), c.get("expense_pattern"), c.get("expense_necessity"),
                                     detalhe)
    if atributos_:
        texto += f", {atributos_}"
    extras = "; ".join([*([nota] if nota else []), *avisos])
    return f"lançar, hoje ({format_date_br(hoje)}), a partir {origem}: {texto}" + (f" [{extras}]" if extras else "")


async def executar_copia(ctx: ExecContext, copia: dict) -> ToolResult:
    c, hoje = copia["campos"], copia["hoje"]
    if str(copia.get("workspace_id")) != str(ctx.workspace_id):
        # o espaço da conversa mudou entre a pergunta e o SIM: a cópia foi conferida em outro
        raise Level1Error("O espaço mudou depois da pergunta. Me peça de novo para eu conferir. Nada foi lançado.")
    sql, args = _insert(ctx.workspace_id, ctx.user_id, c, hoje, copia.get("template_id"))
    row = await db.fetch_one(sql, *args)
    if row is None:
        raise Level1Error("Uma das contas mudou depois da pergunta. Me peça de novo para eu conferir. Nada foi lançado.")
    nome = (copia.get("nomes") or {}).get("account_id")
    return ToolResult(
        f"{'💸' if c['kind'] == 'expense' else '💰' if c['kind'] == 'income' else '🔄'} Lancei "
        f"{ROTULO_KIND[c['kind']]} de *{cents_to_brl(c['amount_cents'])}*"
        + (f" ({c['description']})" if c.get("description") else "")
        + (f" na conta {nome}" if nome else "") + f" em {format_date_br(hoje)}.",
        result_id=row["id"])


# ---------------------------------------------------------------------------
# favoritos
# ---------------------------------------------------------------------------

LISTAR_ATE = 50


async def _modelos(ws, nome: str | None = None) -> list[dict]:
    """Os favoritos do espaço. Com `nome`, a busca é no SQL (sem acento e sem caixa; o igual vem primeiro),
    para um favorito além dos mais usados não sumir num corte silencioso."""
    if nome:
        return await db.fetch(
            "select id, name, fields, use_count from public.transaction_templates "
            "where workspace_id = %s and not archived "
            "and extensions.unaccent(lower(name)) like extensions.unaccent(lower(%s)) "
            "order by (extensions.unaccent(lower(name)) = extensions.unaccent(lower(%s))) desc, use_count desc, name "
            "limit 9", ws, f"%{nome.strip()}%", nome.strip())
    return await db.fetch(
        "select id, name, fields, use_count from public.transaction_templates "
        "where workspace_id = %s and not archived order by use_count desc, name limit %s", ws, LISTAR_ATE + 1)


async def listar_favoritos(ctx: ExecContext) -> ToolResult:
    modelos = await _modelos(ctx.workspace_id)
    if not modelos:
        return ToolResult("⭐ Você ainda não tem favoritos. Salvar um favorito é no app (no lançamento, "
                          "\"Salvar como favorito\").", read_only=True)
    linhas = []
    for m in modelos[:LISTAR_ATE]:
        d = decode_modelo(m["fields"])
        valor = f" — {cents_to_brl(d['amount_cents'])}" if d["amount_cents"] else ""
        linhas.append(f"  • {m['name']}{valor}")
    resto = (f"\nMostrei os {LISTAR_ATE} mais usados; para lançar outro, diga o nome dele."
             if len(modelos) > LISTAR_ATE else "")
    return ToolResult("⭐ Seus favoritos:\n" + "\n".join(linhas) + resto
                      + "\nPara lançar um, diga \"lança meu favorito\" e o nome dele.", read_only=True)


async def preparar_favorito(ctx: ExecContext, nome: str | None, values: dict, prepared: dict) -> dict:
    if not (values.get("lancar") in (True, "true")):
        raise Level1Error("Posso LANÇAR um favorito (\"lança meu favorito Almoço\"); salvar, renomear e apagar "
                          "favorito é no app. Nada foi alterado.")
    if not nome:
        raise Level1Error("Qual favorito lanço? Me diz o nome dele. Nada foi lançado.")
    achados = await _modelos(ctx.workspace_id, nome)
    chave = matching.normalize(nome)
    achados = [m for m in achados if matching.normalize(m["name"]) == chave] or achados
    if not achados:
        tenho = ", ".join(m["name"] for m in (await _modelos(ctx.workspace_id))[:8])
        raise Level1Error(f"Não achei o favorito *{nome}*." + (f" Tenho: {tenho}." if tenho else
                          " Você ainda não tem favoritos (salvar um é no app).") + " Qual é? Nada foi lançado.")
    if len(achados) > 1:
        raise Level1Error(f"*{nome}* casa com mais de um favorito: {', '.join(m['name'] for m in achados[:8])}. "
                          "Qual deles? Nada foi lançado.")
    modelo = achados[0]
    campos = decode_modelo(modelo["fields"])
    copia = await validar_e_frasear(
        ctx, campos, origem=f"do favorito *{modelo['name']}*", nota=None,
        conta_dita=values.get("conta"), categoria_dita=values.get("categoria"),
        valor_dito=values.get("amount_cents"))
    copia["template_id"] = str(modelo["id"])
    prepared["copia"] = copia
    prepared["values"] = {}
    prepared["summary"] = copia["frase"]
    return prepared


# ---------------------------------------------------------------------------
# duplicar
# ---------------------------------------------------------------------------


async def preparar_duplicar(ctx: ExecContext, termo: str | None, values: dict, prepared: dict) -> dict:
    from app.graph.schemas import FinanceAction
    from app.tools import resolve

    dia = values.get("data_do_original")
    if dia:
        try:
            dia = date.fromisoformat(str(dia)[:10]).isoformat()
        except ValueError:
            raise Level1Error("Me diz a data do lançamento que repito (ex.: ontem, 20/09). Nada foi lançado.") from None
    busca = FinanceAction(type="delete_transaction", description=termo, occurred_at=dia)
    quer_recente = not termo and not dia
    status, cands = await resolve.por_transacao(ctx.workspace_id, busca, quer_recente)
    onde = " ".join(p for p in (f"*{termo}*" if termo else "", f"em {format_date_br(dia)}" if dia else "") if p)
    if status == "none":
        raise Level1Error(f"Não achei nenhum lançamento{(' com ' + onde) if onde else ''} para repetir. Confere o nome, "
                          "ou me diz o valor ou a data? Nada foi lançado.")
    if status == "ambiguous":
        lista = "; ".join(f"{c['label']} em {c['when']}" if c.get("when") else c["label"] for c in cands[:6])
        raise Level1Error(f"Achei mais de um lançamento{(' com ' + onde) if onde else ''}: {lista}. Qual repito? "
                          "Me diz a data ou o valor. Nada foi lançado.")
    tx = await db.fetch_one("select * from public.transactions where id = %s and workspace_id = %s",
                            cands[0]["id"], ctx.workspace_id)
    if tx is None:
        raise Level1Error("Esse lançamento mudou enquanto eu procurava. Me peça de novo. Nada foi lançado.")
    if not pode_duplicar(tx):
        o_que = ("o pagamento de uma dívida" if tx.get("debt_id") else
                 "o pagamento de uma fatura" if tx.get("pays_invoice_id") else "o juro do Pix de uma compra")
        raise Level1Error(f"Não repito {o_que}: a cópia viraria um gasto solto, sem o vínculo dele. "
                          "Para pagar de novo, use o pagamento da dívida ou da fatura. Nada foi lançado.")
    campos, nota = campos_da_copia(tx)
    origem = f"do lançamento de {format_date_br(str(tx['occurred_at']))}"
    copia = await validar_e_frasear(ctx, campos, origem=origem, nota=nota, conta_dita=values.get("conta"),
                                    categoria_dita=values.get("categoria"), valor_dito=values.get("amount_cents"))
    prepared["copia"] = copia
    prepared["values"] = {}
    prepared["summary"] = copia["frase"]
    return prepared
