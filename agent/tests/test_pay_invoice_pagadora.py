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

    async def accounts(workspace_id, only_cards=False):
        # A pergunta "de qual conta saiu?" lista o que existe.
        return [{"id": PADRAO, "name": "Itaú Corrente", "type": "checking"}]

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance.db, "accounts", accounts)
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
async def test_sem_conta_do_cartao_PERGUNTA_em_vez_de_usar_a_padrao(monkeypatch):
    """A conta padrão do workspace não decide de onde sai mil reais.

    ⚠️ Este teste já afirmou o contrário. O fallback foi copiado de
    `create_transaction`, e as duas situações não são a mesma: lá o padrão é
    onde o gasto do dia a dia cai quando ninguém diz nada; aqui ele escolheria
    a origem de uma transferência que a pessoa não citou — e a frase do SIM nem
    dizia qual era. Regra do dono do produto: na dúvida, pergunta.
    """
    chamadas = _banco(monkeypatch, payment_account_id=None, padrao=PADRAO)
    with pytest.raises(Level1Error) as erro:
        await finance.pay_invoice(_ctx(), FinanceAction(type=FinanceActionType.PAY_INVOICE))
    assert "qual conta" in str(erro.value).lower()
    assert "args" not in chamadas


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


@pytest.mark.asyncio
async def test_cartao_nao_paga_fatura_de_cartao(monkeypatch):
    """A RPC só recusa o PRÓPRIO cartão; cartão→cartão passaria.

    O app filtra `type !== 'credit_card'` na lista de pagadoras e o catálogo
    recusa por escrito. O agente não tinha nada: "paguei a fatura do nubank pelo
    inter", com o Inter também cartão, criaria uma transferência entre cartões.
    """
    chamadas = _banco(monkeypatch, citada="55555555-5555-5555-5555-555555555555")

    async def fetch_one(sql, *args):
        if "select type from public.accounts" in sql:
            return {"type": "credit_card"}
        if "invoice_open_cents" in sql:
            return {"id": "fatura-1", "due_date": "2026-10-10",
                    "account_id": CARTAO, "aberto": 100000}
        return None

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)

    with pytest.raises(Level1Error) as erro:
        await finance.pay_invoice(
            _ctx(),
            FinanceAction(type=FinanceActionType.PAY_INVOICE, counterparty_account="inter"),
        )
    assert "cartão não paga" in str(erro.value).lower()
    assert "args" not in chamadas


@pytest.mark.asyncio
async def test_fatura_zerada_nao_entra_na_pergunta(monkeypatch):
    """Ciclo sem compra nenhuma nasce aberto e vazio — e não é pagável.

    Visto no emulador em 11/09/2026: "paguei a fatura do nubank" devolveu NOVE
    candidatas, as três primeiras com "R$ 0,00 em aberto". Com o teto de 10
    linhas da lista do WhatsApp, as zeradas empurram para fora as que têm
    dívida.
    """
    from app.tools import resolve

    sql = resolve._FONTES["faturas"]["sql"]
    assert "private.invoice_open_cents(ci.id) > 0" in sql
    assert "status not in ('paid','rolled')" in sql


def test_a_frase_do_sim_separa_pagar_de_quitar():
    """A confirmação de `pay_invoice` não pode dizer "SEM tirar do caixa".

    A regra estava presa à TABELA do alvo, e até 11/09/2026 só `mark_paid`
    resolvia uma fatura. Quando `pay_invoice` passou a resolver a fatura como
    alvo, ele herdou a frase de quem NÃO move dinheiro — na tela que o usuário
    aprova. Visto no emulador.
    """
    from app.graph.policy import describe_for_confirmation

    alvo = {
        "table": "card_invoices",
        "status": "found",
        "candidates": [{"id": "i1", "label": "Fatura Nubank — vence 10/09/2026"}],
    }

    pagar = describe_for_confirmation(
        FinanceAction(type=FinanceActionType.PAY_INVOICE), alvo
    )
    assert "SEM tirar do caixa" not in pagar
    assert "pagar" in pagar.lower()

    quitar = describe_for_confirmation(
        FinanceAction(type=FinanceActionType.MARK_PAID), alvo
    )
    assert "SEM tirar do caixa" in quitar
