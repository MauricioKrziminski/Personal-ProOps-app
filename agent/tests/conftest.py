"""Nenhum teste fala com o Gemini: a leitura de atributos do lote C (`tools/atributos._extrair`) falha
por padrão, que é o caminho "lança sem os atributos". Teste que a quer sobrescreve com monkeypatch."""

import pytest

from app.tools import atributos


@pytest.fixture(autouse=True)
def _sem_rede_no_gemini(monkeypatch):
    async def _falha(*_a, **_k):
        raise RuntimeError("sem rede nos testes")

    monkeypatch.setattr(atributos, "_extrair", _falha)
