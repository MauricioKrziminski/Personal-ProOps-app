"""Lembrete de conta: texto, canais e tentativas. Banco e canais são dublês (`agent.md`)."""

from __future__ import annotations

from datetime import date

import pytest

from app.jobs import bill_reminders, reminders

HOJE = date(2026, 10, 7)


def test_texto_no_dia_amanha_e_em_n_dias():
    assert bill_reminders.texto("Fatura Nubank", 375122, HOJE, HOJE) == "Fatura Nubank vence hoje · R$ 3.751,22"
    assert bill_reminders.texto("Aluguel", 150000, date(2026, 10, 8), HOJE) == "Aluguel vence amanhã · R$ 1.500,00"
    assert (bill_reminders.texto("Parcela Carro (9/48)", 148500, date(2026, 10, 10), HOJE)
            == "Parcela Carro (9/48) vence em 3 dias, 10/10 · R$ 1.485,00")


class _Banco:
    def __init__(self, linhas, estado=None):
        self.linhas = linhas
        self.estado = estado if estado is not None else {"sent_at": None, "attempts": 0}
        self.execs: list[tuple] = []

    async def fetch(self, sql, *args):
        return self.linhas if "_bill_reminders_due" in sql else []

    async def fetch_one(self, sql, *args):
        return self.estado

    async def execute(self, sql, *args):
        self.execs.append((" ".join(sql.split()), args))


def _linha(**alt):
    base = {"bill_reminder_id": "b1", "due_date": date(2026, 10, 8), "days_before": 1,
            "title": "Aluguel", "amount_cents": 150000, "target": "transaction",
            "ref": "11111111-1111-1111-1111-111111111111", "channel": "push",
            "phone": "5511999990000", "expo_push_token": "ExponentPushToken[x]",
            "alerts_whatsapp_enabled": False, "attempts": 0}
    return {**base, **alt}


@pytest.fixture
def ambiente(monkeypatch):
    enviados: dict[str, list] = {"push": [], "whatsapp": []}

    async def push_fake(token, titulo, corpo, alvo="today", ref=None):  # noqa: ANN001
        enviados["push"].append((titulo, corpo, alvo, ref))

    async def wa_fake(telefone, template, params):  # noqa: ANN001
        enviados["whatsapp"].append(params[0])

    class _Trava:
        def __init__(self, chave): ...
        async def __aenter__(self): return True
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(reminders.push, "send", push_fake)
    monkeypatch.setattr(reminders.whatsapp, "send_template", wa_fake)
    monkeypatch.setattr(bill_reminders.db, "trava_de_sessao", _Trava)
    monkeypatch.setattr(bill_reminders, "hoje_local", lambda: HOJE)
    return enviados


@pytest.mark.asyncio
async def test_push_abre_o_registro_e_marca_enviado(monkeypatch, ambiente):
    banco = _Banco([_linha()])
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(bill_reminders.db, nome, getattr(banco, nome))
    out = await bill_reminders.run()
    assert out == {"due": 1, "sent": 1, "failed": 0}
    assert ambiente["push"] == [("⏰ Lembrete", "Aluguel vence amanhã · R$ 1.500,00", "transaction",
                                 "11111111-1111-1111-1111-111111111111")]
    assert any("set sent_at = now()" in sql for sql, _ in banco.execs)


@pytest.mark.asyncio
async def test_sem_token_e_whatsapp_desligado_conta_tentativa_e_nao_manda_nada(monkeypatch, ambiente):
    banco = _Banco([_linha(expo_push_token=None)])
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(bill_reminders.db, nome, getattr(banco, nome))
    out = await bill_reminders.run()
    assert out == {"due": 1, "sent": 0, "failed": 1}
    assert ambiente["whatsapp"] == []
    assert any("attempts = attempts + 1" in sql for sql, _ in banco.execs)


@pytest.mark.asyncio
async def test_divida_vai_com_alvo_debt(monkeypatch, ambiente):
    banco = _Banco([_linha(target="debt", title="Parcela Carro (9/48)")])
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(bill_reminders.db, nome, getattr(banco, nome))
    await bill_reminders.run()
    assert ambiente["push"][0][2] == "debt"


def _instala(monkeypatch, banco):
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(bill_reminders.db, nome, getattr(banco, nome))


@pytest.mark.asyncio
@pytest.mark.parametrize("estado", [
    {"sent_at": "2026-10-07T09:00", "attempts": 0},
    {"sent_at": None, "attempts": bill_reminders.MAX_TENTATIVAS},
])
async def test_ja_enviado_ou_sem_tentativas_nao_manda_nada(monkeypatch, ambiente, estado):
    _instala(monkeypatch, _Banco([_linha(channel="both", alerts_whatsapp_enabled=True)], estado))
    out = await bill_reminders.run()
    assert out == {"due": 1, "sent": 0, "failed": 0}
    assert ambiente == {"push": [], "whatsapp": []}


@pytest.mark.asyncio
async def test_canal_whatsapp_manda_o_template_uma_vez(monkeypatch, ambiente):
    _instala(monkeypatch, _Banco([_linha(channel="whatsapp", alerts_whatsapp_enabled=True)]))
    out = await bill_reminders.run()
    assert out["sent"] == 1
    assert ambiente["push"] == []
    assert ambiente["whatsapp"] == ["Aluguel vence amanhã · R$ 1.500,00"]


@pytest.mark.asyncio
async def test_push_sem_token_cai_no_whatsapp_uma_vez(monkeypatch, ambiente):
    _instala(monkeypatch, _Banco([_linha(expo_push_token=None, alerts_whatsapp_enabled=True)]))
    out = await bill_reminders.run()
    assert out["sent"] == 1
    assert ambiente["push"] == []
    assert ambiente["whatsapp"] == ["Aluguel vence amanhã · R$ 1.500,00"]
