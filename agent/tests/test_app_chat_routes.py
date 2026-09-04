"""A borda HTTP da aba Agente.

Duas coisas que só esta camada pode errar, e as duas são caras:

1. **O que SAI.** A linha de `user_sessions` carrega telefone, `thread_id`,
   lease e `workspace_id`. O desenho diz que o app nunca vê nada disso —
   `**row` numa resposta entregaria os quatro de uma vez.
2. **O que ENTRA.** `user_id` sai do `sub` do JWT e de nenhum outro lugar. A
   `import-statement` antiga lia `user_id` do corpo e por isso qualquer
   autenticado importava para o workspace de outro.

Sem banco e sem rede: `app_chat` é dublado e a autenticação é sobrescrita pela
dependência do FastAPI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import app_chat
from app.config import get_settings
from app.routes import chat as chat_routes

USER = UUID("11111111-1111-1111-1111-111111111111")
SID = UUID("33333333-3333-3333-3333-333333333333")
AGORA = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)


def _sessao(**extra):
    """A linha CRUA do banco, com tudo que ela realmente carrega."""
    return {
        "id": SID, "title": "Contas do mês", "last_message_at": AGORA,
        "created_at": AGORA, "user_id": USER, "workspace_id": uuid4(),
        "channel": "app", "phone": None, "thread_id": "app-segredo",
        "first_client_message_id": uuid4(), "lease_message_id": None,
        "lease_expires_at": None, "deleting_at": None, "session_epoch": 0,
        "timezone": "America/Bahia", "debounce_task_name": None,
        **extra,
    }


def _mensagem(role="user", **extra):
    return {
        "id": uuid4(), "session_id": SID, "sequence": 1,
        "client_message_id": uuid4() if role == "user" else None,
        "role": role, "content": "gastei 45 no mercado", "ui_payload": None,
        "in_reply_to": None, "status": "completed", "error_code": None,
        "created_at": AGORA, "completed_at": AGORA,
        **extra,
    }


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(chat_routes.router)
    chat_routes.install_error_handlers(app)
    app.dependency_overrides[chat_routes.current_user] = lambda: USER
    return TestClient(app)


@pytest.fixture
def falso(monkeypatch):
    """Grava as chamadas e devolve o que o teste mandar."""
    estado = {"chamadas": [], "resultado": None, "erro": None}

    def _stub(nome):
        async def f(**kwargs):
            estado["chamadas"].append((nome, kwargs))
            if estado["erro"]:
                raise estado["erro"]
            return estado["resultado"]
        return f

    for nome in ("create_conversation", "send_message", "resolve_pending",
                 "delete_conversation"):
        monkeypatch.setattr(app_chat, nome, _stub(nome))

    async def lista(**kwargs):
        estado["chamadas"].append(("list", kwargs))
        if estado["erro"]:
            raise estado["erro"]
        # respeita o `limit + 1` que a rota pede: é assim que ela descobre se há
        # próxima página, e um dublê que ignora isso nunca produz cursor
        return estado.get("conversas", [])[: kwargs.get("limit")]

    async def mensagens(**kwargs):
        estado["chamadas"].append(("messages", kwargs))
        if estado["erro"]:
            raise estado["erro"]
        return estado.get("mensagens", [])[: kwargs.get("limit")]

    async def renomear(**kwargs):
        estado["chamadas"].append(("rename", kwargs))
        if estado["erro"]:
            raise estado["erro"]
        return estado.get("conversa")

    monkeypatch.setattr(app_chat, "list_conversations", lista, raising=False)
    monkeypatch.setattr(app_chat, "list_messages", mensagens, raising=False)
    monkeypatch.setattr(app_chat, "rename_conversation", renomear, raising=False)
    return estado


def _turno(status="completed"):
    return app_chat.TurnResult(
        status=status,
        conversation=_sessao(),
        user_message=_mensagem(),
        assistant_message=_mensagem(role="assistant", content="R$ 1.234,00")
        if status == "completed" else None,
    )


# ---------------------------------------------------------------------------
# o que SAI: nada de estado interno
# ---------------------------------------------------------------------------

INTERNO = {"phone", "thread_id", "lease_message_id", "lease_expires_at",
           "first_client_message_id", "workspace_id", "session_epoch",
           "debounce_task_name", "deleting_at", "user_id", "channel"}


def _sem_interno(obj, caminho="raiz"):
    if isinstance(obj, dict):
        vazando = INTERNO & set(obj)
        assert not vazando, f"{caminho} vazou estado interno: {sorted(vazando)}"
        for k, v in obj.items():
            _sem_interno(v, f"{caminho}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _sem_interno(v, f"{caminho}[{i}]")


def test_criar_nao_devolve_telefone_thread_nem_lease(cliente, falso):
    falso["resultado"] = _turno()
    r = cliente.post("/internal/chat/conversations",
                     json={"client_message_id": str(uuid4()), "content": "gastei 45"})
    assert r.status_code == 200
    _sem_interno(r.json())
    assert "app-segredo" not in r.text, "o thread_id do checkpoint saiu na resposta"


def test_lista_nao_devolve_estado_interno(cliente, falso):
    falso["conversas"] = [_sessao(), _sessao(id=uuid4())]
    r = cliente.get("/internal/chat/conversations")
    assert r.status_code == 200
    _sem_interno(r.json())
    assert {"items", "next_cursor"} <= set(r.json())


def test_historico_nao_devolve_estado_interno(cliente, falso):
    falso["mensagens"] = [_mensagem(), _mensagem(role="assistant")]
    r = cliente.get(f"/internal/chat/conversations/{SID}/messages")
    assert r.status_code == 200
    _sem_interno(r.json())


# ---------------------------------------------------------------------------
# o que ENTRA: o corpo nunca decide de quem é a conversa
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "campo", ["user_id", "workspace_id", "thread_id", "phone", "channel", "session_id"]
)
def test_campo_de_escopo_no_corpo_e_recusado(cliente, falso, campo):
    """`extra='forbid'`. Ignorar em silêncio também seria seguro, mas recusar
    denuncia um cliente que ACHA que manda nisso."""
    falso["resultado"] = _turno()
    r = cliente.post(
        "/internal/chat/conversations",
        json={"client_message_id": str(uuid4()), "content": "oi", campo: str(uuid4())},
    )
    assert r.status_code == 422


def test_o_user_id_vem_do_token(cliente, falso):
    falso["resultado"] = _turno()
    cliente.post("/internal/chat/conversations",
                 json={"client_message_id": str(uuid4()), "content": "oi"})
    assert falso["chamadas"][0][1]["user_id"] == USER


# ---------------------------------------------------------------------------
# validação
# ---------------------------------------------------------------------------


def test_conteudo_vazio_e_recusado(cliente, falso):
    r = cliente.post("/internal/chat/conversations",
                     json={"client_message_id": str(uuid4()), "content": "   "})
    assert r.status_code == 422


def test_conteudo_acima_de_4000_e_recusado(cliente, falso):
    r = cliente.post("/internal/chat/conversations",
                     json={"client_message_id": str(uuid4()), "content": "x" * 4001})
    assert r.status_code == 422


def test_conteudo_de_4000_passa(cliente, falso):
    falso["resultado"] = _turno()
    r = cliente.post("/internal/chat/conversations",
                     json={"client_message_id": str(uuid4()), "content": "x" * 4000})
    assert r.status_code == 200


def test_titulo_acima_de_80_e_recusado(cliente, falso):
    r = cliente.patch(f"/internal/chat/conversations/{SID}", json={"title": "t" * 81})
    assert r.status_code == 422


def test_titulo_e_trimado(cliente, falso):
    falso["conversa"] = _sessao(title="Viagem")
    r = cliente.patch(f"/internal/chat/conversations/{SID}", json={"title": "  Viagem  "})
    assert r.status_code == 200
    assert falso["chamadas"][0][1]["title"] == "Viagem"


def test_uuid_invalido_e_422(cliente, falso):
    r = cliente.post("/internal/chat/conversations",
                     json={"client_message_id": "não-é-uuid", "content": "oi"})
    assert r.status_code == 422


def test_erro_de_validacao_usa_o_formato_da_api(cliente, falso):
    """O 422 padrão do FastAPI descreve o modelo interno campo a campo. Ele não
    é um erro do produto — e o app teria que aprender dois formatos."""
    r = cliente.post("/internal/chat/conversations", json={"content": ""})
    assert r.status_code == 422
    assert set(r.json()) == {"code", "message"}
    assert r.json()["code"] == "invalid_request"


# ---------------------------------------------------------------------------
# paginação
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("limite", [0, 51, -1, 999])
def test_limite_de_conversas_fora_da_faixa(cliente, falso, limite):
    r = cliente.get(f"/internal/chat/conversations?limit={limite}")
    assert r.status_code == 422


@pytest.mark.parametrize("limite", [0, 101, -5])
def test_limite_de_mensagens_fora_da_faixa(cliente, falso, limite):
    r = cliente.get(f"/internal/chat/conversations/{SID}/messages?limit={limite}")
    assert r.status_code == 422


def test_cursor_corrompido_e_recusado(cliente, falso):
    """Cursor é opaco. Aceitar lixo faria a query cair em erro de tipo lá no
    Postgres, e o 500 apareceria como falha do servidor."""
    r = cliente.get("/internal/chat/conversations?cursor=isso-nao-e-um-cursor")
    assert r.status_code == 422


def test_cursor_devolvido_volta_a_ser_aceito(cliente, falso):
    falso["conversas"] = [_sessao(id=uuid4()) for _ in range(30)]
    primeira = cliente.get("/internal/chat/conversations?limit=20").json()
    assert primeira["next_cursor"], "página cheia precisa de cursor"

    r = cliente.get(f"/internal/chat/conversations?cursor={primeira['next_cursor']}")
    assert r.status_code == 200


def test_pagina_incompleta_nao_tem_cursor(cliente, falso):
    falso["conversas"] = [_sessao()]
    assert cliente.get("/internal/chat/conversations?limit=20").json()["next_cursor"] is None


def test_before_de_mensagens_precisa_ser_numero(cliente, falso):
    r = cliente.get(f"/internal/chat/conversations/{SID}/messages?before=abc")
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# erros de domínio → HTTP
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "erro, status, codigo",
    [
        (app_chat.ConversationNotFound(), 404, "conversation_not_found"),
        (app_chat.ConversationBusy(), 409, "conversation_busy"),
        (app_chat.PlanLimit(), 402, "plan_limit"),
        (app_chat.RateLimit(), 429, "rate_limit"),
        (app_chat.PendingInvalid(), 422, "pending_invalid"),
        (app_chat.TurnFailed(), 500, "internal"),
    ],
)
def test_erro_de_dominio_vira_codigo_estavel(cliente, falso, erro, status, codigo):
    falso["erro"] = erro
    r = cliente.post(f"/internal/chat/conversations/{SID}/messages",
                     json={"client_message_id": str(uuid4()), "content": "oi"})
    assert r.status_code == status
    assert r.json() == {"code": codigo, "message": r.json()["message"]}


def test_erro_nunca_carrega_sql_nem_segredo(cliente, falso):
    falso["erro"] = app_chat.TurnFailed(
        "insert into public.transactions ... DATABASE_URL=postgres://u:senha@h"
    )
    r = cliente.post(f"/internal/chat/conversations/{SID}/messages",
                     json={"client_message_id": str(uuid4()), "content": "oi"})
    assert r.status_code == 500
    assert "senha" not in r.text and "transactions" not in r.text


def test_conversa_de_outro_dono_e_404_indistinguivel(cliente, falso):
    """404, não 403: um 403 confirmaria que a conversa EXISTE."""
    falso["erro"] = app_chat.ConversationNotFound()
    r = cliente.get(f"/internal/chat/conversations/{SID}/messages")
    assert r.status_code == 404
    assert r.json()["code"] == "conversation_not_found"


# ---------------------------------------------------------------------------
# turno em andamento e HITL
# ---------------------------------------------------------------------------


def test_turno_em_processamento_devolve_o_envelope(cliente, falso):
    falso["resultado"] = _turno("processing")
    r = cliente.post(f"/internal/chat/conversations/{SID}/messages",
                     json={"client_message_id": str(uuid4()), "content": "oi"})
    assert r.status_code == 200
    assert r.json()["status"] == "processing"
    assert r.json()["assistant_message"] is None


@pytest.mark.parametrize("decisao", ["approve", "reject", "choose"])
def test_decisoes_validas_chegam_ao_dominio(cliente, falso, decisao):
    falso["resultado"] = _turno()
    pid = uuid4()
    corpo = {"client_message_id": str(uuid4()), "decision": decisao}
    if decisao == "choose":
        corpo["candidate_id"] = "tx-1"
    r = cliente.post(f"/internal/chat/conversations/{SID}/actions/{pid}", json=corpo)
    assert r.status_code == 200
    assert falso["chamadas"][0][1]["decision"] == decisao


def test_decisao_fora_do_enum_e_422(cliente, falso):
    r = cliente.post(
        f"/internal/chat/conversations/{SID}/actions/{uuid4()}",
        json={"client_message_id": str(uuid4()), "decision": "talvez"},
    )
    assert r.status_code == 422


def test_choose_sem_candidato_e_422(cliente, falso):
    """A validação é do servidor: `choose` sem candidato chegaria ao domínio como
    uma escolha sem escolha."""
    r = cliente.post(
        f"/internal/chat/conversations/{SID}/actions/{uuid4()}",
        json={"client_message_id": str(uuid4()), "decision": "choose"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# exclusão
# ---------------------------------------------------------------------------


def test_exclusao_devolve_204_sem_corpo(cliente, falso):
    r = cliente.delete(f"/internal/chat/conversations/{SID}")
    assert r.status_code == 204
    assert not r.content


def test_exclusao_com_turno_rodando_e_409(cliente, falso):
    falso["erro"] = app_chat.ConversationBusy()
    r = cliente.delete(f"/internal/chat/conversations/{SID}")
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# autenticação
# ---------------------------------------------------------------------------


def test_sem_token_e_401_no_formato_da_api(monkeypatch):
    app = FastAPI()
    app.include_router(chat_routes.router)
    chat_routes.install_error_handlers(app)
    sem_auth = TestClient(app)

    r = sem_auth.get("/internal/chat/conversations")
    assert r.status_code == 401
    assert set(r.json()) == {"code", "message"}
