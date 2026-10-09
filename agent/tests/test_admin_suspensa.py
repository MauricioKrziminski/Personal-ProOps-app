"""Conta suspensa pelo painel admin: o WhatsApp não processa, avisa 1x/dia e o aviso conta como envio."""

from __future__ import annotations

import pytest

from app import db, worker
from app.config import get_settings

from .test_limite_whatsapp import SESSAO, Mundo

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_suspensa_nao_processa_avisa_uma_vez_e_conta_o_envio(monkeypatch):
    m = Mundo(monkeypatch, sessao=SESSAO)

    async def suspensa(_u):
        return True

    monkeypatch.setattr(db, "conta_suspensa", suspensa)
    r1 = await worker.process_thread("T")
    r2 = await worker.process_thread("T")
    assert r1["status"] == r2["status"] == "suspensa"
    assert m.enviados == [worker.SUSPENSA]  # 2ª mensagem do dia: silêncio
    assert m.contados == ["reply"]          # o aviso passa por _enviar e conta
    assert not m.ia_chamada
