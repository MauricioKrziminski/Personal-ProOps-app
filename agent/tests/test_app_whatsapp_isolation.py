"""As duas memórias não se encostam — e a cota é uma só.

O produto passou a ter DOIS canais em cima do mesmo motor, e a coisa mais fácil
de quebrar em silêncio é justamente a que ninguém vê na tela: o que o modelo
recebeu como histórico. Um vazamento aqui não dá erro, não aparece em log e não
quebra teste nenhum — ele só faz o agente responder sobre um cartão que a pessoa
citou em OUTRA conversa, ou pior, no outro canal.

Por isso o dublê do grafo aqui **guarda estado por thread**, como o checkpointer
de verdade. Um dublê sem memória aceitaria qualquer `thread_id` e provaria
apenas que o teste passa.

O contraponto é a COTA: ela é deliberadamente compartilhada. Gastar pelo app tem
que gastar do mesmo saldo do WhatsApp, senão o plano vale o dobro para quem usa
os dois.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app import app_chat, conversation, worker
from app.config import get_settings
from tests.test_app_chat import USER, WORKSPACE, RepoFalso

TELEFONE = "5511999999999"
THREAD_WA = "wa-thread-do-telefone"


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("APP_TURN_LEASE_SECONDS", "300")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class GrafoFalso:
    """O grafo com memória POR THREAD — é o que torna o vazamento visível.

    `ainvoke` grava em `self.memoria[thread]` exatamente o que o estado trouxe,
    do jeito que o checkpointer faria; `aget_state` devolve de lá. Se o código
    passar o thread errado, o histórico errado aparece — que é o bug que este
    arquivo existe para pegar.
    """

    def __init__(self):
        self.memoria: dict[str, dict] = {}
        self.chamadas: list[tuple[dict, str]] = []

    async def ainvoke(self, entrada, config=None):
        thread = (config or {})["configurable"]["thread_id"]
        self.chamadas.append((entrada, thread))
        if not isinstance(entrada, dict):  # Command(resume=...) do HITL
            return {**self.memoria.get(thread, {}), "reply": "feito"}
        resposta = {"role": "assistant", "content": "certo"}
        estado = {
            **entrada,
            "reply": "certo",
            "llm_calls": 1,
            "messages": [*entrada.get("messages", []), resposta],
        }
        self.memoria[thread] = estado
        return estado

    async def aget_state(self, config):
        thread = config["configurable"]["thread_id"]
        return SimpleNamespace(values=self.memoria.get(thread, {}), interrupts=[])

    # --- o que os testes perguntam ---
    def estado_de(self, indice: int) -> dict:
        return self.chamadas[indice][0]

    def thread_de(self, indice: int) -> str:
        return self.chamadas[indice][1]

    def texto_visto(self, indice: int) -> str:
        """Tudo que o modelo teria lido naquela chamada, numa string só."""
        estado = self.estado_de(indice)
        if not isinstance(estado, dict):
            return ""
        return " ".join(str(m.get("content") or "") for m in estado.get("messages", []))


class DbFalso:
    """As pontas do banco que um turno encosta. Nenhuma delas fala com rede."""

    def __init__(self):
        self.eventos: list[dict] = []
        self.plano = {"plan": "free", "ai_messages_month": 0, "max_ai_messages_month": 50}
        self.na_hora = 0

    async def expire_drafts(self): ...
    async def open_draft(self, session_id): return None
    async def delete_draft(self, session_id): ...
    async def expire_pending(self, thread): ...
    async def open_pending(self, session_id): return None
    async def create_pending(self, **kw): return None

    async def record_ai_event(self, **kw):
        self.eventos.append(kw)

    async def ai_events_last_hour(self, user_id):
        return self.na_hora

    async def plan_status(self, workspace_id):
        return self.plano

    def canais(self) -> list[str]:
        return [e["channel"] for e in self.eventos]


@pytest.fixture
def mundo(monkeypatch):
    """App e WhatsApp em cima do MESMO motor, com o grafo e o banco dublados."""
    grafo = GrafoFalso()
    banco = DbFalso()
    repo = RepoFalso()

    import app.graph.build as build_mod

    monkeypatch.setattr(build_mod, "graph", lambda: grafo)
    monkeypatch.setattr(conversation, "db", banco)
    monkeypatch.setattr(app_chat, "repo", repo)
    monkeypatch.setattr(conversation, "telemetry", _TelemetriaMuda())
    return SimpleNamespace(grafo=grafo, db=banco, repo=repo)


class _TelemetriaMuda:
    """Langfuse não entra em teste: ele abriria conexão de rede."""

    def callbacks(self):
        return []

    def trace(self, **kw):
        from contextlib import nullcontext

        return nullcontext()


def sessao_whatsapp() -> dict:
    return {
        "id": uuid4(),
        "channel": "whatsapp",
        "phone": TELEFONE,
        "thread_id": THREAD_WA,
        "session_epoch": 0,
        "user_id": str(USER),
        "workspace_id": str(WORKSPACE),
        "timezone": "America/Bahia",
    }


async def turno_whatsapp(texto: str, sessao: dict | None = None) -> tuple[dict, str]:
    """Um turno pelo caminho do WhatsApp, com o histórico que ELE usa."""
    s = sessao or sessao_whatsapp()
    resposta = await conversation.run_turn(
        s,
        source_message_id=f"wamid.{uuid4().hex[:8]}",
        conteudo={"text": texto, "media": None, "raw_texts": [texto], "clicked_id": ""},
        prompt_history=await conversation.load_prompt_history(s),
    )
    return s, resposta


# ---------------------------------------------------------------------------
# 1. duas conversas do app não se veem
# ---------------------------------------------------------------------------


async def test_conversa_do_app_nao_ve_a_outra_conversa_do_app(mundo):
    a = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="meu cartão é o Nubank"
    )
    b = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="quanto gastei?"
    )
    await app_chat.send_message(
        user_id=USER,
        session_id=b.conversation["id"],
        client_message_id=uuid4(),
        content="e no outro?",
    )

    # A terceira chamada é a continuação em B. Ela não pode ter visto A.
    assert "Nubank" not in mundo.grafo.texto_visto(2)
    assert mundo.grafo.thread_de(0) != mundo.grafo.thread_de(1), (
        "duas conversas do app dividiram o mesmo thread do LangGraph"
    )
    # E B enxerga a PRÓPRIA história — senão o isolamento seria só amnésia.
    assert "quanto gastei?" in mundo.grafo.texto_visto(2)


# ---------------------------------------------------------------------------
# 2 e 3. os dois canais não se veem
# ---------------------------------------------------------------------------


async def test_app_nao_ve_o_que_foi_dito_no_whatsapp(mundo):
    await turno_whatsapp("meu cartão é o Itaú")

    r = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="e no outro?"
    )

    assert "Itaú" not in mundo.grafo.texto_visto(1)
    assert mundo.grafo.thread_de(1) != THREAD_WA
    assert r.status == "completed"


async def test_whatsapp_nao_ve_o_que_foi_dito_no_app(mundo):
    await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="meu cartão é o C6"
    )

    await turno_whatsapp("e no outro?")

    assert "C6" not in mundo.grafo.texto_visto(1)
    assert mundo.grafo.thread_de(1) == THREAD_WA


async def test_o_whatsapp_continua_lembrando_do_proprio_whatsapp(mundo):
    """O contrapeso dos dois anteriores: isolamento não pode virar amnésia."""
    s = sessao_whatsapp()
    await turno_whatsapp("meu cartão é o Itaú", s)
    await turno_whatsapp("e a fatura?", s)

    assert "Itaú" in mundo.grafo.texto_visto(1)


# ---------------------------------------------------------------------------
# 4. retry não reexecuta o que já rodou
# ---------------------------------------------------------------------------


async def test_retry_do_mesmo_uuid_nao_roda_o_grafo_de_novo(mundo, monkeypatch):
    """A tool já rodou e gravou; só a persistência caiu.

    Rodar de novo chamaria `reserve_execution` uma segunda vez e duplicaria o
    lançamento. A trava é o `source_message_id` gravado no checkpoint: o retry
    acha a resposta pronta e devolve ela, sem tocar no grafo.

    ⚠️ A exceção aqui é `RuntimeError` crua, e isso é comportamento real, não
    descuido do teste: o `try` de `_execute_turn` embrulha o GRAFO, não a
    persistência. Uma falha ao gravar sobe inteira e deixa a mensagem
    `processing` com o lease na mão — que é exatamente a janela para a qual o
    `recover_turn` existe.
    """
    cid = uuid4()
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=cid, content="gastei 45 no mercado"
    )
    sid = inicial.conversation["id"]

    segundo = uuid4()
    original = mundo.repo.finish_chat_turn

    async def cai(**kw):
        raise RuntimeError("conexão caiu depois do grafo")

    monkeypatch.setattr(mundo.repo, "finish_chat_turn", cai)
    with pytest.raises(RuntimeError):
        await app_chat.send_message(
            user_id=USER, session_id=sid, client_message_id=segundo,
            content="apaga o último",
        )
    monkeypatch.setattr(mundo.repo, "finish_chat_turn", original)

    # o container morreu no meio: o lease vence sozinho e outro assume
    mundo.repo.sessoes[sid]["lease_expires_at"] = None
    rodadas = len(mundo.grafo.chamadas)

    r = await app_chat.send_message(
        user_id=USER, session_id=sid, client_message_id=segundo, content="apaga o último"
    )

    assert r.status == "completed"
    assert r.assistant_message["content"] == "certo", "não veio do checkpoint"
    assert len(mundo.grafo.chamadas) == rodadas, (
        "o retry reexecutou o grafo — as tools rodariam duas vezes"
    )


# ---------------------------------------------------------------------------
# 5. dois aparelhos, um turno só
# ---------------------------------------------------------------------------


async def test_dois_aparelhos_com_uuids_diferentes_so_um_entra_no_grafo(mundo):
    """Os dois aparelhos escrevem ao mesmo tempo na MESMA conversa.

    UUIDs diferentes, então o dedupe não ajuda: quem segura é o lease. Sem ele
    os dois turnos correriam em cima do mesmo checkpoint e o segundo escreveria
    por cima da memória do primeiro.
    """
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]

    # o celular pegou a conversa e ainda está rodando
    mundo.repo.sessoes[sid]["lease_expires_at"] = mundo.repo.agora.replace(year=2030)
    mundo.repo.sessoes[sid]["lease_message_id"] = uuid4()
    rodadas = len(mundo.grafo.chamadas)

    with pytest.raises(app_chat.ConversationBusy):
        await app_chat.send_message(
            user_id=USER, session_id=sid, client_message_id=uuid4(), content="do tablet"
        )
    assert len(mundo.grafo.chamadas) == rodadas


# ---------------------------------------------------------------------------
# 6. o clique retoma a MESMA thread
# ---------------------------------------------------------------------------


async def test_clique_retoma_o_thread_gravado_no_pendente(mundo):
    """O resume tem que cair no thread em que o `interrupt()` aconteceu.

    Recalcular o thread na hora do clique é o bug clássico: a sessão pode ter
    girado de epoch no meio, e o resume cairia num checkpoint que não tem a
    pausa — o "sim" viraria uma mensagem nova.
    """
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="apaga o último"
    )
    sid = inicial.conversation["id"]
    pid = uuid4()
    mundo.repo.pendentes.append(
        {
            "id": pid,
            "session_id": sid,
            "thread_id": "thread-em-que-a-pausa-aconteceu",
            "status": "awaiting",
            "action": {"candidates": []},
            "summary": "apagar o gasto de R$ 45",
        }
    )
    # o motor lê a pendência pelo `db`, não pelo repositório do app
    mundo.db.open_pending = lambda session_id: _valor({
        "id": pid, "thread_id": "thread-em-que-a-pausa-aconteceu",
        "action": {"candidates": []}, "summary": "apagar o gasto de R$ 45",
    })
    mundo.db.resolve_pending = lambda *a, **k: _valor(None)

    await app_chat.resolve_pending(
        user_id=USER, session_id=sid, pending_id=pid,
        client_message_id=uuid4(), decision="approve",
    )

    assert mundo.grafo.thread_de(-1) == "thread-em-que-a-pausa-aconteceu"


async def _valor(v):
    return v


# ---------------------------------------------------------------------------
# 7. o canal fica gravado em ai_events
# ---------------------------------------------------------------------------


async def test_cada_canal_grava_o_proprio_nome_em_ai_events(mundo):
    await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="quanto gastei?"
    )
    await turno_whatsapp("quanto gastei?")

    assert mundo.db.canais() == ["app", "whatsapp"], (
        "o medidor por canal do plano sai daqui: canal errado conta no lugar errado"
    )


# ---------------------------------------------------------------------------
# 8. a cota é uma só
# ---------------------------------------------------------------------------


async def test_cota_estourada_barra_os_dois_canais(mundo, monkeypatch):
    """Um saldo só. Gastar pelo app tem que gastar do saldo do WhatsApp."""
    mundo.db.plano = {"plan": "free", "ai_messages_month": 50, "max_ai_messages_month": 50}

    with pytest.raises(app_chat.PlanLimit):
        await app_chat.create_conversation(
            user_id=USER, client_message_id=uuid4(), content="quanto gastei?"
        )

    barrado = await conversation.check_limits(sessao_whatsapp())
    assert barrado and "plano" in barrado
    assert mundo.grafo.chamadas == [], "gastou modelo depois de estourar a cota"


async def test_rajada_por_hora_barra_os_dois_canais(mundo):
    """A outra camada: ela protege CUSTO, e também não conhece canal."""
    mundo.db.na_hora = 10_000

    with pytest.raises(app_chat.RateLimit):
        await app_chat.create_conversation(
            user_id=USER, client_message_id=uuid4(), content="oi"
        )
    assert await conversation.check_limits(sessao_whatsapp()) == conversation.MUITAS
