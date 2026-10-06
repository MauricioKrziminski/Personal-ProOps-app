"""Nenhum teste fala com o Gemini: a leitura de atributos do lote C (`tools/atributos._extrair`) falha
por padrão, que é o caminho "lança sem os atributos". Teste que a quer sobrescreve com monkeypatch."""

import pytest

from app.tools import atributos


@pytest.fixture(autouse=True)
def _sem_rede_no_gemini(monkeypatch):
    async def _falha(*_a, **_k):
        raise RuntimeError("sem rede nos testes")

    monkeypatch.setattr(atributos, "_extrair", _falha)


@pytest.fixture(autouse=True)
def _trava_de_lembrete_livre(monkeypatch):
    """Sem banco nos testes: a trava consultiva de lembrete sempre é obtida."""
    from contextlib import asynccontextmanager

    from app import db

    @asynccontextmanager
    async def _livre(_chave):
        yield True

    monkeypatch.setattr(db, "trava_de_sessao", _livre)
