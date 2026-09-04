"""A identidade de uma conversa deixou de ser o telefone.

O agente passou a atender dois canais. O do app não tem número: pendência,
rascunho e reserva de execução precisam se apoiar no id ESTÁVEL da sessão e numa
chave de idempotência sem semântica de WhatsApp no nome. Este arquivo prende o
contrato — sem rede e sem banco: as chamadas de SQL são gravadas por dublês.

O que NÃO pode mudar e também está aqui: `ensure_session` continua com árbitro em
`phone` (a análise mora na 0040) e continua devolvendo `channel = 'whatsapp'`.
"""

from __future__ import annotations

import inspect
from uuid import UUID, uuid4

import pytest

from app import db
from app.config import get_settings
from app.tools.base import ExecContext

SESSAO = UUID("11111111-1111-1111-1111-111111111111")
USER = UUID("22222222-2222-2222-2222-222222222222")
WORKSPACE = UUID("33333333-3333-3333-3333-333333333333")


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def sql(monkeypatch):
    """Grava (sql, args) de cada chamada, sem abrir conexão."""
    chamadas: list[tuple[str, tuple]] = []

    async def _fetch_one(sql: str, *args):
        chamadas.append((sql, args))
        return {"id": uuid4(), "n": 0, "user_id": USER, "channel": "whatsapp"}

    async def _fetch(sql: str, *args):
        chamadas.append((sql, args))
        return []

    async def _execute(sql: str, *args):
        chamadas.append((sql, args))
        return 1

    monkeypatch.setattr(db, "fetch_one", _fetch_one)
    monkeypatch.setattr(db, "fetch", _fetch)
    monkeypatch.setattr(db, "execute", _execute)
    return chamadas


def _texto(chamadas) -> str:
    return "\n".join(sql for sql, _ in chamadas)


# ---------------------------------------------------------------------------
# ExecContext e AgentState
# ---------------------------------------------------------------------------


def test_exec_context_aceita_conversa_sem_telefone():
    """O app não tem número, e o contexto de execução não pode exigir um."""
    ctx = ExecContext(
        user_id=USER,
        workspace_id=WORKSPACE,
        phone=None,
        timezone="America/Sao_Paulo",
        texto="gastei 45 no mercado",
        source_message_id="app:" + str(uuid4()),
    )
    assert ctx.phone is None
    assert not hasattr(ctx, "wa_message_id"), (
        "o nome da Meta voltou ao contexto de execução"
    )


def test_agent_state_fala_de_canal_e_origem():
    from app.graph.state import AgentState

    chaves = AgentState.__annotations__
    assert "source_message_id" in chaves, "AgentState precisa da chave genérica"
    assert "channel" in chaves, "o estado precisa saber de qual canal veio o turno"
    assert "wa_message_id" not in chaves, (
        "wa_message_id continua no estado do grafo — o app não tem id da Meta"
    )


# ---------------------------------------------------------------------------
# pendência e rascunho pela sessão
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_open_pending_busca_pela_sessao(sql):
    await db.open_pending(SESSAO)
    assert SESSAO in sql[0][1]
    assert "session_id = %s" in sql[0][0]
    assert "phone = %s" not in sql[0][0], "a busca de pendência ainda filtra por telefone"


@pytest.mark.asyncio
async def test_create_pending_grava_a_sessao(sql):
    await db.create_pending(
        session_id=SESSAO,
        thread_id="hash:0",
        phone=None,
        user_id=USER,
        workspace_id=WORKSPACE,
        action={"type": "delete_transaction"},
        summary="apagar o gasto de R$ 45",
    )
    assert "session_id" in sql[0][0]
    assert SESSAO in sql[0][1]


@pytest.mark.asyncio
async def test_draft_usa_sessao_como_chave(sql):
    await db.save_draft(
        session_id=SESSAO,
        thread_id="hash:0",
        phone=None,
        user_id=USER,
        workspace_id=WORKSPACE,
        action={},
        raw_text="comprei um mac",
        missing="qual foi o valor?",
    )
    assert "on conflict (session_id)" in sql[0][0], (
        "o rascunho ainda resolve conflito por telefone — no app ele é nulo"
    )

    await db.open_draft(SESSAO)
    assert "session_id = %s" in sql[1][0]

    await db.delete_draft(SESSAO)
    assert "session_id = %s" in sql[2][0]
    assert SESSAO in sql[2][1]


# ---------------------------------------------------------------------------
# reserva de execução
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reserva_de_execucao_e_do_turno_nao_da_meta(sql):
    origem = "app:" + str(uuid4())

    await db.reserve_execution(origem, 0, "create_transaction")
    await db.confirm_execution(origem, 0, None)
    await db.release_execution(origem, 0)

    texto = _texto(sql)
    assert "source_message_id" in texto
    assert "wa_message_id" not in texto, (
        "executed_actions ainda usa o nome da Meta — a coluna foi renomeada na 0055"
    )
    for nome in ("reserve_execution", "confirm_execution", "release_execution"):
        assinatura = inspect.signature(getattr(db, nome))
        assert "source_message_id" in assinatura.parameters, (
            f"{nome} continua com parâmetro de WhatsApp"
        )


# ---------------------------------------------------------------------------
# o que NÃO mudou
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_session_continua_com_arbitro_no_telefone(sql):
    linha = await db.ensure_session("5511999990001", "hash-x")

    assert "on conflict (phone)" in sql[0][0], (
        "trocar o árbitro do upsert quebra toda mensagem de usuário existente (ver 0040)"
    )
    assert linha["channel"] == "whatsapp"


@pytest.mark.asyncio
async def test_fila_da_meta_mantem_o_nome_da_meta(sql):
    """`messages_queue` é exclusiva do WhatsApp: renomear ali seria mentira."""
    await db.enqueue(
        wa_message_id="wamid.ABC",
        thread_id="hash-x",
        phone="5511999990001",
        message_type="text",
        payload={"text": "oi"},
    )
    assert "wa_message_id" in sql[0][0]
