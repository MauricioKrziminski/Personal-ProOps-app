"""Baixa preserva calendário; alerta de limite do cartão."""

from uuid import UUID
import pytest

from app import db
from app.tools import finance
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("11111111-1111-1111-1111-111111111111")
CARD_ID = UUID("33333333-3333-3333-3333-333333333333")


def _ctx() -> ExecContext:
    return ExecContext(
        user_id=USER_ID,
        workspace_id=WS,
        phone="5551999999999",
        timezone="America/Sao_Paulo",
        texto="",
        source_message_id="w1",
    )


class TestBaixaSemReprogramacao:
    @pytest.mark.asyncio
    async def test_proposta_antiga_nao_reprograma_calendario(self, monkeypatch):
        from app.graph.schemas import FinanceAction
        from unittest.mock import AsyncMock
        writes = AsyncMock()
        monkeypatch.setattr(db, "execute", writes)
        ctx = _ctx()
        ctx.target = {"table": "installment_plans", "candidates": [{"id": "plano-moto"}]}
        result = await finance.mark_paid(ctx, FinanceAction(type="mark_paid", current_installment=10))
        assert result.read_only
        writes.assert_not_awaited()


class TestVerificarLimiteCartao:
    """O limite sai de `_card_summary`, a mesma RPC da tela — não de uma soma aqui."""

    @staticmethod
    def _summary(limite, disponivel, nome="Nubank Ultravioleta"):
        async def fetch_one(query, *args):
            if "_card_summary" in query:
                return {
                    "name": nome,
                    "credit_limit_cents": limite,
                    "available_limit_cents": disponivel,
                }
            return None
        return fetch_one

    @pytest.mark.asyncio
    async def test_compra_que_estoura_limite_dispara_soft_warning(self, monkeypatch):
        """Limite R$ 5.000, disponível R$ 1.000. Compra de R$ 2.000 estoura."""
        monkeypatch.setattr(db, "fetch_one", self._summary(500000, 100000))
        res = await finance.verificar_limite_disponivel(WS, USER_ID, CARD_ID, 200000)
        assert res["excedeu"] is True
        assert res["limite_centavos"] == 500000
        assert res["disponivel_centavos"] == 100000
        assert res["card_name"] == "Nubank Ultravioleta"

    @pytest.mark.asyncio
    async def test_compra_dentro_do_limite_nao_estoura(self, monkeypatch):
        """Compra de R$ 500 com R$ 1.000 disponível."""
        monkeypatch.setattr(db, "fetch_one", self._summary(500000, 100000))
        res = await finance.verificar_limite_disponivel(WS, USER_ID, CARD_ID, 50000)
        assert res["excedeu"] is False
        assert res["disponivel_centavos"] == 100000

    @pytest.mark.asyncio
    async def test_conta_corrente_ou_sem_limite_nao_dispara_aviso(self, monkeypatch):
        """`_card_summary` não devolve conta corrente nem cartão sem limite."""
        async def vazio(query, *args):
            return None
        monkeypatch.setattr(db, "fetch_one", vazio)
        res = await finance.verificar_limite_disponivel(WS, USER_ID, CARD_ID, 500000)
        assert res["excedeu"] is False
        assert res["limite_centavos"] is None

    @pytest.mark.asyncio
    async def test_fatura_adiada_nao_come_o_limite(self, monkeypatch):
        """A regressão que motivou a troca.

        A soma antiga contava a fatura `rolled` E o principal que já migrou para
        a seguinte: o mesmo dinheiro duas vezes. Com R$ 5.000 de limite e uma
        fatura adiada de R$ 4.000 que virou R$ 4.000 na fatura nova, ela via
        R$ 8.000 comprometidos e recusava uma compra de R$ 500 que cabe.
        `_card_summary` conta uma vez só.
        """
        monkeypatch.setattr(db, "fetch_one", self._summary(500000, 100000))
        res = await finance.verificar_limite_disponivel(WS, USER_ID, CARD_ID, 50000)
        assert res["excedeu"] is False

    @pytest.mark.asyncio
    async def test_le_a_rpc_e_nao_soma_transacao(self, monkeypatch):
        """Trava: voltar a somar `transactions` aqui é a segunda cópia da regra."""
        vistas = []

        async def fetch_one(query, *args):
            vistas.append(query)
            return {"name": "X", "credit_limit_cents": 500000, "available_limit_cents": 100000}

        monkeypatch.setattr(db, "fetch_one", fetch_one)
        await finance.verificar_limite_disponivel(WS, USER_ID, CARD_ID, 1000)
        assert any("_card_summary" in q for q in vistas)
        assert not any("sum(t.amount_cents)" in q for q in vistas)


class TestTimezoneBlindagem:
    def test_tz_fallback_sempre_sao_paulo(self):
        from app.domain.dates import tz, DEFAULT_TZ
        assert str(tz(None)) == DEFAULT_TZ
        assert str(tz("")) == DEFAULT_TZ
        assert str(tz("UTC")) == DEFAULT_TZ
        assert str(tz("invalido/xyz")) == DEFAULT_TZ
        assert str(tz("America/Sao_Paulo")) == "America/Sao_Paulo"
