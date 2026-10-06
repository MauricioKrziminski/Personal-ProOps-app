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


@pytest.fixture(autouse=True)
def _checkpoint_estrito(monkeypatch):
    """Todo `InMemorySaver` dos testes usa o allowlist de PRODUÇÃO (`build.tipos_do_checkpoint`).

    Os testes de HITL, cadastros, notas e conversa passam o estado pelo checkpoint e o retomam; com
    isto, um tipo novo no estado que o allowlist não conhece vira falha aqui — em produção ele
    voltaria do banco como texto cru, e o "sim" retomaria um estado diferente do que foi salvo.
    """
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.checkpoint.serde import jsonplus

    from app.graph import build

    barrados: list[dict] = []
    emitir = jsonplus.emit_serde_event

    def registra(evento):
        if evento.get("kind") in ("msgpack_blocked", "msgpack_unregistered_allowed"):
            barrados.append(evento)
        return emitir(evento)

    monkeypatch.setattr(jsonplus, "emit_serde_event", registra)
    iniciar = InMemorySaver.__init__

    def iniciar_estrito(self, *, serde=None, **kw):
        estrito = jsonplus.JsonPlusSerializer(allowed_msgpack_modules=build.tipos_do_checkpoint())
        iniciar(self, serde=serde or estrito, **kw)

    monkeypatch.setattr(InMemorySaver, "__init__", iniciar_estrito)
    yield barrados  # o teste que barra um tipo DE PROPÓSITO limpa a lista
    assert not barrados, f"tipo fora do allowlist do checkpoint: {barrados}"
