"""Importação de extrato (OFX/CSV) chamada pelo app — monta a PRÉVIA, não grava lançamento.

O fluxo (plano `docs/superpowers/plans/2026-09-22-importacao-inteligente.md`):

1. parse puro (`domain/statement.py`), com o sentido decidido pelo TIPO da conta do lote;
2. categoria + natureza de cada linha numa chamada só (a regra do usuário ganha da categoria);
3. conciliação em cascata contra o que já está no app (`domain/reconcile.py`);
4. um `import_items` por linha, com o veredito. Quem grava é `finish_import_batch`, com o que a
   pessoa marcou na prévia.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter
from datetime import date, timedelta
from uuid import UUID

from app import db
from app.domain.matching import normalize
from app.domain.reconcile import Existente, Item, conciliar, parse_parcela
from app.domain.statement import ParsedLine, ofx_tipo, parse_csv, parse_ofx
from app.services.gemini import classify_statement_lines

log = logging.getLogger(__name__)

MAX_ITEMS = 500
# Lançamentos do app até esta distância do período do arquivo entram como candidatos: cobre a
# parcela que o app datou pela compra e o banco postou no fechamento (`JANELA_PARCELA`).
MARGEM_CANDIDATOS = 62


class ImportError_(Exception):
    def __init__(self, mensagem: str, status: int = 422) -> None:
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


def impressao_digital(linhas: list[ParsedLine]) -> list[str | None]:
    """Um id estável para linha de CSV, que não traz id do banco.

    Reimportar o MESMO arquivo (ou a fatura de novo, mais completa) tem que dar as mesmas chaves:
    data, valor, sentido, nome normalizado e a POSIÇÃO entre as linhas idênticas do arquivo — dois
    postos de R$ 70 no mesmo dia são duas chaves, não uma.
    """
    vistos: Counter[str] = Counter()
    saida: list[str | None] = []
    for l in linhas:
        if l.external_id:
            saida.append(l.external_id)
            continue
        base = f"{l.occurred_at}|{l.amount_cents}|{l.kind}|{normalize(l.description)}"
        vistos[base] += 1
        saida.append("csv:" + hashlib.md5(f"{base}|{vistos[base]}".encode()).hexdigest())
    return saida


async def run(
    *,
    user_id: UUID,
    workspace_id: UUID,
    content: str,
    source: str,
    filename: str | None = None,
    account_id: UUID | None = None,
) -> dict:
    plano = await db.fetch_one("select * from public._plan_status(%s)", workspace_id)
    if plano and not plano.get("can_import"):
        raise ImportError_(
            f"Importar extrato é do plano Pro. No {plano['plan']} dá para registrar "
            "pelo WhatsApp à vontade.",
            status=402,
        )

    # ⚠️ A conta deixou de ser opcional: ela decide o SENTIDO das linhas (numa fatura a compra é
    # positiva) e é contra ela que se procura o que já está no app. Sem conta, a prévia não teria
    # como dizer "isto já está lançado".
    if account_id is None:
        raise ImportError_("Escolha a conta ou o cartão deste arquivo.")
    conta = await db.fetch_one(
        "select id, type from public.accounts where id = %s and workspace_id = %s",
        account_id, workspace_id,
    )
    if not conta:
        raise ImportError_("Não achei essa conta.", status=404)
    cartao = conta["type"] == "credit_card"

    if source == "ofx":
        tipo = ofx_tipo(content)
        if tipo == "cartao" and not cartao:
            raise ImportError_(
                "Esse arquivo é a fatura de um cartão. Escolha o cartão em «Lançar na conta»."
            )
        if tipo == "conta" and cartao:
            raise ImportError_(
                "Esse arquivo é o extrato de uma conta, não a fatura do cartão. Escolha a conta."
            )
        linhas = parse_ofx(content)
    else:
        linhas = parse_csv(content, cartao=cartao)
    linhas = linhas[:MAX_ITEMS]
    if not linhas:
        raise ImportError_("não encontrei lançamentos nesse arquivo")

    chaves = impressao_digital(linhas)

    lote = await db.fetch_one(
        """
        insert into public.import_batches
          (workspace_id, user_id, source, filename, account_id, status)
        values (%s, %s, %s, %s, %s, 'review')
        returning id
        """,
        workspace_id, user_id, source, filename, account_id,
    )

    # ── categoria e natureza ───────────────────────────────────────────────
    categorias: list[str | None] = [None] * len(linhas)
    naturezas: list[str | None] = [None] * len(linhas)
    try:
        classes = await classify_statement_lines(
            [("saída" if l.kind == "expense" else "entrada", l.description) for l in linhas],
            cartao=cartao,
        )
        for i, (cat, nat) in enumerate(classes):
            categorias[i], naturezas[i] = cat, nat
    except Exception:  # noqa: BLE001
        # sem sugestão a prévia continua útil: a pré-seleção cai na régua estrutural
        log.exception("classificação em lote falhou — itens ficam sem categoria/natureza")
    for i, linha in enumerate(linhas):
        # regra do usuário GANHA da IA (é a decisão que ele já tomou)
        regra = await db.fetch_one(
            "select category from public._match_rule(%s, %s) limit 1",
            workspace_id, linha.description,
        )
        if regra and regra["category"]:
            categorias[i] = regra["category"]

    # ── conciliação ───────────────────────────────────────────────────────
    datas = [date.fromisoformat(l.occurred_at) for l in linhas]
    de, ate = min(datas) - timedelta(days=MARGEM_CANDIDATOS), max(datas) + timedelta(days=MARGEM_CANDIDATOS)
    existentes = [
        Existente(
            id=str(r["id"]), kind=r["kind"], amount_cents=int(r["amount_cents"]),
            occurred_at=r["occurred_at"], description=r["description"], merchant=r["merchant"],
            account_id=str(r["account_id"]) if r["account_id"] else None,
            counterparty_account_id=str(r["counterparty_account_id"]) if r["counterparty_account_id"] else None,
            installment_plan_id=str(r["installment_plan_id"]) if r["installment_plan_id"] else None,
            installment_no=r["installment_no"], plan_installments=r["plan_installments"],
            rollover=bool(r["rollover"]),
        )
        for r in await db.fetch(
            """
            select t.id, t.kind, t.amount_cents, t.occurred_at, t.description, t.merchant,
                   t.account_id, t.counterparty_account_id, t.installment_plan_id,
                   t.installment_no, p.installments as plan_installments,
                   t.rollover_of_invoice_id is not null as rollover
            from public.transactions t
            left join public.installment_plans p on p.id = t.installment_plan_id
            where t.workspace_id = %s
              and t.occurred_at between %s and %s
              and (t.account_id = %s or t.account_id is null or t.counterparty_account_id = %s)
            order by t.occurred_at, t.created_at
            """,
            workspace_id, de, ate, account_id, account_id,
        )
    ]
    ja_importados = {
        r["external_id"]: str(r["transaction_id"])
        for r in await db.fetch(
            """
            select i.external_id, i.transaction_id
            from public.import_items i
            join public.import_batches b on b.id = i.batch_id
            join public.transactions t on t.id = i.transaction_id
            where i.workspace_id = %s and b.account_id = %s and i.status = 'approved'
              and i.external_id = any(%s)
            """,
            workspace_id, account_id, [c for c in chaves if c],
        )
    }
    reservadas = {
        str(r["transaction_id"])
        for r in await db.fetch(
            """
            select i.transaction_id from public.import_items i
            where i.workspace_id = %s and i.status = 'near_match' and i.batch_id <> %s
            """,
            workspace_id, lote["id"],
        )
    }
    vereditos = conciliar(
        [Item(i, l.kind, l.amount_cents, datas[i], l.description, chaves[i]) for i, l in enumerate(linhas)],
        existentes,
        conta_id=str(account_id),
        cartao=cartao,
        ja_importados=ja_importados,
        reservadas=reservadas,
    )

    for linha, v, chave, cat, nat in zip(linhas, vereditos, chaves, categorias, naturezas, strict=True):
        # Só compra no CARTÃO vira compra parcelada; "1/2" num Pix da conta é outra coisa.
        parcela = parse_parcela(linha.description) if cartao and linha.kind == "expense" else None
        await db.execute(
            """
            insert into public.import_items
              (batch_id, workspace_id, kind, amount_cents, occurred_at, description, merchant,
               suggested_category, external_id, installment_no, installments, nature,
               status, transaction_id, match_layer, match_note, adopt_ids)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid, %s, %s, %s::uuid[])
            """,
            lote["id"], workspace_id, linha.kind, linha.amount_cents, linha.occurred_at,
            linha.description, parcela[0] if parcela else None, cat, chave,
            parcela[1] if parcela else None, parcela[2] if parcela else None, nat,
            "pending" if v.status == "novo" else v.status,
            v.transaction_id, v.camada, v.nota, v.adotar or None,
        )

    await db.execute("select public._prepare_import_batch(%s)", lote["id"])
    return {
        "batch_id": str(lote["id"]),
        "items": len(linhas),
        "duplicates": sum(1 for v in vereditos if v.status in ("duplicate", "near_match")),
        "categorized": sum(1 for c in categorias if c),
    }
