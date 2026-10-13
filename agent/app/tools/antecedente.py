"""Resposta sobre o lançamento que a conversa ACABOU de escrever ("em que conta ficou esse gasto?").

Template Python sobre a linha relida do banco: nenhum número sai do modelo.
"""

from __future__ import annotations

from uuid import UUID

from app import db
from app.domain.dates import format_date_br
from app.domain.money import cents_to_brl

_TIPO = {"expense": "Gasto", "income": "Receita", "transfer": "Transferência"}
_STATUS = {"cleared": "efetivado", "pending": "previsto (ainda não aconteceu)"}
NAO_EXISTE = "🤷 Não encontro mais esse lançamento — ele pode ter sido apagado."


async def descrever(workspace_id, last_write_id: str, de: str | None = None, ate: str | None = None) -> str | None:
    """`None` quando a linha cai FORA do período que o modelo leu na pergunta: aí ela não é o
    "esse" da frase, e quem chamou segue a consulta normal."""
    try:
        tx_id = UUID(str(last_write_id))
    except ValueError:
        return NAO_EXISTE
    # filtro por workspace na própria consulta: o serviço ignora RLS
    r = await db.fetch_one(
        "select t.description, t.merchant, t.amount_cents, t.kind, t.category, t.occurred_at, "
        "t.status, a.name as account_name "
        "from public.transactions t left join public.accounts a on a.id = t.account_id "
        "where t.id = %s and t.workspace_id = %s",
        tx_id,
        workspace_id,
    )
    if r is None:
        return NAO_EXISTE
    dia = str(r["occurred_at"])[:10]
    if (de and dia < de[:10]) or (ate and dia > ate[:10]):
        return None
    nome = r.get("description") or r.get("merchant") or "Sem descrição"
    linhas = [
        f"{_TIPO.get(r['kind'], 'Lançamento')}: *{nome}* — {cents_to_brl(r['amount_cents'])}",
        f"• Conta: {r.get('account_name') or 'sem conta'}",
        f"• Categoria: {r.get('category') or 'sem categoria'}",
        f"• Data: {format_date_br(r['occurred_at'])}",
        f"• Situação: {_STATUS.get(r['status'], r['status'])}",
    ]
    return "\n".join(linhas)
