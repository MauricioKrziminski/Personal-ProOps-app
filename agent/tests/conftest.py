import pytest


@pytest.fixture(autouse=True)
def _trava_de_lembrete_livre(monkeypatch):
    """Sem banco nos testes: a trava consultiva de lembrete sempre é obtida."""
    from contextlib import asynccontextmanager

    from app import db

    @asynccontextmanager
    async def _livre(_chave):
        yield True

    monkeypatch.setattr(db, "trava_de_sessao", _livre)
