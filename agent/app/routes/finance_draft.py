"""Rascunho de lançamento a partir de uma fala — SÓ interpretação (F16).

O app transcreve (`/internal/chat/transcriptions`), a pessoa corrige o texto, e esta rota devolve
os parâmetros que `/finance/lancar` lê. Nada aqui executa ferramenta, grava `pending_actions` /
`executed_actions` nem manda mensagem: quem salva é o formulário, pelo caminho normal.

Conta e cartão só vêm preenchidos quando o nome casa com UM registro do espaço
(`finance.resolve_account` devolve None em empate); senão fica vazio e vira pergunta. Nunca um id
por adivinhação.
"""

from __future__ import annotations

import logging
import re
from calendar import monthrange
from datetime import date
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from pydantic import Field

from app import conversation, db
from app.auth import current_user
from app.domain import atributos as dom_atributos
from app.domain import matching
from app.domain.dates import format_date_br
from app.domain.money import cents_to_brl
from app.graph import nodes
from app.services import gemini
from app.routes.chat import MAX_CONTENT, Corpo
from app.routes.chat import _erro_audio as _erro
from app.tools import finance
from app.tools.atributos import forma_da_fala

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/finance", tags=["finance"])

_CRIA = {"create_expense", "create_income", "create_installment_purchase", "mark_paid"}
# Forma de pagamento (F01): só a que a pessoa DISSE; é metadado, nunca decide receita/despesa.
# Vem da MESMA segunda leitura do WhatsApp (`tools.atributos.forma_da_fala`, com o veto de
# ancoragem) — não há regex própria aqui. "Pix no crédito" é o Pix pago no cartão (o formulário
# pede os juros do Pix).
# "3x de 100", "3 vezes de 100", "300 em 3x", "300 reais em 3 vezes": a unidade está DITA.
_UNIDADE_DITA = re.compile(
    r"\d\s*(?:x|vezes|parcelas)\s*de\s|\d[\d.,]*\s*(?:reais\s*)?(?:em|parcelad\w*\s+em)\s*\d+\s*(?:x|vezes)"
    r"|\bcada\b|\btotal\b",
    re.IGNORECASE,
)
FUSO_PADRAO = "America/Sao_Paulo"


def _fuso_valido(nome: str) -> str:
    """O nome canônico do fuso, ou o padrão: o texto do corpo não vai ao prompt sem ser fuso."""
    try:
        return ZoneInfo(nome.strip()).key
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return FUSO_PADRAO


def _pede_forma(a: dict) -> bool:
    """Gasto único, sem repetição e sem parcelas: o único caso em que o rascunho leva a forma."""
    tipo = "create_expense" if a["type"] == "mark_paid" else a["type"]
    return tipo == "create_expense" and not a.get("recurrence")


class PedidoDeRascunho(Corpo):
    text: str = Field(min_length=1, max_length=MAX_CONTENT)
    today: date
    timezone: str = Field(min_length=1, max_length=64)


class RascunhoOut(Corpo):
    tipo: Literal["uma", "recorrente", "financiamento"]
    params: dict[str, str]
    perguntas: list[str]
    entendido: str


def _proxima_data(recorrencia: str, hoje: date) -> date:
    """O 1º vencimento de uma regra mensal "dia N" a partir de hoje (dia curto cai no último)."""
    m = re.search(r"BYMONTHDAY=(\d+)", recorrencia)
    if not m:
        return hoje
    dia = int(m.group(1))
    for k in (0, 1):
        mes = hoje.month - 1 + k
        ano, mes = hoje.year + mes // 12, mes % 12 + 1
        d = date(ano, mes, min(dia, monthrange(ano, mes)[1]))
        if d >= hoje:
            return d
    return hoje  # inalcançável: o mês seguinte sempre tem o dia


def _contas_no_texto(texto: str, contas: list[dict]) -> list[dict]:
    """As contas cujo nome (sem as palavras de tipo) aparece inteiro, como palavras, na fala."""
    palavras = set(matching.normalize(texto).split())
    achadas = []
    for c in contas:
        nucleo = matching._sem_palavras_de_tipo(c["name"]).split()
        if nucleo and len("".join(nucleo)) >= matching.MIN_NOME_EM_TERMO and set(nucleo) <= palavras:
            achadas.append(c)
    return achadas


