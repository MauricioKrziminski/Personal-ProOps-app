import pytest


@pytest.fixture(autouse=True)
def _sem_rede_no_embedding(monkeypatch):
    """O cliente de embedding da busca semântica nunca sobe de verdade: falha como um 429, que é o
    caminho "sem semântica, cai no lexical". Teste que o quer troca `embeddings._embeddings`."""
    from app.services import embeddings

    class _SemRede:
        async def aembed_query(self, *_a, **_k):
            raise RuntimeError("sem rede nos testes")

        aembed_documents = aembed_query

    monkeypatch.setattr(embeddings, "_embeddings", lambda: _SemRede())


@pytest.fixture(autouse=True)
def _sem_rede_no_embedding(monkeypatch):
    """O cliente de embedding da busca semântica nunca sobe de verdade: falha como um 429, que é o
    caminho "sem semântica, cai no lexical". Teste que o quer troca `embeddings._embeddings`."""
    from app.services import embeddings

    class _SemRede:
        async def aembed_query(self, *_a, **_k):
            raise RuntimeError("sem rede nos testes")

        aembed_documents = aembed_query

    monkeypatch.setattr(embeddings, "_embeddings", lambda: _SemRede())


@pytest.fixture(autouse=True)
def _trava_de_lembrete_livre(monkeypatch):
    """Sem banco nos testes: a trava consultiva de lembrete sempre é obtida."""
    from contextlib import asynccontextmanager

    from app import db

    @asynccontextmanager
    async def _livre(_chave):
        yield True

    monkeypatch.setattr(db, "trava_de_sessao", _livre)


class UnidadeFalsa:
    """Dublê de `db.unidade_de_trabalho`: sem pool, e conta o que commitou e o que voltou."""

    def __init__(self):
        self.commits = 0
        self.rollbacks = 0

    def __call__(self):
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _u():
            try:
                yield
            except BaseException:
                self.rollbacks += 1
                raise
            else:
                self.commits += 1

        return _u()


@pytest.fixture(autouse=True)
def unidade(monkeypatch):
    """Os testes dos nós/registry não abrem pool: a unidade de trabalho vira um dublê que registra."""
    from app import db

    falsa = UnidadeFalsa()
    monkeypatch.setattr(db, "unidade_de_trabalho", falsa)
    return falsa
