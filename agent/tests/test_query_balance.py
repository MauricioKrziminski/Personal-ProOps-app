"""O saldo do WhatsApp diz a mesma coisa que a tela Contas.

Os três defeitos que esta suíte prende produziam um número que PARECIA certo:

1. somar `balance_cents` (que inclui `pending`) faz o saldo contar o Pix que não chegou;
2. somar o cartão dentro do total mistura o que a pessoa tem com o que ela deve;
3. não avisar do previsto esconde justamente a diferença entre os dois.

O dublê de `db.fetch` devolve a forma exata de `_account_balances` depois da `20260909140000`.
"""

import pytest

from app.tools import queries
from app.tools.base import ExecContext


def _ctx() -> ExecContext:
    return ExecContext("user", "workspace", None, "America/Sao_Paulo", "", "app:1")


# Nubank tem R$ 3.020,00 confirmados e R$ 420,00 de Pix previsto; o cartão deve R$ 21.360,00,
# dos quais R$ 15.330,00 são parcelas de meses à frente. São os números do staging.
LINHAS = [
    {"account_id": "a1", "name": "Nubank", "type": "checking",
     "balance_cents": 344000, "cleared_cents": 302000,
     "pending_in_cents": 42000, "pending_out_cents": 0},
    {"account_id": "a2", "name": "Poupança", "type": "savings",
     "balance_cents": 185000, "cleared_cents": 185000,
     "pending_in_cents": 0, "pending_out_cents": 0},
    {"account_id": "a3", "name": "Nubank Cartão", "type": "credit_card",
     "balance_cents": -2136000, "cleared_cents": -603000,
     "pending_in_cents": 0, "pending_out_cents": 1533000},
]


@pytest.fixture
def resposta(monkeypatch):
    async def fetch(*a, **k):
        return LINHAS

    monkeypatch.setattr(queries.db, "fetch", fetch)

    async def _run():
        return (await queries.query_balance(_ctx(), None)).message

    return _run


@pytest.mark.asyncio
async def test_saldo_nao_conta_o_que_nao_caiu(resposta):
    """R$ 4.870,00 = 3.020 + 1.850. O Pix de R$ 420,00 fica de fora."""
    msg = await resposta()
    assert "R$ 4.870,00" in msg, msg
    assert "R$ 5.290,00" not in msg, "somou o Pix previsto dentro do saldo"


@pytest.mark.asyncio
async def test_cartao_nao_entra_no_dinheiro_disponivel(resposta):
    """Com o cartão dentro do total, o "saldo" viraria −R$ 16.490,00."""
    msg = await resposta()
    assert "-R$ 16.490,00" not in msg and "−R$ 16.490,00" not in msg, msg
    assert "Dívida de cartão" in msg
    assert "R$ 21.360,00" in msg, "a dívida do cartão precisa aparecer, só que separada"


@pytest.mark.asyncio
async def test_avisa_o_que_esta_previsto(resposta):
    """O previsto não some: ele sai do total e vira aviso, com o que fazer."""
    msg = await resposta()
    assert "A receber" in msg and "R$ 420,00" in msg
    assert "recebi" in msg.lower(), 'o aviso precisa dizer a ação, não só o número'
    assert "parcelas de meses à frente" in msg


@pytest.mark.asyncio
async def test_sem_previsto_nao_inventa_aviso(monkeypatch):
    """Aviso de R$ 0,00 é ruído — a mesma régua do 'previsto R$ 0,00' que o painel não escreve."""
    async def fetch(*a, **k):
        return [{"account_id": "a1", "name": "Nubank", "type": "checking",
                 "balance_cents": 302000, "cleared_cents": 302000,
                 "pending_in_cents": 0, "pending_out_cents": 0}]

    monkeypatch.setattr(queries.db, "fetch", fetch)
    msg = (await queries.query_balance(_ctx(), None)).message
    assert "A receber" not in msg
    assert "A pagar" not in msg
    assert "Dívida de cartão" not in msg