async def montar_rascunho(
    workspace_id, texto: str, acoes: list[dict], hoje: date, forma: str | None = None
) -> RascunhoOut:
    a = dict(acoes[0])
    perguntas: list[str] = []
    if a["type"] == "mark_paid":
        # "paguei 120 de luz": quem abriu o formulário de lançar quer um lançamento novo
        a["type"] = "create_expense"
        a["amount_cents"] = a.get("amount_cents") or a.get("new_amount_cents")
        perguntas.append("Entendi como um pagamento: confira se é um lançamento novo.")
    if len(acoes) > 1:
        resto = len(acoes) - 1
        perguntas.append(
            f"Você disse {len(acoes)} coisas: montei só a primeira. "
            + ("A outra ficou de fora." if resto == 1 else f"As outras {resto} ficaram de fora.")
        )
    kind = "income" if a["type"] == "create_income" else "expense"
    params = {"kind": kind}
    if a.get("description"):
        params["description"] = a["description"].strip()
    if a.get("category"):
        params["category"] = a["category"].strip().lower()
    recorrencia = a.get("recurrence") or None
    tipo: Literal["uma", "recorrente"] = "recorrente" if recorrencia else "uma"
    if a.get("occurred_at"):
        inicio = date.fromisoformat(a["occurred_at"])
    else:
        inicio = _proxima_data(recorrencia, hoje) if recorrencia else hoje
    params["start" if recorrencia else "data"] = format_date_br(inicio.isoformat())

    parcelada = a["type"] == "create_installment_purchase" and (a.get("installments") or 0) > 1
    if parcelada and not recorrencia:
        params["parcelas"] = str(a["installments"])
        if not _UNIDADE_DITA.search(texto):
            perguntas.append("Parcelas: o valor é o total ou o de cada parcela?")
    total = int(a.get("amount_cents") or 0)
    if total:
        params["amount"] = str(total)
    else:
        perguntas.append("Não ouvi o valor: informe.")

    if recorrencia:
        freq = re.search(r"FREQ=(\w+)", recorrencia)
        f = freq.group(1) if freq else ""
        if f in ("WEEKLY", "YEARLY") and "INTERVAL" not in recorrencia:
            params["repete"] = f.lower()
        elif f != "MONTHLY" or "INTERVAL" in recorrencia:
            perguntas.append("Não consegui montar essa repetição: confira a frequência.")

    # conta/cartão: um registro ou nada. "Pix no crédito" é compra no CARTÃO (com os juros do Pix).
    pix = forma == "pix" and dom_atributos.pix_no_credito(texto)
    so_cartao = parcelada or pix
    if pix:
        perguntas.append("Pix no crédito: confira o cartão e os juros do Pix.")
    if forma and kind == "expense" and tipo == "uma" and not parcelada:
        params["paymentMethod"] = forma
        so_cartao = so_cartao or forma == "credit"
    nome = a.get("account")
    if nome and not matching.sem_conta_explicita(nome):
        achada = await finance.resolve_account(workspace_id, nome, only_cards=so_cartao)
        if achada:
            params["account" if recorrencia else "conta"] = str(achada)
        else:
            perguntas.append(f"Não sei qual é *{nome}*: escolha {'o cartão' if so_cartao else 'a conta'}.")
    else:
        # O modelo nem sempre devolve `account`: o nome CADASTRADO dito na fala vale (casamento com
        # as contas do próprio espaço, não inferência). Um registro preenche; vários perguntam.
        citadas = _contas_no_texto(texto, await db.accounts(workspace_id, only_cards=so_cartao))
        if len(citadas) == 1:
            params["account" if recorrencia else "conta"] = str(citadas[0]["id"])
        elif citadas:
            nomes = ", ".join(f"*{c['name']}*" for c in citadas[:6])
            perguntas.append(f"A fala casa com mais de uma conta ({nomes}): escolha.")
        elif so_cartao:
            perguntas.append("Qual cartão? Escolha no formulário.")

    entendido = f"{'Receita' if kind == 'income' else 'Gasto'} de {cents_to_brl(total)}"
    if a.get("description"):
        entendido += f" · {a['description'].strip()}"
    if parcelada and total:
        entendido += f" · {a['installments']}x de {cents_to_brl(total // a['installments'])}"
    return RascunhoOut(tipo=tipo, params=params, perguntas=perguntas, entendido=entendido)


@router.post("/draft", response_model=RascunhoOut)
async def rascunho(body: PedidoDeRascunho, user_id: Annotated[UUID, Depends(current_user)]) -> RascunhoOut:
    perfil = await db.chat_profile(user_id)
    if not perfil or not perfil.get("workspace_id"):
        raise _erro(404, "no_workspace", "Não achei o seu espaço.")
    # O rascunho chama o Gemini como uma mensagem do chat: passa pela mesma cota e entra em
    # `ai_events`, senão a voz vira um jeito de usar a IA de graça e o paywall conta a menos.
    sessao = {"user_id": user_id, "workspace_id": perfil["workspace_id"], "channel": "app"}
    limite = await conversation.check_limits(sessao)
    if limite:
        if limite == conversation.MUITAS:
            raise _erro(429, "rate_limit", "Muitas mensagens em pouco tempo. Aguarda um pouquinho.")
        raise _erro(402, "plan_limit", limite)
    fuso = _fuso_valido(body.timezone)
    estado = {
        "text": body.text,
        "timezone": fuso,
        "workspace_id": perfil["workspace_id"],  # as contas do espaço entram no prompt
        "messages": None,
        "agora_local": f"{body.today.isoformat()}T12:00:00",
    }
    try:
        saida = await nodes.finance_node(estado)
    except Exception:  # noqa: BLE001
        log.warning("Falha na interpretação do rascunho por voz")
        await conversation.soltar_reserva()  # interpretação que falhou não consome a cota
        raise _erro(502, "draft_failed", "Não consegui entender agora. Tente de novo.") from None
    acoes = [x for x in saida.get("finance_actions", []) if x.get("type") in _CRIA]
    forma, chamadas = (None, 0)
    if acoes and _pede_forma(acoes[0]):
        forma, chamadas = await forma_da_fala(body.text, acoes[0])
    await db.record_ai_event(
        user_id=user_id, workspace_id=perfil["workspace_id"], channel="app",
        model=gemini.GEMINI_PARSE, confidence=saida.get("confidence"),
        result={"finance_actions": saida.get("finance_actions", []), "llm_calls": 1 + chamadas, "draft": True},
    )
    if not acoes:
        raise _erro(422, "no_launch", "Não entendi um lançamento. Diga o que gastou ou recebeu.")
    return await montar_rascunho(perfil["workspace_id"], body.text, acoes, body.today, forma)
