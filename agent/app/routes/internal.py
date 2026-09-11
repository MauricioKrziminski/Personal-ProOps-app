"""Importação de extrato, chamada pelo APP com JWT do Supabase.

⚠️ Correção de segurança em relação à Edge Function que isto substitui.
A `import-statement` recebia `user_id` e `workspace_id` NO CORPO e confiava
neles: o `verify_jwt = true` do Supabase só provava que ALGUM usuário válido
chamou, não que fosse aquele usuário. Qualquer autenticado podia importar
lançamentos para o workspace de outro só mudando o corpo do POST.

Aqui o user_id sai do `sub` do token — nunca do corpo — e a participação no
workspace é verificada antes de qualquer escrita. A verificação em si mora em
`app/auth.py` desde que a aba Agente passou a precisar da mesma.
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import current_user, ensure_member
from app.jobs import importer

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["app"])


class ImportRequest(BaseModel):
    workspace_id: UUID
    content: str = Field(max_length=5_000_000)
    source: str
    filename: str | None = None
    account_id: UUID | None = None


@router.post("/import-statement")
async def import_statement(
    body: ImportRequest, user_id: UUID = Depends(current_user)
) -> dict:
    if body.source not in ("ofx", "csv"):
        raise HTTPException(status_code=400, detail="source tem que ser ofx ou csv")
    await ensure_member(user_id, body.workspace_id)

    # ⚠️ **`ensure_member` prova só que o chamador é membro do workspace que ELE MESMO nomeou.**
    #
    # O `account_id` vinha do corpo e entrava em `import_batches.account_id` sem checagem
    # nenhuma; `approve_import_items` depois o usa como conta da transação criada. Hoje quem
    # segura é o trigger (`tg_transactions_set_invoice` levanta "Conta precisa pertencer ao
    # workspace do lançamento"), então não há escrita cross-tenant — mas `agent.md` é explícita:
    # com o serviço ignorando RLS, escopo é responsabilidade do CÓDIGO. Apoiar-se só no banco é
    # a mesma aposta que a `import-statement` antiga perdeu.
    if body.account_id is not None:
        from app.tools.base import ensure_owned
        from app.tools.guards import Level1Error

        try:
            await ensure_owned("accounts", body.account_id, body.workspace_id)
        except Level1Error as err:
            # 404 e não 403: dizer "existe, mas não é sua" já é responder sobre o dado de outro.
            raise HTTPException(status_code=404, detail="conta não encontrada") from err

    try:
        return await importer.run(
            user_id=user_id,
            workspace_id=body.workspace_id,
            content=body.content,
            source=body.source,
            filename=body.filename,
            account_id=body.account_id,
        )
    except importer.ImportError_ as err:
        raise HTTPException(status_code=err.status, detail=err.mensagem) from err
