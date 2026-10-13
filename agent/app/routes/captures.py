"""Lançamentos capturados das notificações dos bancos (Android) — só INTERPRETA e guarda "a confirmar".

O aparelho manda o texto das notificações dos bancos que a pessoa escolheu. Cada uma passa pelo MESMO
intérprete da voz (`finance_node` + `montar_rascunho`), é conciliada com o que já existe e vira uma linha
em `captured_notifications`. Nada é lançado aqui: confirmar abre `/finance/lancar` preenchido.
Spec: docs/superpowers/specs/2026-10-12-captura-de-lancamentos-design.md
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import Field

from app import conversation, db
from app.auth import current_user
from app.config import get_settings
from app.domain import atributos as dom_atributos
from app.domain.reconcile import Item, conciliar
from app.graph import nodes
from app.jobs import importer
from app.routes import finance_draft
from app.routes.chat import Corpo
from app.routes.chat import _erro_audio as _erro
from app.services import ia

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/captures", tags=["captures"])

# Mesma lista de `src/lib/captura.ts` (pacotes conferidos na Play Store em 12/10/2026).
BANCOS = {
    "com.nu.production": "Nubank", "com.itau": "Itaú", "br.com.bb.android": "Banco do Brasil",
    "com.bradesco": "Bradesco", "br.com.gabba.Caixa": "Caixa", "com.santander.app": "Santander",
    "br.com.intermedium": "Inter", "com.c6bank.app": "C6 Bank", "com.picpay": "PicPay",
    "com.mercadopago.wallet": "Mercado Pago", "br.com.neon": "Neon", "br.com.uol.ps.myaccount": "PagBank",
}
PACOTE_DE_TESTE = "com.android.shell"
MAX_POR_ENVIO = 20
MARGEM_DIAS = 5
# Uma notificação em interpretação (`processing`) é de quem a reservou; depois disto, a reserva de um
# processo que morreu no meio volta a valer para o próximo envio.
RESERVA_VENCE_EM_MIN = 10
# Estrutura, não sentido: movimento de dinheiro sempre traz valor em reais.
_VALOR = re.compile(r"R\$\s*\d|\b\d+(?:\.\d{3})*,\d{2}\b")


class NotificacaoIn(Corpo):
    external_id: str = Field(min_length=8, max_length=128)
    package: str = Field(min_length=1, max_length=128)
    title: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=1000)
    posted_at: datetime


class EnvioIn(Corpo):
    timezone: str = Field(min_length=1, max_length=64)
    items: list[NotificacaoIn] = Field(min_length=1, max_length=MAX_POR_ENVIO)


class EnvioOut(Corpo):
    aceitos: list[str]
    novos: int


class _Falhou(Exception):
    """Depois da chamada ao modelo: repetir custaria outra chamada e falharia igual."""


class _Parar(Exception):
    """Rajada, cota ou modelo fora: o resto fica no aparelho para a próxima abertura."""


def banco_do_pacote(pacote: str) -> str | None:
    if pacote in BANCOS:
        return BANCOS[pacote]
    if pacote == PACOTE_DE_TESTE and get_settings().captura_aceita_teste:
        return "Teste"
    return None


def tem_valor(texto: str) -> bool:
    return bool(_VALOR.search(texto))


def origem_da_notificacao(banco: str) -> str:
    """A instrução, CONFIÁVEL: vai fora do envelope (`user_turn(origem=...)`). `banco` vem da allowlist."""
    return (
        f"O texto do usuário abaixo é uma notificação do app do banco {banco}, copiada do celular — não uma "
        "mensagem escrita pela pessoa. Crie um lançamento só se ela registrar um gasto, uma compra, um Pix "
        "ou uma transferência feita ou recebida. Transferência ou Pix enviado a outra pessoa ou conta é "
        "gasto (create_expense) e recebido é receita (create_income), nunca create_transfer. Fatura fechada, limite, saldo, cashback, código, compra "
        "negada e propaganda não são lançamento: nesses casos, nenhuma ação."
    )


def texto_da_notificacao(titulo: str, texto: str) -> str:
    """O DADO: vai dentro do envelope `<user_input>`, sem nenhuma instrução nossa."""
    return f"{titulo}\n{texto}".strip()


def _colunas(item: NotificacaoIn, status: str, rascunho, kind, amount_cents, occurred_at, match) -> tuple:
    return (
        None if status == "ignored" else f"{item.title}\n{item.text}"[:1300],
        status, json.dumps(rascunho.model_dump()) if rascunho else None,
        rascunho.entendido if rascunho else None, kind, amount_cents, occurred_at, match,
    )


async def _gravar_ignorada(ws, user_id, item: NotificacaoIn, banco: str) -> None:
    """Sem modelo (pacote fora da lista, sem valor): grava direto, e repetir é no-op."""
    await db.execute(
        """
        insert into public.captured_notifications
          (workspace_id, user_id, external_id, bank, posted_at, status)
        values (%s, %s, %s, %s, %s, 'ignored')
        on conflict (workspace_id, external_id) do nothing
        """,
        ws, user_id, item.external_id, banco, item.posted_at,
    )


async def _reservar(ws, user_id, item: NotificacaoIn, banco: str) -> str | None:
    """Reserva a notificação ANTES do modelo; None = outro envio já a está interpretando.

    A mesma notificação chega de dois aparelhos da pessoa com o MESMO `external_id` (o hash do
    pacote, do texto e da janela de 5 min). Sem a reserva, os dois liam "não conhecida", os dois
    pagavam o modelo e o segundo insert virava no-op. A reserva vencida (processo que morreu no
    meio) é retomada; a viva fica com quem a fez, e o outro aparelho mantém o item na fila.
    """
    r = await db.fetch_one(
        """
        insert into public.captured_notifications
          (workspace_id, user_id, external_id, bank, posted_at, status)
        values (%s, %s, %s, %s, %s, 'processing')
        on conflict (workspace_id, external_id) do update
          set user_id = excluded.user_id, bank = excluded.bank, posted_at = excluded.posted_at
          where captured_notifications.status = 'processing'
            and captured_notifications.updated_at < now() - make_interval(mins => %s)
        returning id
        """,
        ws, user_id, item.external_id, banco, item.posted_at, RESERVA_VENCE_EM_MIN,
    )
    return str(r["id"]) if r else None


async def _soltar(reserva: str) -> None:
    """Devolve a reserva: o item volta para a fila do aparelho e o próximo envio o interpreta."""
    try:
        await db.execute(
            "delete from public.captured_notifications where id = %s and status = 'processing'", reserva)
    except Exception:  # noqa: BLE001 — sem soltar, ela vence em RESERVA_VENCE_EM_MIN e é retomada
        log.warning("Reserva de captura %s não foi solta", reserva)


async def _concluir(reserva: str, item: NotificacaoIn, status: str, rascunho=None, kind=None,
                    amount_cents=None, occurred_at=None, match=None) -> None:
    """Fecha a reserva com o resultado. Sem linha alterada, a reserva venceu e foi retomada: falha."""
    n = await db.execute(
        """
        update public.captured_notifications set
          texto = %s, status = %s, draft = %s::jsonb, entendido = %s, kind = %s,
          amount_cents = %s, occurred_at = %s, match_transaction_id = %s::uuid
        where id = %s and status = 'processing'
        """,
        *_colunas(item, status, rascunho, kind, amount_cents, occurred_at, match), reserva,
    )
    if n == 0:
        raise RuntimeError("reserva de captura perdida")


async def _duplicata(ws, kind: str, amount_cents: int, dia: date, descricao: str | None, conta: str | None):
    existentes = await importer.carregar_existentes(
        ws, dia - timedelta(days=MARGEM_DIAS), dia + timedelta(days=MARGEM_DIAS), conta)
    if conta is None:  # sem conta, qualquer conta casa
        existentes = [replace(t, account_id=None) for t in existentes]
    (v,) = conciliar([Item(0, kind, amount_cents, dia, descricao, None)], existentes,
                     conta_id=conta or "", cartao=False)
    # O nome da notificação ("MERCADO SAO JOSE") quase nunca é o que a pessoa escreveu ("mercado"):
    # mesmo valor em poucos dias e nome parecido também saem da Hoje, para ela decidir na lista.
    return v.transaction_id if v.status in ("duplicate", "near_match", "uncertain") else None


async def _interpretar(user_id, ws, item: NotificacaoIn, banco: str, fuso: str):
    sessao = {"user_id": user_id, "workspace_id": ws, "channel": "app"}
    limite = await conversation.check_limits(sessao, kind="capture")
    if limite == conversation.SEM_CONSENTIMENTO_IA:
        raise conversation.ConsentimentoNecessario()
    if limite:
        raise _Parar(limite)
    local = item.posted_at.astimezone(ZoneInfo(fuso))
    texto = texto_da_notificacao(item.title, item.text)
    estado = {"text": texto, "origem": origem_da_notificacao(banco), "timezone": fuso, "workspace_id": ws,
              "messages": None, "agora_local": local.replace(tzinfo=None).isoformat(timespec="seconds")}
    try:
        saida = await nodes.finance_node(estado)
    except Exception:  # noqa: BLE001
        log.warning("Falha ao interpretar notificação capturada")
        await conversation.soltar_reserva()
        raise _Parar("modelo") from None
    acoes = [x for x in saida.get("finance_actions", []) if x.get("type") in finance_draft._CRIA]
    await db.record_ai_event(
        user_id=user_id, workspace_id=ws, channel="app", model=ia.modelo(ia.PAPEL_PARSE),
        confidence=saida.get("confidence"), kind="capture",
        result={"finance_actions": saida.get("finance_actions", []), "llm_calls": 1, "capture": True},
    )
    if not acoes:
        return None, None, local.date()
    try:
        return await _rascunho(ws, texto, banco, acoes, local.date())
    except Exception as e:  # noqa: BLE001
        raise _Falhou(type(e).__name__) from None


async def _rascunho(ws, texto: str, banco: str, acoes: list[dict], dia: date):
    local_date = dia
    forma = (dom_atributos.forma_proposta(acoes[0].get("payment_method"), texto)
             if finance_draft._pede_forma(acoes[0]) else None)
    # O nome do banco entra no texto que `montar_rascunho` casa com as contas cadastradas ("Nubank" →
    # a conta/cartão Nubank, só se casar com UM registro); ele não vai ao modelo por aqui.
    rascunho = await finance_draft.montar_rascunho(ws, f"{banco}\n{texto}", acoes, local_date, forma)
    return rascunho, acoes[0], local_date


@router.post("/notifications", response_model=EnvioOut)
async def receber(body: EnvioIn, user_id: Annotated[UUID, Depends(current_user)]) -> EnvioOut:
    perfil = await db.chat_profile(user_id)
    if not perfil or not perfil.get("workspace_id"):
        raise _erro(404, "no_workspace", "Não achei o seu espaço.")
    ws = perfil["workspace_id"]
    # A captura é da assinatura: sem ela nada é aceito nem interpretado (o app mantém a fila).
    plano = await db.plan_status(ws)
    if not plano or plano.get("access") != "subscriber":
        raise _erro(402, "subscription_required", "A captura faz parte da assinatura.")
    fuso = finance_draft._fuso_valido(body.timezone)
    ids = [i.external_id for i in body.items]
    # Conhecida = já resolvida. A em interpretação (`processing`) não conta: se o outro envio falhar,
    # ela volta para a fila; se der certo, o próximo envio deste aparelho a acha aqui.
    conhecidos = {r["external_id"] for r in await db.fetch(
        """select external_id from public.captured_notifications
           where workspace_id = %s and external_id = any(%s) and status <> 'processing'""",
        ws, ids,
    )}
    aceitos = [e for e in ids if e in conhecidos]
    novos = 0
    parado = False
    for item in body.items:
        if item.external_id in conhecidos:
            continue
        banco = banco_do_pacote(item.package)
        if not banco or not tem_valor(f"{item.title} {item.text}"):
            try:
                await _gravar_ignorada(ws, user_id, item, banco or item.package[:128])
            except Exception:  # noqa: BLE001 — um item ruim não trava a fila: fica no aparelho
                log.warning("Notificação %s ignorada não gravou", item.external_id)
                continue
            aceitos.append(item.external_id)
            continue
        if parado:
            continue  # fica no aparelho
        try:
            reserva = await _reservar(ws, user_id, item, banco)
        except Exception:  # noqa: BLE001 — banco fora: o resto também ficaria
            log.warning("Notificação %s não foi reservada", item.external_id)
            parado = True
            continue
        if reserva is None:
            continue  # outro aparelho está interpretando esta mesma notificação agora
        try:
            rascunho, acao, dia = await _interpretar(user_id, ws, item, banco, fuso)
        except _Falhou as e:
            rascunho, acao, dia = None, None, None
            log.warning("Notificação %s (%s) descartada: %s", item.external_id, banco, e)
        except conversation.ConsentimentoNecessario:
            await _soltar(reserva)
            raise
        except Exception as e:  # noqa: BLE001 — teto, modelo fora ou cota indisponível: volta à fila
            if not isinstance(e, _Parar):
                log.warning("Notificação %s não foi interpretada: %s", item.external_id, type(e).__name__)
            await _soltar(reserva)
            parado = True
            continue
        try:
            if rascunho is None:
                await _concluir(reserva, item, "ignored")
            else:
                kind = "income" if acao["type"] == "create_income" else "expense"
                valor = int(acao.get("amount_cents") or 0) or None
                ocorreu = date.fromisoformat(acao["occurred_at"]) if acao.get("occurred_at") else dia
                conta = rascunho.params.get("conta")
                match = await _duplicata(ws, kind, valor, ocorreu, acao.get("description"), conta) if valor else None
                await _concluir(reserva, item, "duplicate" if match else "pending", rascunho,
                                kind, valor, ocorreu, match)
                novos += 1
        except Exception as e:  # noqa: BLE001
            # Já custou um modelo: repetir custaria de novo e falharia igual. Fecha como ignorada; se
            # nem isso grava (banco fora), para sem aceitar — o aparelho guarda e tenta depois.
            log.warning("Notificação %s (%s) com falha após o modelo: %s", item.external_id, banco, type(e).__name__)
            try:
                await _concluir(reserva, item, "ignored")
            except Exception:  # noqa: BLE001
                parado = True
                continue
        aceitos.append(item.external_id)
    return EnvioOut(aceitos=aceitos, novos=novos)
