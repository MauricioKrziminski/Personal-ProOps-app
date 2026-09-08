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
    @pytest.mark.asyncio
    async def test_compra_que_estoura_limite_dispara_soft_warning(self, monkeypatch):
        """Cartão com limite de R$ 5.000 (500000 cents) e R$ 4.000 em faturas abertas (400000 cents).
        Disponível = R$ 1.000 (100000 cents).
        Compra de R$ 2.000 (200000 cents) estoura o limite disponível."""
        async def fetch_one(query, *args):
            if "from public.accounts" in query:
                return {
                    "id": CARD_ID,
                    "name": "Nubank Ultravioleta",
                    "type": "credit_card",
                    "credit_limit_cents": 500000,
                }
            if "from public.transactions" in query and "card_invoices" in query:
                return {"total": 400000}
            return None

        monkeypatch.setattr(db, "fetch_one", fetch_one)

        res = await finance.verificar_limite_disponivel(WS, CARD_ID, 200000)
        assert res["excedeu"] is True
        assert res["limite_centavos"] == 500000
        assert res["disponivel_centavos"] == 100000
        assert res["card_name"] == "Nubank Ultravioleta"

    @pytest.mark.asyncio
    async def test_compra_dentro_do_limite_nao_estoura(self, monkeypatch):
        """Compra de R$ 500 (50000 cents) com R$ 1.000 disponível."""
        async def fetch_one(query, *args):
            if "from public.accounts" in query:
                return {
                    "id": CARD_ID,
                    "name": "Nubank Ultravioleta",
                    "type": "credit_card",
                    "credit_limit_cents": 500000,
                }
            if "from public.transactions" in query and "card_invoices" in query:
                return {"total": 400000}
            return None

        monkeypatch.setattr(db, "fetch_one", fetch_one)

        res = await finance.verificar_limite_disponivel(WS, CARD_ID, 50000)
        assert res["excedeu"] is False
        assert res["disponivel_centavos"] == 100000

    @pytest.mark.asyncio
    async def test_conta_corrente_ou_sem_limite_nao_dispara_aviso(self, monkeypatch):
        """Conta corrente ou cartão sem limite cadastrado não deve disparar aviso."""
        async def fetch_one(query, *args):
            if "from public.accounts" in query:
                return {
                    "id": CARD_ID,
                    "name": "Itaú Corrente",
                    "type": "checking",
                    "credit_limit_cents": None,
                }
            return None

        monkeypatch.setattr(db, "fetch_one", fetch_one)

        res = await finance.verificar_limite_disponivel(WS, CARD_ID, 500000)
        assert res["excedeu"] is False
        assert res["limite_centavos"] is None


class TestTimezoneBlindagem:
    def test_tz_fallback_sempre_sao_paulo(self):
        from app.domain.dates import tz, DEFAULT_TZ
        assert str(tz(None)) == DEFAULT_TZ
        assert str(tz("")) == DEFAULT_TZ
        assert str(tz("UTC")) == DEFAULT_TZ
        assert str(tz("invalido/xyz")) == DEFAULT_TZ
        assert str(tz("America/Sao_Paulo")) == "America/Sao_Paulo"
