"""Forma de pagamento, classificação e detalhe ao CRIAR um lançamento pela conversa (lote C).

O parse principal (`FinanceAction`) propõe os quatro campos; aqui eles são VALIDADOS e CONGELADOS em
`alvos[i]["atributos"]` — a frase do SIM lê dali e a tool grava dali. Roda em `resolve_node` (depois
de a conta estar resolvida). Não há chamada ao modelo: era uma segunda leitura enquanto o schema
não cabia mais campo (teto antigo de 252, medido com outro método de envio).

Três regras que não mudam:
- falha do banco = lança SEM os atributos (nunca bloqueia o lançamento);
- o que o modelo propõe só vale se a frase sustenta (`domain/atributos`: ancoragem) — null nunca vira Pix;
- detalhe que não casa, ou casa com dois, PERGUNTA com a lista; detalhe novo nunca é criado.
"""

from __future__ import annotations

import logging

from app import db
from app.domain import atributos as dom
from app.domain import matching
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import guards

log = logging.getLogger(__name__)

CRIAM = {
    FinanceActionType.CREATE_EXPENSE,
    FinanceActionType.CREATE_INCOME,
    FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
}

async def detalhes_da_categoria(workspace_id, parent: str) -> list[dict]:
    return await db.fetch(
        "select id, name from public.subcategories where workspace_id = %s "
        "and parent_key = private.fold(%s) order by name",
        workspace_id, parent,
    )


async def detalhes_do_espaco(workspace_id) -> list[dict]:
    """Os detalhes (subcategorias) do espaço, por categoria-pai, para o prompt do parse.

    Era a segunda leitura que via esta lista; com os atributos no parse principal, sem ela "gastei
    45 na feira" só acertava o detalhe "feira" se o modelo adivinhasse o nome.
    """
    return await db.fetch(
        "select parent_key, name from public.subcategories where workspace_id = %s "
        "order by parent_key, name limit %s",
        workspace_id, TETO_DE_DETALHES_NO_PROMPT,
    )


# Teto da lista no prompt: o espaço com mais detalhes do staging tem bem menos; acima disso a
# lista custa token em toda mensagem de gasto e o casamento no código (`escolher_detalhe`) segue.
TETO_DE_DETALHES_NO_PROMPT = 80


async def escolher_detalhe(workspace_id, parent: str, dito: str) -> tuple[dict | None, str | None]:
    """O detalhe pelo NOME dentro da categoria-pai: igual primeiro, depois "contém".

    (linha, None) quando acha UM; (None, pergunta) quando não casa ou casa com dois — a escolha
    silenciosa não existe. Caminho único de `resource_update` (lote A) e da criação (lote C).
    """
    filhas = await detalhes_da_categoria(workspace_id, parent)
    chave = matching.normalize(dito)
    achadas = [f for f in filhas if matching.normalize(f["name"]) == chave] or [
        f for f in filhas if chave in matching.normalize(f["name"])
    ]
    if len(achadas) == 1:
        return achadas[0], None
    nomes = ", ".join(f["name"] for f in (achadas or filhas)[:8])
    if achadas:
        return None, f"*{dito}* casa com mais de um detalhe de {parent}: {nomes}. Qual deles?"
    if filhas:
        return None, f"Não achei o detalhe *{dito}* em {parent}. Tenho: {nomes}. Qual é?"
    return None, f"A categoria {parent} ainda não tem detalhes cadastrados; crie no app."


def _tipo_da_conta(acao: FinanceAction, alvo: dict, contas: dict[str, str]) -> str | None:
    if acao.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE:
        return "credit_card"  # a compra parcelada só existe em cartão (`conta_citada(only_cards)`)
    if matching.sem_conta_explicita(acao.account):
        return None
    if acao.account:
        return (alvo.get("cited_account") or {}).get("type")
    return contas.get(str((alvo.get("default_account") or {}).get("id")))


def normalize_igual(dito: str, *outros: str | None) -> bool:
    return any(o and matching.normalize(o) == matching.normalize(dito) for o in outros)


async def padroes_da_categoria(workspace_id, categoria: str | None) -> dict | None:
    """O padrão fixo/variável e essencial da categoria (`public.categories`); None se não há."""
    if not categoria:
        return None
    try:
        return await db.fetch_one(
            "select default_expense_pattern, default_expense_necessity from public.categories "
            "where workspace_id = %s and private.fold(name) = private.fold(%s) limit 1",
            workspace_id, categoria)
    except Exception as err:  # noqa: BLE001 — o padrão é conveniência, não trava o lançamento
        log.warning("padrão da categoria ignorado: %s", err)
        return None


PERGUNTA_CARTAO = ("🤔 Para pagar no crédito (ou Pix no crédito) eu preciso do cartão. Qual cartão? "
                   "Ainda não registrei nada.")


