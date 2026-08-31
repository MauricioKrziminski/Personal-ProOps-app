"""Importação de extrato (OFX/CSV) chamada pelo app.

Regra do usuário GANHA da IA e roda ANTES do Gemini: cada linha que uma regra já
resolve é uma linha a menos no lote, e o lote é o que custa.
"""

from __future__ import annotations

import logging
from uuid import UUID

from app import db
from app.domain.statement import parse_csv, parse_ofx
from app.services.gemini import categorize_batch

log = logging.getLogger(__name__)

MAX_ITEMS = 500


class ImportError_(Exception):
    def __init__(self, mensagem: str, status: int = 422) -> None:
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


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

    linhas = (parse_ofx(content) if source == "ofx" else parse_csv(content))[:MAX_ITEMS]
    if not linhas:
        raise ImportError_("não encontrei lançamentos nesse arquivo")

    lote = await db.fetch_one(
        """
        insert into public.import_batches
          (workspace_id, user_id, source, filename, account_id, status)
        values (%s, %s, %s, %s, %s, 'review')
        returning id
        """,
        workspace_id, user_id, source, filename, account_id,
    )

    # regra do usuário primeiro: economiza chamada e respeita o que ele já decidiu
    categorias: list[str | None] = []
    sem_regra: list[int] = []
    for i, linha in enumerate(linhas):
        regra = await db.fetch_one(
            "select category from public._match_rule(%s, %s) limit 1",
            workspace_id, linha.description,
        )
        if regra and regra["category"]:
            categorias.append(regra["category"])
        else:
            categorias.append(None)
            sem_regra.append(i)

    if sem_regra:
        try:
            sugeridas = await categorize_batch([linhas[i].description for i in sem_regra])
            for pos, i in enumerate(sem_regra):
                categorias[i] = sugeridas[pos]
        except Exception:  # noqa: BLE001
            # sem categoria é revisável na tela; falhar a importação inteira por
            # causa da sugestão seria trocar 300 linhas por zero
            log.exception("categorização em lote falhou — itens ficam sem categoria")

    for linha, categoria in zip(linhas, categorias, strict=True):
        await db.execute(
            """
            insert into public.import_items
              (batch_id, workspace_id, kind, amount_cents, occurred_at, description, category)
            values (%s, %s, %s, %s, %s, %s, %s)
            """,
            lote["id"], workspace_id, linha.kind, linha.amount_cents,
            linha.occurred_at, linha.description, categoria,
        )

    await db.execute("select public._prepare_import_batch(%s)", lote["id"])
    return {"batch_id": str(lote["id"]), "items": len(linhas)}
