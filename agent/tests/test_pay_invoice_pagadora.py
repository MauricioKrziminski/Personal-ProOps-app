"""De qual conta sai o dinheiro da fatura.

"paguei a fatura do nubank" — a frase como ela sai na vida real — não cita conta
nenhuma. `resolve_account` devolve None para nome vazio, e o None chegava na RPC:
a guarda `p_account_id = inv.account_id` não dispara com NULL (em SQL, `NULL = x`
é NULL, não TRUE) e o INSERT do `transfer` aceita origem nula. **A fatura ficava
paga e nenhum saldo se mexia** — o pior modo de falha possível num app de
dinheiro, porque a tela concorda com o agente e os dois estão errados juntos.
"""

import pytest

from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

CARTAO = "11111111-1111-1111-1111-111111111111"
PAGADORA = "22222222-2222-2222-2222-222222222222"
PADRAO = "33333333-3333-3333-3333-333333333333"
CITADA = "44444444-4444-4444-4444-444444444444"


ALVO = {
    "table": "card_invoices",
    "status": "found",
    "candidates": [{"id": "fatura-1", "label": "Fatura Nubank — vence 10/10/2026"}],
}


def _ctx():
    """O alvo vem resolvido: `pay_invoice` lê dele, não faz o próprio SELECT."""
    return ExecContext("user", "ws", None, "America/Sao_Paulo", "paguei a fatura", "app:1",
                       target=ALVO)


def _banco(monkeypatch, *, payment_account_id=None, padrao=None, citada=None):
    """Dublê que grava o que foi para a RPC."""
    chamadas = {}

    async def fetch_one(sql, *args):
        if "from public.card_invoices" in sql and "invoice_open_cents" in sql:
            return {"id": "fatura-1", "due_date": "2026-10-10",
                    "account_id": CARTAO, "aberto": 100000}
        if "payment_account_id" in sql:
            return {"payment_account_id": payment_account_id}
        if "default_account_id" in sql:
            return {"default_account_id": padrao}
        if "public.pay_invoice(" in sql:
            chamadas["args"] = args
            return {"id": "tx-1"}
        return None

    async def resolve(ws, nome, **kw):
        if kw.get("only_cards"):
            return CARTAO
        return citada if nome else None

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance, "resolve_account", resolve)
    return chamadas


@pytest.mark.asyncio
async def test_sem_conta_citada_usa_a_que_paga_a_fatura(monkeypatch):
    """`accounts.payment_account_id` é o campo "Conta que paga a fatura".

    A tela da fatura já o usa como sugestão; o agente passa a usar o mesmo.
    """
    chamadas = _banco(monkeypatch, payment_account_id=PAGADORA, padrao=PADRAO)
    await finance.pay_invoice(_ctx(), FinanceAction(type=FinanceActionType.PAY_INVOICE))
    assert chamadas["args"][1] == PAGADORA


@pytest.mark.asyncio
async def test_sem_conta_do_cartao_cai_na_conta_padrao(monkeypatch):
    chamadas = _banco(monkeypatch, payment_account_id=None, padrao=PADRAO)
    await finance.pay_invoice(_ctx(), FinanceAction(type=FinanceActionType.PAY_INVOICE))
    assert chamadas["args"][1] == PADRAO


@pytest.mark.asyncio
async def test_conta_citada_ganha_das_duas(monkeypatch):
    chamadas = _banco(monkeypatch, payment_account_id=PAGADORA, padrao=PADRAO, citada=CITADA)
    await finance.pay_invoice(
        _ctx(),
        FinanceAction(type=FinanceActionType.PAY_INVOICE, counterparty_account="itau"),
    )
    assert chamadas["args"][1] == CITADA


@pytest.mark.asyncio
async def test_sem_nenhuma_conta_pergunta_em_vez_de_mandar_null(monkeypatch):
    """A regressão. Antes isto mandava NULL e a fatura era paga do nada."""
    chamadas = _banco(monkeypatch, payment_account_id=None, padrao=None)
    with pytest.raises(Level1Error) as erro:
        await finance.pay_invoice(_ctx(), FinanceAction(type=FinanceActionType.PAY_INVOICE))
    assert "qual conta" in str(erro.value).lower()
    assert "args" not in chamadas, "não pode chamar a RPC sem conta pagadora"


# ---------------------------------------------------------------------------
# o alvo: qual fatura
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sem_alvo_resolvido_nao_paga_nada(monkeypatch):
    """A imposição é do registry, mas a tool não pode assumir que houve alvo."""
    _banco(monkeypatch, payment_account_id=PAGADORA)
    ctx = ExecContext("user", "ws", None, "America/Sao_Paulo", "paguei a fatura", "app:1")
    r = await finance.pay_invoice(ctx, FinanceAction(type=FinanceActionType.PAY_INVOICE))
    assert r.read_only


def test_pay_invoice_resolve_alvo_como_todo_o_resto():
    """Sem isto, a tool volta a escolher a fatura mais antiga sozinha.

    `registry.execute` recusa executar quem está em `TARGETS` sem alvo `found` e
    roda `ensure_owned` no id — os dois de graça. Fora de `TARGETS`, `pay_invoice`
    fazia o próprio `order by due_date limit 1`, que é o mesmo padrão já removido
    de `mark_paid` por dar baixa "na mais antiga EM SILÊNCIO".
    """
    from app.tools import resolve

    assert resolve.TARGETS[FinanceActionType.PAY_INVOICE] == "faturas"
    assert "card_invoices" == resolve._FONTES["faturas"]["table"]


def test_o_termo_da_fatura_vem_do_cartao_e_nao_da_descricao():
    """`FinanceAction` guarda o nome do cartão em `account`.

    Se o termo saísse de `description` (o padrão das outras ações), "paguei a
    fatura do nubank" resolveria com termo vazio e listaria as faturas de todos
    os cartões.
    """
    import inspect

    from app.tools import resolve

    fonte = inspect.getsource(resolve)
    assert "FinanceActionType.PAY_INVOICE" in fonte
    assert 'bruto = getattr(acao, "account", None)' in fonte