async def _congelar(workspace_id, texto, acoes, alvos, indices) -> list[dict]:
    """O miolo de `congelar`; qualquer exceção sobe e vira "sem atributos" lá fora."""
    contas = {str(c["id"]): c["type"] for c in await db.accounts(workspace_id)}

    for i in indices:
        a = acoes[i]
        despesa = a.type != FinanceActionType.CREATE_INCOME
        forma = dom.forma_proposta(a.payment_method, texto)
        padrao = dom.padrao_proposto(a.expense_pattern, texto) if despesa else None
        necessidade = dom.necessidade_proposta(a.expense_necessity, texto) if despesa else None
        dito = dom.detalhe_ancorado(a.detalhe, texto)
        notas: list[str] = []
        categoria = guards.clean_category(a.category)

        if dito and (normalize_igual(dito, a.category)
                     or (normalize_igual(dito, a.description) and not dom.detalhe_marcado(dito, texto))):
            if dom.detalhe_marcado(dito, texto):  # só avisa quem ESCREVEU "detalhe X"; palpite do modelo é silencioso
                notas.append(f"detalhe *{dito}* ignorado (é o nome da categoria ou do lançamento)")
            dito = None

        erro = None
        tipo_conta = _tipo_da_conta(a, alvos[i], contas)
        problema = dom.erro_da_forma(forma, tipo_conta)
        if forma == "credit" and problema or (
                forma == "pix" and dom.pix_no_credito(texto) and tipo_conta != "credit_card"):
            erro = PERGUNTA_CARTAO
        elif problema:
            notas.append(f"sem forma ({dom.FRASE_DA_FORMA[forma]} não combina com a conta)")
            forma = None

        # O parse não vê os detalhes existentes: sem "detalhe X"/"subcategoria X" escrito, só vale o
        # nome EXATO de um detalhe da categoria — palpite que não casa some, nunca vira pergunta.
        if dito and categoria and not dom.detalhe_marcado(dito, texto) and not any(
                normalize_igual(dito, f["name"]) for f in await detalhes_da_categoria(workspace_id, categoria)):
            dito = None

        detalhe_id = detalhe_nome = parent = None
        if dito and categoria and erro is None:
            achada, pergunta = await escolher_detalhe(workspace_id, categoria, dito)
            if pergunta:
                erro = (f"🤔 {pergunta} Me manda de novo o lançamento com o nome exato do detalhe. "
                        "Ainda não registrei nada.")
            else:
                detalhe_id, detalhe_nome, parent = str(achada["id"]), achada["name"], categoria
        elif dito:
            notas.append(f"detalhe *{dito}* ignorado (falta a categoria)")

        if erro:
            alvos[i] = {**alvos[i], "correction_error": erro}
            if erro == PERGUNTA_CARTAO:  # a pergunta precisa de RESPOSTA: rascunho de slot, só cartões
                alvos[i].update(account_error=erro, so_cartoes=True)
            continue

        da_categoria = []
        if despesa and categoria:
            padroes = await padroes_da_categoria(workspace_id, categoria) or {}
            if not padrao and padroes.get("default_expense_pattern"):
                da_categoria.append(f"{dom.ROTULO_PADRAO[padroes['default_expense_pattern']]} (padrão de {categoria})")
            if not necessidade and padroes.get("default_expense_necessity"):
                da_categoria.append(
                    f"{dom.ROTULO_NECESSIDADE[padroes['default_expense_necessity']]} (padrão de {categoria})")
        frase = dom.frase_dos_atributos(forma, padrao, necessidade, detalhe_nome, "; ".join(notas) or None,
                                        da_categoria)
        if frase or detalhe_id:
            alvos[i] = {**alvos[i], "atributos": {
                "payment_method": forma, "expense_pattern": padrao, "expense_necessity": necessidade,
                "subcategory_id": detalhe_id, "subcategory_name": detalhe_nome, "subcategory_parent": parent,
                "frase": frase,
            }}
    return alvos


async def congelar(workspace_id, texto: str, acoes: list, alvos: list[dict],
                   pular: set[int] | None = None) -> list[dict]:
    """Congela os atributos de cada criação em `alvos[i]["atributos"]`.

    Só olha a criação em que o parse propôs algo; sem proposta nem toca o banco. Qualquer falha
    (banco) lança SEM atributos: o lançamento nunca depende desta validação.
    """
    alvos = [*alvos] + [{}] * max(0, len(acoes) - len(alvos))
    indices = [i for i, a in enumerate(acoes)
               if isinstance(a, FinanceAction) and a.type in CRIAM
               and any((a.payment_method, a.expense_pattern, a.expense_necessity, a.detalhe))
               and i not in (pular or set()) and not alvos[i].get("correction_error")]
    if not indices:
        return alvos
    original = [dict(a) for a in alvos]
    try:
        return await _congelar(workspace_id, texto, acoes, alvos, indices)
    except Exception as err:  # noqa: BLE001
        log.warning("atributos do lançamento ignorados: %s", err)
        return original


async def colunas(workspace_id, kind: str, categoria: str | None, attrs: dict | None) -> dict:
    """As colunas de forma e classificação do INSERT, como o app grava.

    O padrão da categoria é lido AQUI, com a categoria FINAL (a regra do usuário pode tê-la trocado
    depois do parse). O app aplica o padrão no formulário (`resolveExpenseClassification`); o banco
    só herda de série, compra e dívida — não de lançamento avulso.
    """
    attrs = attrs or {}
    saida: dict = {}
    if attrs.get("payment_method"):
        saida["payment_method"] = attrs["payment_method"]
    if kind != "expense":
        return saida
    saida.update(dom.colunas_de_classificacao(kind, attrs, await padroes_da_categoria(workspace_id, categoria)))
    return saida


def detalhe_valido(attrs: dict | None, categoria: str | None) -> str | None:
    """O detalhe dito, se a categoria FINAL ainda é a do pai (a regra do usuário pode ter trocado)."""
    attrs = attrs or {}
    pai = attrs.get("subcategory_parent")
    if attrs.get("subcategory_id") and pai and categoria and matching.normalize(pai) == matching.normalize(categoria):
        return attrs["subcategory_id"]
    return None


def aviso_do_detalhe(attrs: dict | None, categoria: str | None) -> str:
    """Quando a regra do usuário trocou a categoria e o detalhe dito caiu: a resposta diz."""
    attrs = attrs or {}
    if attrs.get("subcategory_id") and detalhe_valido(attrs, categoria) is None:
        return (f"\nO detalhe *{attrs.get('subcategory_name') or 'dito'}* não foi gravado: "
                f"a categoria virou *{categoria or 'sem categoria'}*.")
    return ""
