"""Recuperar um turno que RODOU mas não chegou a ser persistido.

A janela é estreita e real: o grafo termina (ou pausa num `interrupt()`) e grava o
checkpoint, e a persistência HTTP falha logo depois — container reciclado,
conexão caída. Reexecutar duplicaria escrita; devolver erro esconderia um
lançamento que já entrou no banco.

A trava é o `source_message_id`. Só o checkpoint do MESMO turno é reaproveitado —
sem isso, um retry com UUID novo devolveria a resposta do turno anterior, que é
pior que os dois erros que este mecanismo evita.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import conversation
from app.config import get_settings

SESSAO = {
    "id": "44444444-4444-4444-4444-444444444444",
    "channel": "app",
    "phone": None,
    "thread_id": "app-thread",
    "session_epoch": 0,
    "user_id": "11111111-1111-1111-1111-111111111111",
    "workspace_id": "22222222-2222-2222-2222-222222222222",
    "timezone": "America/Sao_Paulo",
}


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _grafo(monkeypatch, instantaneo, *, explode=False):
    """Dublê de `graph()`, gravando o config que recebeu."""
    vistos: list[dict] = []

    async def aget_state(config):
        vistos.append(config)
        if explode:
            raise RuntimeError("conexão caiu")
        return instantaneo

    import app.graph.build as build_mod

    monkeypatch.setattr(build_mod, "graph", lambda: SimpleNamespace(aget_state=aget_state))
    return vistos


@pytest.mark.asyncio
async def test_reaproveita_a_resposta_do_mesmo_turno(monkeypatch):
    instantaneo = SimpleNamespace(
        values={"source_message_id": "app:abc", "reply": "R$ 1.234,00", "results": []},
        interrupts=[],
    )
    _grafo(monkeypatch, instantaneo)

    async def sem_rascunho(session_id):
        return None

    monkeypatch.setattr(conversation.db, "open_draft", sem_rascunho)

    resposta = await conversation.recover_turn(SESSAO, source_message_id="app:abc")
    assert resposta == "R$ 1.234,00"


@pytest.mark.asyncio
async def test_checkpoint_de_OUTRO_turno_nao_serve(monkeypatch):
    """A trava do mecanismo. Sem ela, um retry com UUID novo receberia a resposta
    do turno anterior — pior que reexecutar e pior que devolver erro."""
    instantaneo = SimpleNamespace(
        values={"source_message_id": "app:anterior", "reply": "resposta velha"},
        interrupts=[],
    )
    _grafo(monkeypatch, instantaneo)

    assert await conversation.recover_turn(SESSAO, source_message_id="app:novo") is None


@pytest.mark.asyncio
async def test_thread_sem_checkpoint_devolve_none(monkeypatch):
    _grafo(monkeypatch, SimpleNamespace(values={}, interrupts=[]))
    assert await conversation.recover_turn(SESSAO, source_message_id="app:abc") is None


@pytest.mark.asyncio
async def test_turno_pausado_no_HITL_devolve_a_pergunta(monkeypatch):
    """O turno que parou num `interrupt()` também já rodou: reexecutar faria a
    mesma pergunta duas vezes e deixaria duas pendências."""
    pausa = {
        "summary": "apagar o gasto de R$ 45",
        "reason": "delete",
        "action_type": "delete_transaction",
        "options": [],
    }
    instantaneo = SimpleNamespace(
        values={"source_message_id": "app:abc"},
        interrupts=[SimpleNamespace(value=pausa)],
    )
    _grafo(monkeypatch, instantaneo)

    async def open_pending(session_id):
        return {"id": "p1", "thread_id": "app-thread"}

    monkeypatch.setattr(conversation.db, "open_pending", open_pending)

    resposta = await conversation.recover_turn(SESSAO, source_message_id="app:abc")
    assert resposta, "a pergunta pendente se perdeu na recuperação"
    assert "45" in (resposta if isinstance(resposta, str) else resposta.get("body", ""))


@pytest.mark.asyncio
async def test_falha_ao_ler_o_checkpoint_nao_derruba_o_turno(monkeypatch):
    """Recuperação é otimização: se ela falhar, o caminho normal ainda existe."""
    _grafo(monkeypatch, None, explode=True)
    assert await conversation.recover_turn(SESSAO, source_message_id="app:abc") is None


# ---------------------------------------------------------------------------
# histórico do WhatsApp: ele mora no checkpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_historico_do_whatsapp_sai_do_checkpoint_ja_cortado(monkeypatch):
    anteriores = []
    for i in range(8):  # 8 pares: mais que a janela de 5 do WhatsApp
        anteriores.append({"role": "user", "content": f"u{i}"})
        anteriores.append({"role": "assistant", "content": f"a{i}"})

    sessao = {**SESSAO, "channel": "whatsapp", "thread_id": "hash", "session_epoch": 2}
    _grafo(monkeypatch, SimpleNamespace(values={"messages": anteriores}, interrupts=[]))

    historico = await conversation.load_prompt_history(sessao)
    assert len(historico) == 10, "a janela do WhatsApp (5 pares) não foi aplicada"
    assert historico[-1]["content"] == "a7"


@pytest.mark.asyncio
async def test_historico_usa_o_thread_COM_epoch(monkeypatch):
    """O epoch faz parte do thread efetivo. Ler o thread sem ele traria a
    conversa de antes da rotação — memória que o usuário já não espera."""
    sessao = {**SESSAO, "channel": "whatsapp", "thread_id": "hash", "session_epoch": 3}
    vistos = _grafo(monkeypatch, SimpleNamespace(values={"messages": []}, interrupts=[]))

    await conversation.load_prompt_history(sessao)
    assert vistos[0]["configurable"]["thread_id"] == "hash:3"


@pytest.mark.asyncio
async def test_thread_novo_comeca_sem_historico(monkeypatch):
    _grafo(monkeypatch, SimpleNamespace(values={}, interrupts=[]))
    assert await conversation.load_prompt_history(SESSAO) == []


# ---------------------------------------------------------------------------
# apagar a conversa leva a memória junto
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_thread_apaga_o_checkpoint(monkeypatch):
    import app.graph.build as build_mod

    apagados: list[str] = []

    async def adelete_thread(thread_id):
        apagados.append(thread_id)

    monkeypatch.setattr(
        build_mod, "_checkpointer", SimpleNamespace(adelete_thread=adelete_thread)
    )
    await build_mod.delete_thread("app-thread")
    assert apagados == ["app-thread"]


@pytest.mark.asyncio
async def test_delete_thread_sem_checkpointer_falha_alto(monkeypatch):
    """Silêncio aqui deixaria a memória de uma conversa excluída no banco, e o
    `thread_id` reciclado herdaria o contexto do que foi apagado."""
    import app.graph.build as build_mod

    monkeypatch.setattr(build_mod, "_checkpointer", None)
    with pytest.raises(RuntimeError):
        await build_mod.delete_thread("app-thread")
