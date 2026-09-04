"""A camada de conversa do app: persistir turno, deduplicar e serializar.

Três coisas que o WhatsApp não precisava e o app precisa:

1. **Dedupe pelo UUID do cliente.** A rede do celular cai no meio do POST o
   tempo todo. O app reenvia o MESMO UUID, e reenviar não pode virar um segundo
   lançamento — é a mesma regra do `wa_message_id` da Meta, com a chave gerada
   do outro lado.
2. **Lease por conversa.** Dois turnos simultâneos na mesma conversa correriam
   em cima do mesmo checkpoint. O WhatsApp resolvia isso com o claim da fila;
   aqui não há fila.
3. **Recuperação antes de reexecutar.** Um turno que rodou e não conseguiu
   gravar já escreveu no banco. Reexecutar duplicaria.

Sem banco: o repositório é um dublê que guarda dicionários.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from app import app_chat
from app.config import get_settings

USER = UUID("11111111-1111-1111-1111-111111111111")
WORKSPACE = UUID("22222222-2222-2222-2222-222222222222")
OUTRO_USER = UUID("99999999-9999-9999-9999-999999999999")

AGORA = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("APP_TURN_LEASE_SECONDS", "300")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class RepoFalso:
    """O banco, em memória. Só o que `app_chat` usa."""

    def __init__(self):
        self.sessoes: dict[UUID, dict] = {}
        self.mensagens: list[dict] = []
        self.pendentes: list[dict] = []
        self.threads_apagadas: list[str] = []
        self.agora = AGORA
        self.turnos: list[dict] = []          # chamadas a run_turn
        self.recuperacoes: list[str] = []     # chamadas a recover_turn
        self.recuperavel: str | dict | None = None

    # --- perfil ---
    async def chat_profile(self, user_id):
        if user_id == OUTRO_USER:
            return {"id": OUTRO_USER, "workspace_id": UUID(int=7),
                    "timezone": "America/Sao_Paulo"}
        return {"id": user_id, "workspace_id": WORKSPACE, "timezone": "America/Bahia"}

    # --- sessões ---
    async def create_chat_session(self, *, user_id, workspace_id, title,
                             first_client_message_id, thread_id, timezone_):
        existente = next(
            (s for s in self.sessoes.values()
             if s["user_id"] == user_id
             and s["first_client_message_id"] == first_client_message_id),
            None,
        )
        if existente:
            return existente, False
        sid = uuid4()
        s = {"id": sid, "user_id": user_id, "workspace_id": workspace_id,
             "channel": "app", "phone": None, "title": title, "thread_id": thread_id,
             "first_client_message_id": first_client_message_id,
             "timezone": timezone_, "session_epoch": 0, "last_message_at": self.agora,
             "lease_message_id": None, "lease_expires_at": None, "deleting_at": None}
        self.sessoes[sid] = s
        return s, True

    async def chat_session(self, session_id, user_id):
        s = self.sessoes.get(session_id)
        if not s or s["user_id"] != user_id or s["deleting_at"]:
            return None
        return s

    async def claim_chat_turn(self, *, session_id, user_id, client_message_id, content):
        """Ou reserva o turno, ou diz por que não."""
        s = await self.chat_session(session_id, user_id)
        if s is None:
            raise app_chat.ConversationNotFound()

        ja = next((m for m in self.mensagens
                   if m["session_id"] == session_id
                   and m["client_message_id"] == client_message_id), None)
        anterior = ja is not None

        vivo = s["lease_expires_at"] and s["lease_expires_at"] > self.agora
        if vivo and (ja is None or s["lease_message_id"] != ja["id"]):
            raise app_chat.ConversationBusy()

        if ja and ja["status"] == "completed":
            resposta = next((m for m in self.mensagens if m["in_reply_to"] == ja["id"]), None)
            return app_chat.TurnClaim("completed", s, ja, resposta)
        if ja and ja["status"] == "processing" and vivo:
            return app_chat.TurnClaim("processing", s, ja, None)

        if ja is None:
            ja = {"id": uuid4(), "session_id": session_id,
                  "client_message_id": client_message_id, "role": "user",
                  "content": content, "in_reply_to": None, "status": "processing",
                  "error_code": None, "ui_payload": None, "sequence": len(self.mensagens)}
            self.mensagens.append(ja)
        else:
            ja["status"] = "processing"
            ja["error_code"] = None

        s["lease_message_id"] = ja["id"]
        s["lease_expires_at"] = self.agora + timedelta(seconds=300)
        # `retry` é o que faz a borda tentar recuperar o checkpoint antes de
        # reexecutar: só existe quando a mensagem JÁ estava na tabela.
        return app_chat.TurnClaim("run", s, ja, None, retry=anterior)

    async def chat_prompt_history(self, session_id):
        return [
            {"role": m["role"], "content": m["content"]}
            for m in self.mensagens
            if m["session_id"] == session_id and m["status"] == "completed"
        ]

    async def finish_chat_turn(self, *, session_id, user_message_id, content, ui_payload):
        resposta = {"id": uuid4(), "session_id": session_id, "client_message_id": None,
                    "role": "assistant", "content": content, "in_reply_to": user_message_id,
                    "status": "completed", "error_code": None, "ui_payload": ui_payload,
                    "sequence": len(self.mensagens)}
        self.mensagens.append(resposta)
        for m in self.mensagens:
            if m["id"] == user_message_id:
                m["status"] = "completed"
        s = self.sessoes[session_id]
        s["last_message_at"] = self.agora
        s["lease_message_id"] = None
        s["lease_expires_at"] = None
        return resposta

    async def fail_chat_turn(self, *, session_id, user_message_id, error_code):
        for m in self.mensagens:
            if m["id"] == user_message_id:
                m["status"] = "failed"
                m["error_code"] = error_code
        s = self.sessoes[session_id]
        s["lease_message_id"] = None
        s["lease_expires_at"] = None

    async def open_pending(self, session_id):
        return next((p for p in self.pendentes if p["session_id"] == session_id
                     and p["status"] == "awaiting"), None)

    async def mark_chat_deleting(self, session_id, user_id):
        s = await self.chat_session(session_id, user_id)
        if s is None:
            raise app_chat.ConversationNotFound()
        if s["lease_expires_at"] and s["lease_expires_at"] > self.agora:
            raise app_chat.ConversationBusy()
        s["deleting_at"] = self.agora
        return s

    async def drop_chat_session(self, session_id):
        self.sessoes.pop(session_id, None)
        self.mensagens = [m for m in self.mensagens if m["session_id"] != session_id]


@pytest.fixture
def repo(monkeypatch):
    r = RepoFalso()
    monkeypatch.setattr(app_chat, "repo", r)

    async def run_turn(sessao, *, source_message_id, conteudo, prompt_history=None):
        r.turnos.append({"session": sessao, "source_message_id": source_message_id,
                         "conteudo": conteudo, "history": prompt_history})
        return "R$ 1.234,00"

    async def recover_turn(sessao, *, source_message_id):
        r.recuperacoes.append(source_message_id)
        return r.recuperavel

    async def delete_thread(thread_id):
        r.threads_apagadas.append(thread_id)

    async def sem_limite(sessao):
        return None

    monkeypatch.setattr(app_chat.conversation, "run_turn", run_turn)
    monkeypatch.setattr(app_chat.conversation, "recover_turn", recover_turn)
    monkeypatch.setattr(app_chat.conversation, "check_limits", sem_limite)
    monkeypatch.setattr(app_chat, "delete_thread", delete_thread)
    return r


# ---------------------------------------------------------------------------
# 1. título
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("gastei 45 no mercado", "gastei 45 no mercado"),
        ("primeira linha\nsegunda linha", "primeira linha"),
        ("  espaços    demais   colapsam  ", "espaços demais colapsam"),
        ("a" * 60, "a" * 48),
        ("\n\n  \nquanto gastei?", "quanto gastei?"),
    ],
)
def test_titulo_automatico(texto, esperado):
    assert app_chat.derive_title(texto) == esperado


def test_titulo_de_texto_vazio_tem_fallback():
    """Título é `not null` no banco: string vazia viraria 500 na criação."""
    assert app_chat.derive_title("   ").strip()


# ---------------------------------------------------------------------------
# 2 e 3. criação
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criacao_deriva_workspace_e_fuso_do_usuario(repo):
    r = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="gastei 45 no mercado"
    )

    assert r.status == "completed"
    assert r.conversation["workspace_id"] == WORKSPACE
    assert r.conversation["timezone"] == "America/Bahia"
    assert r.conversation["title"] == "gastei 45 no mercado"
    # a conversa nasce COM a primeira mensagem: uma conversa vazia na lista é
    # lixo que o usuário não criou de propósito
    assert r.user_message["content"] == "gastei 45 no mercado"
    assert r.assistant_message["content"] == "R$ 1.234,00"


@pytest.mark.asyncio
async def test_criacao_com_o_mesmo_uuid_devolve_a_mesma_conversa(repo):
    cid = uuid4()
    a = await app_chat.create_conversation(
        user_id=USER, client_message_id=cid, content="oi"
    )
    b = await app_chat.create_conversation(
        user_id=USER, client_message_id=cid, content="oi"
    )

    assert a.conversation["id"] == b.conversation["id"]
    assert len(repo.sessoes) == 1, "o retry criou uma segunda conversa"


# ---------------------------------------------------------------------------
# 4 a 8. dedupe e recuperação
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uuid_ja_completo_devolve_a_resposta_persistida(repo):
    cid = uuid4()
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=cid, content="quanto gastei?"
    )
    sid = inicial.conversation["id"]
    repo.turnos.clear()

    outro = uuid4()
    await app_chat.send_message(
        user_id=USER, session_id=sid, client_message_id=outro, content="e no mercado?"
    )
    repo.turnos.clear()

    r = await app_chat.send_message(
        user_id=USER, session_id=sid, client_message_id=outro, content="e no mercado?"
    )
    assert r.status == "completed"
    assert r.assistant_message["content"] == "R$ 1.234,00"
    assert repo.turnos == [], "um UUID repetido rodou o grafo de novo"


@pytest.mark.asyncio
async def test_uuid_em_processamento_nao_roda_um_segundo_grafo(repo):
    cid = uuid4()
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=cid, content="oi"
    )
    sid = inicial.conversation["id"]

    em_curso = uuid4()
    msg = {"id": uuid4(), "session_id": sid, "client_message_id": em_curso,
           "role": "user", "content": "demorado", "in_reply_to": None,
           "status": "processing", "error_code": None, "ui_payload": None, "sequence": 9}
    repo.mensagens.append(msg)
    repo.sessoes[sid]["lease_message_id"] = msg["id"]
    repo.sessoes[sid]["lease_expires_at"] = repo.agora + timedelta(seconds=120)
    repo.turnos.clear()

    r = await app_chat.send_message(
        user_id=USER, session_id=sid, client_message_id=em_curso, content="demorado"
    )
    assert r.status == "processing"
    assert r.assistant_message is None
    assert repo.turnos == []


@pytest.mark.asyncio
async def test_turno_falho_recupera_o_checkpoint_antes_de_reexecutar(repo):
    """O turno rodou e escreveu no banco; só a persistência HTTP falhou.
    Reexecutar duplicaria o lançamento."""
    cid = uuid4()
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=cid, content="oi"
    )
    sid = inicial.conversation["id"]

    falho = uuid4()
    repo.mensagens.append(
        {"id": uuid4(), "session_id": sid, "client_message_id": falho, "role": "user",
         "content": "gastei 45", "in_reply_to": None, "status": "failed",
         "error_code": "internal", "ui_payload": None, "sequence": 9}
    )
    repo.recuperavel = "✅ Anotei: R$ 45,00 no mercado."
    repo.turnos.clear()

    r = await app_chat.send_message(
        user_id=USER, session_id=sid, client_message_id=falho, content="gastei 45"
    )

    assert repo.recuperacoes == [f"app:{falho}"]
    assert repo.turnos == [], "o turno recuperado rodou o grafo de novo e duplicaria"
    assert r.assistant_message["content"] == "✅ Anotei: R$ 45,00 no mercado."


@pytest.mark.asyncio
async def test_turno_falho_sem_checkpoint_tenta_de_novo_com_a_mesma_chave(repo):
    cid = uuid4()
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=cid, content="oi"
    )
    sid = inicial.conversation["id"]

    falho = uuid4()
    repo.mensagens.append(
        {"id": uuid4(), "session_id": sid, "client_message_id": falho, "role": "user",
         "content": "gastei 45", "in_reply_to": None, "status": "failed",
         "error_code": "internal", "ui_payload": None, "sequence": 9}
    )
    repo.recuperavel = None
    repo.turnos.clear()

    r = await app_chat.send_message(
        user_id=USER, session_id=sid, client_message_id=falho, content="gastei 45"
    )

    assert len(repo.turnos) == 1
    # a MESMA chave: a reserva em `executed_actions` continua valendo e a
    # retentativa não pode duplicar o que a primeira já executou
    assert repo.turnos[0]["source_message_id"] == f"app:{falho}"
    assert r.status == "completed"


@pytest.mark.asyncio
async def test_a_chave_do_motor_e_o_uuid_prefixado(repo):
    cid = uuid4()
    await app_chat.create_conversation(user_id=USER, client_message_id=cid, content="oi")

    assert repo.turnos[0]["source_message_id"] == f"app:{cid}"
    # o UUID CRU continua na tabela e na API: o prefixo é do motor
    assert repo.mensagens[0]["client_message_id"] == cid


@pytest.mark.asyncio
async def test_historico_do_prompt_leva_so_o_que_completou_nesta_conversa(repo):
    a = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="quanto gastei?"
    )
    b = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="outra conversa"
    )
    repo.turnos.clear()

    await app_chat.send_message(
        user_id=USER, session_id=a.conversation["id"],
        client_message_id=uuid4(), content="e no mercado?",
    )

    historico = repo.turnos[0]["history"]
    textos = [m["content"] for m in historico]
    assert "quanto gastei?" in textos
    assert "outra conversa" not in textos, "o histórico atravessou conversas"
    assert "e no mercado?" not in textos, (
        "a mensagem do turno atual entra no estado, não no histórico"
    )
    assert len(historico) <= 20, "a janela de 10 pares do app não foi aplicada"
    _ = b


# ---------------------------------------------------------------------------
# 9 a 12. lease e falha
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outro_uuid_durante_lease_vivo_e_recusado(repo):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    repo.sessoes[sid]["lease_message_id"] = uuid4()
    repo.sessoes[sid]["lease_expires_at"] = repo.agora + timedelta(seconds=120)

    with pytest.raises(app_chat.ConversationBusy):
        await app_chat.send_message(
            user_id=USER, session_id=sid, client_message_id=uuid4(), content="atropelo"
        )


@pytest.mark.asyncio
async def test_lease_vencido_pode_ser_readquirido(repo):
    """Sem isso, um container que morre no meio prende a conversa para sempre."""
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    repo.sessoes[sid]["lease_message_id"] = uuid4()
    repo.sessoes[sid]["lease_expires_at"] = repo.agora - timedelta(seconds=1)

    r = await app_chat.send_message(
        user_id=USER, session_id=sid, client_message_id=uuid4(), content="segue"
    )
    assert r.status == "completed"


@pytest.mark.asyncio
async def test_sucesso_persiste_a_resposta_e_so_entao_solta_o_lease(repo):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    assert repo.sessoes[sid]["lease_expires_at"] is None
    assert repo.mensagens[-1]["role"] == "assistant"
    assert repo.mensagens[-1]["in_reply_to"] == repo.mensagens[-2]["id"]
    assert repo.mensagens[-2]["status"] == "completed"


@pytest.mark.asyncio
async def test_erro_marca_failed_com_codigo_seguro_e_solta_o_lease(repo, monkeypatch):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]

    async def explode(sessao, **kwargs):
        raise RuntimeError(
            'psycopg.errors: insert into public.transactions ... DATABASE_URL=postgres://u:senha@h'
        )

    monkeypatch.setattr(app_chat.conversation, "run_turn", explode)

    with pytest.raises(app_chat.TurnFailed) as err:
        await app_chat.send_message(
            user_id=USER, session_id=sid, client_message_id=uuid4(), content="quebra"
        )

    assert err.value.code == "internal"
    assert "senha" not in str(err.value)
    assert "transactions" not in str(err.value), "SQL vazou para o cliente"

    ruim = [m for m in repo.mensagens if m["status"] == "failed"]
    assert len(ruim) == 1
    assert ruim[0]["error_code"] == "internal"
    assert repo.sessoes[sid]["lease_expires_at"] is None, "o lease ficou preso após o erro"


# ---------------------------------------------------------------------------
# 13. cota
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cota_mensal_e_rajada_viram_codigos_diferentes(repo, monkeypatch):
    """O app abre paywall no mês e pede para esperar na rajada: mesma recusa com
    o mesmo código faria a tela oferecer upgrade para quem só mandou rápido."""
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    repo.turnos.clear()

    async def rajada(sessao):
        return app_chat.conversation.MUITAS

    monkeypatch.setattr(app_chat.conversation, "check_limits", rajada)
    with pytest.raises(app_chat.RateLimit):
        await app_chat.send_message(
            user_id=USER, session_id=sid, client_message_id=uuid4(), content="x"
        )

    async def plano(sessao):
        return "📊 Você usou as 100 mensagens do plano free este mês."

    monkeypatch.setattr(app_chat.conversation, "check_limits", plano)
    with pytest.raises(app_chat.PlanLimit):
        await app_chat.send_message(
            user_id=USER, session_id=sid, client_message_id=uuid4(), content="x"
        )

    assert repo.turnos == [], "o limite não impediu a chamada ao motor"


@pytest.mark.asyncio
async def test_limite_nao_deixa_a_mensagem_presa_em_processing(repo, monkeypatch):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]

    async def plano(sessao):
        return "📊 Você usou as 100 mensagens do plano free este mês."

    monkeypatch.setattr(app_chat.conversation, "check_limits", plano)
    with pytest.raises(app_chat.PlanLimit):
        await app_chat.send_message(
            user_id=USER, session_id=sid, client_message_id=uuid4(), content="x"
        )

    assert repo.sessoes[sid]["lease_expires_at"] is None
    assert not any(m["status"] == "processing" for m in repo.mensagens)


# ---------------------------------------------------------------------------
# 14. HITL
# ---------------------------------------------------------------------------


def _pendencia(repo, sid, candidatos=()):
    # `pending_actions_one_open_per_session` (0055) só deixa UMA aberta por
    # conversa. O dublê respeita isso, senão o teste provaria algo que o banco
    # não permite.
    for antiga in repo.pendentes:
        if antiga["session_id"] == sid:
            antiga["status"] = "resolved"
    p = {"id": uuid4(), "session_id": sid, "thread_id": "t", "status": "awaiting",
         "action": {"candidates": list(candidatos)}, "summary": "apagar o gasto"}
    repo.pendentes.append(p)
    return p


@pytest.mark.asyncio
async def test_pendencia_inventada_nunca_chama_o_motor(repo):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    repo.turnos.clear()

    with pytest.raises(app_chat.PendingInvalid):
        await app_chat.resolve_pending(
            user_id=USER, session_id=inicial.conversation["id"],
            pending_id=uuid4(), client_message_id=uuid4(), decision="approve",
        )
    assert repo.turnos == []


@pytest.mark.asyncio
async def test_pendencia_de_OUTRA_conversa_nunca_chama_o_motor(repo):
    a = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    b = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="outra"
    )
    p = _pendencia(repo, b.conversation["id"])
    repo.turnos.clear()

    with pytest.raises(app_chat.PendingInvalid):
        await app_chat.resolve_pending(
            user_id=USER, session_id=a.conversation["id"], pending_id=p["id"],
            client_message_id=uuid4(), decision="approve",
        )
    assert repo.turnos == []


@pytest.mark.asyncio
async def test_candidato_fora_da_lista_congelada_nunca_chama_o_motor(repo):
    """A lista de candidatos é congelada na pergunta. Aceitar um id de fora dela
    seria deixar o cliente escolher qual registro apagar."""
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    p = _pendencia(repo, sid, candidatos=[{"id": "tx-1", "label": "R$ 45 mercado"}])
    repo.turnos.clear()

    with pytest.raises(app_chat.PendingInvalid):
        await app_chat.resolve_pending(
            user_id=USER, session_id=sid, pending_id=p["id"],
            client_message_id=uuid4(), decision="choose", candidate_id="tx-999",
        )
    assert repo.turnos == []


@pytest.mark.asyncio
async def test_decisao_vira_o_clique_que_o_confirm_ja_entende(repo):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    p = _pendencia(repo, sid, candidatos=[{"id": "tx-1", "label": "R$ 45 mercado"}])
    repo.turnos.clear()

    await app_chat.resolve_pending(
        user_id=USER, session_id=sid, pending_id=p["id"],
        client_message_id=uuid4(), decision="approve",
    )
    assert repo.turnos[-1]["conteudo"]["clicked_id"] == f"pa:{p['id']}:ok"

    p2 = _pendencia(repo, sid, candidatos=[{"id": "tx-1", "label": "R$ 45 mercado"}])
    await app_chat.resolve_pending(
        user_id=USER, session_id=sid, pending_id=p2["id"],
        client_message_id=uuid4(), decision="choose", candidate_id="tx-1",
    )
    assert repo.turnos[-1]["conteudo"]["clicked_id"] == f"pa:{p2['id']}:c:tx-1"

    p3 = _pendencia(repo, sid)
    await app_chat.resolve_pending(
        user_id=USER, session_id=sid, pending_id=p3["id"],
        client_message_id=uuid4(), decision="reject",
    )
    assert repo.turnos[-1]["conteudo"]["clicked_id"] == f"pa:{p3['id']}:no"


# ---------------------------------------------------------------------------
# 15. exclusão
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_exclusao_apaga_checkpoint_antes_de_remover_a_sessao(repo):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    thread = repo.sessoes[sid]["thread_id"]

    await app_chat.delete_conversation(user_id=USER, session_id=sid)

    assert repo.threads_apagadas == [thread], "a memória da conversa ficou no banco"
    assert sid not in repo.sessoes
    assert not [m for m in repo.mensagens if m["session_id"] == sid]


@pytest.mark.asyncio
async def test_exclusao_com_turno_rodando_e_recusada(repo):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]
    repo.sessoes[sid]["lease_expires_at"] = repo.agora + timedelta(seconds=60)

    with pytest.raises(app_chat.ConversationBusy):
        await app_chat.delete_conversation(user_id=USER, session_id=sid)
    assert repo.threads_apagadas == []


@pytest.mark.asyncio
async def test_conversa_de_outro_usuario_nao_existe(repo):
    inicial = await app_chat.create_conversation(
        user_id=USER, client_message_id=uuid4(), content="oi"
    )
    sid = inicial.conversation["id"]

    with pytest.raises(app_chat.ConversationNotFound):
        await app_chat.send_message(
            user_id=OUTRO_USER, session_id=sid,
            client_message_id=uuid4(), content="me deixa ver",
        )
    with pytest.raises(app_chat.ConversationNotFound):
        await app_chat.delete_conversation(user_id=OUTRO_USER, session_id=sid)
