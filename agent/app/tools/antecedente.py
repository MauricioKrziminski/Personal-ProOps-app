"""Resposta sobre o lançamento que a conversa ACABOU de escrever ("em que conta ficou esse gasto?").

Template Python sobre a linha relida do banco: nenhum número sai do modelo.
"""

from __future__ import annotations

from uuid import UUID

from app import db
from app.domain.dates import format_date_br
from app.domain.matching import normalize
from app.domain.money import cents_to_brl
from app.domain.reference import clean_term

_TIPO = {"expense": "Gasto", "income": "Receita", "transfer": "Transferência"}
_STATUS = {"cleared": "efetivado", "pending": "previsto (ainda não aconteceu)"}
NAO_EXISTE = "🤷 Não encontro mais esse lançamento — ele pode ter sido apagado."


def _bate(r: dict, consulta) -> bool:
    """A linha satisfaz o que o modelo leu na pergunta? Com histórico, ele resolve "esse
    lançamento" sozinho e devolve o NOME e o dia da linha como filtro (staging, 13/10/2026); um
    filtro que a linha não satisfaz ("esse gasto do mercado" com o café no antecedente) diz que o
    "esse" é outro."""
    if consulta is None:
        return True
    termo = normalize(clean_term(consulta.search_term))
    if termo and not any(termo in normalize(r.get(c)) for c in ("description", "merchant", "category")):
        return False
    if consulta.category and normalize(consulta.category) != normalize(r.get("category")):
        return False
    if consulta.account and normalize(consulta.account) not in normalize(r.get("account_name")):
        return False
    dia = str(r["occurred_at"])[:10]
    de, ate = consulta.query_from, consulta.query_to
    return not ((de and dia < de[:10]) or (ate and dia > ate[:10]))


async def descrever(workspace_id, last_write_id: str, consulta=None) -> str | None:
    """`None` quando a linha não satisfaz a `consulta` que o modelo leu (`_bate`): aí ela não é o
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
    if not _bate(r, consulta):
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
