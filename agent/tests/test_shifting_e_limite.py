"""Testes da Etapa 3.1: Shifting de Calendário e Alerta de Limite do Cartão."""

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
        wa_message_id="w1",
    )


class TestShiftingCalendario:
    @pytest.mark.asyncio
    async def test_shifting_de_7_para_10_pagas_recua_inicio_e_reajusta_parcelas(self, monkeypatch):
        """O caso da moto:
        Plano de 12x iniciado em 2026-08-10 com 7 parcelas pagas.
        Usuário atualiza para 10 pagas.
        Shift = 10 - 7 = 3 meses para trás.
        Novo início: 2026-05-10.
        Parcelas 1..10 viram 'cleared'.
        Parcela 11 vira 'pending' (em 2026-03-10 + 10 meses = 2026-03 ou cálculo exato de meses).
        """
        plano = {
            "id": "plano-moto",
            "description": "Moto Honda",
            "installments": 12,
            "total_cents": 1200000,
            "first_occurred_at": "2026-08-10",
        }
        updates = []

        async def fetch_one(query, *args):
            if "installment_plans" in query:
                return dict(plano)
            if "from public.transactions" in query and "count" in query:
                return {"count": 7}  # A = 7 atualmente pagas
            return None

        async def execute(query, *args):
            updates.append((" ".join(query.split()), args))
            return 1

        monkeypatch.setattr(db, "fetch_one", fetch_one)
        monkeypatch.setattr(db, "execute", execute)

        r = await finance.shift_installment_plan(_ctx(), "plano-moto", new_paid_count=10)

        # 1 update no installment_plans + 12 updates nas transactions
        assert len(updates) == 1 + 12
        q_plan, args_plan = updates[0]
        assert "update public.installment_plans set first_occurred_at = %s" in q_plan
        # 2026-08-10 recuado em 3 meses = 2026-05-10
        assert args_plan[0] == "2026-05-10"

        # Parcela 10: cleared, data 2026-05-10 + 9 meses = 2026-02-10
        q_p10, args_p10 = updates[10]
        assert args_p10[1] == "cleared"  # status
        assert args_p10[4] == 10  # installment_no

        # Parcela 11: pending, data 2026-05-10 + 10 meses = 2026-03-10
        q_p11, args_p11 = updates[11]
        assert args_p11[1] == "pending"  # status
        assert args_p11[2] is None  # paid_at is None
        assert args_p11[4] == 11  # installment_no

        # Parcela 12: pending
        q_p12, args_p12 = updates[12]
        assert args_p12[1] == "pending"
        assert args_p12[4] == 12

        assert "10 parcelas constam como pagas" in r.message
        assert "11ª é a parcela deste mês" in r.message


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
