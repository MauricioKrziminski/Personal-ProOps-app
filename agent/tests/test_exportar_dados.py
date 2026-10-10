"""Exportar os dados (LGPD): escopo por membro, exclusões, formato e limite de 3 por hora."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db
from app.config import get_settings
from app.routes import internal
from app.services import exportar_dados

USER = UUID("11111111-1111-1111-1111-111111111111")
OUTRO = UUID("99999999-9999-9999-9999-999999999999")
WS1, WS2, WS_ALHEIO = uuid4(), uuid4(), uuid4()


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    get_settings.cache_clear()
    internal._pedidos.clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def banco(monkeypatch):
    """Dublê de `db`: registra cada consulta e o escopo (args) com que foi feita."""
    est = {"consultas": []}

    async def fetch_one(sql, *a):
        est["consultas"].append((sql, a))
        if "join auth.users u on u.id = p.id" in sql:
            return {"p": {"id": str(a[0]), "phone": "5511955554441", "display_name": "Ana"},
                    "email": "ana@x.com", "auth_created_at": datetime(2026, 1, 2, tzinfo=timezone.utc)}
        return None

    async def fetch(sql, *a):
        est["consultas"].append((sql, a))
        if "information_schema.tables" in sql:  # o catálogo devolve até o que NÃO pode sair
            return [{"table_name": n} for n in ("transactions", "accounts", "messages_queue", "executed_actions",
                                                "pending_actions", "billing_events", "workspace_invites",
                                                "transaction_embeddings", "Bad;Name")]
        if "from public.workspace_members" in sql:
            return [{"workspace_id": WS1}, {"workspace_id": WS2}]
        if "from public.workspaces t" in sql:
            return [{"r": {"id": str(WS1), "name": "Pessoal"}}]
        if 'public."transactions"' in sql:
            return [{"r": {"id": "t1", "amount_cents": 4500, "description": "mercado"}}]
        if 'public."accounts"' in sql:
            return []
        if "app_chat_messages" in sql:
            return [{"r": {"id": "m1", "content": "gastei 45"}}]
        return []

    # onde cada consulta rodou: "rls" dentro de `sob_rls(user)`, "dono" fora dele
    est["onde"] = {}
    est["rls"] = []
    est["dentro"] = False
    fetch_base, fetch_one_base = fetch, fetch_one

    async def fetch(sql, *a):  # noqa: F811
        est["onde"][sql] = "rls" if est["dentro"] else "dono"
        return await fetch_base(sql, *a)

    async def fetch_one(sql, *a):  # noqa: F811
        est["onde"][sql] = "rls" if est["dentro"] else "dono"
        return await fetch_one_base(sql, *a)

    @asynccontextmanager
    async def uow():
        yield

    @asynccontextmanager
    async def sob_rls(user_id):
        est["rls"].append(user_id)
        est["dentro"] = True
        yield
        est["dentro"] = False

    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "unidade_de_trabalho", uow)
    monkeypatch.setattr(db, "sob_rls", sob_rls)
    return est


@pytest.mark.asyncio
async def test_escopo_e_membro_dos_espacos_e_nunca_de_outro(banco):
    dados = await exportar_dados.exportar(USER)
    por_tabela = [(s, a) for s, a in banco["consultas"] if 'public."transactions"' in s]
    assert por_tabela and por_tabela[0][1] == ([WS1, WS2],), "só os espaços de que ela é membro"
    todas = [a for _s, a in banco["consultas"]]
    assert all(WS_ALHEIO not in (x if isinstance(x, (list, tuple)) else (x,)) for a in todas for x in a)
    assert dados["tabelas"]["transactions"] == [{"id": "t1", "amount_cents": 4500, "description": "mercado"}]
    assert dados["tabelas"]["app_chat_messages"] == [{"id": "m1", "content": "gastei 45"}]
    # a conversa do app é lida pelo USUÁRIO, e as filhas de dívida pelos espaços
    chat = [a for s, a in banco["consultas"] if "app_chat_messages" in s][0]
    assert chat == (USER,)


@pytest.mark.asyncio
async def test_exclui_internos_e_nome_estranho_do_catalogo(banco):
    dados = await exportar_dados.exportar(USER)
    consultadas = " ".join(s for s, _a in banco["consultas"])
    for interno in ("messages_queue", "executed_actions", "pending_actions", "billing_events",
                    "workspace_invites", "transaction_embeddings", "Bad;Name"):
        assert interno not in dados["tabelas"] and f'public."{interno}"' not in consultadas
    assert set(dados["tabelas"]) >= {"workspaces", "transactions", "accounts", "debt_installment_edits",
                                     "debt_declared_due_dates", "debt_declared_estimates", "app_chat_messages"}
    assert exportar_dados.EXCLUIDAS >= {"messages_queue", "executed_actions", "pending_actions",
                                        "admin_account_notes", "admin_audit_events", "error_events"}


@pytest.mark.asyncio
async def test_formato_do_arquivo(banco):
    dados = await exportar_dados.exportar(USER)
    assert set(dados) == {"gerado_em", "versao_do_formato", "perfil", "tabelas"}
    assert dados["versao_do_formato"] == 1 and datetime.fromisoformat(dados["gerado_em"])
    assert dados["perfil"]["email"] == "ana@x.com" and dados["perfil"]["phone"] == "5511955554441"
    assert dados["perfil"]["auth_created_at"].startswith("2026-01-02")
    json.dumps(dados)  # serializável


# ── a rota ───────────────────────────────────────────────────────────────────────────────────────────────
def _cliente(user=USER):
    app = FastAPI()
    app.include_router(internal.router)
    if user is not None:
        app.dependency_overrides[internal.current_user] = lambda: user
    return TestClient(app)


def test_rota_devolve_json_como_anexo_do_proprio_usuario(banco):
    r = _cliente().get("/internal/export")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    cd = r.headers["content-disposition"]
    assert cd.startswith('attachment; filename="proops-dados-') and cd.endswith('.json"')
    assert r.json()["perfil"]["email"] == "ana@x.com"
    # o usuário vem do `sub`: a primeira consulta usa o id do token
    assert banco["consultas"][0][1] == (USER,)


def test_rota_exige_token(banco):
    r = _cliente(user=None).get("/internal/export")
    assert r.status_code in (401, 403) and banco["consultas"] == []


def test_quarto_pedido_na_hora_e_429_e_depois_libera(banco, monkeypatch):
    relogio = {"t": 1000.0}
    monkeypatch.setattr(internal, "_agora", lambda: relogio["t"])
    c = _cliente()
    for _ in range(3):
        assert c.get("/internal/export").status_code == 200
    r = c.get("/internal/export")
    assert r.status_code == 429 and r.json() == {"error": "rate_limited"}
    assert _cliente(OUTRO).get("/internal/export").status_code == 200  # o limite é por usuário
    relogio["t"] += 3601
    assert c.get("/internal/export").status_code == 200


@pytest.mark.asyncio
async def test_mensagens_do_whatsapp_so_texto_tipo_e_data_dela(banco, monkeypatch):
    original = db.fetch

    async def fetch(sql, *a):
        if "from public.messages_queue" in sql:
            banco["consultas"].append((sql, a))
            return [{"r": {"created_at": "2026-10-01T10:00:00+00:00", "tipo": "text", "texto": "gastei 45 no mercado"}}]
        return await original(sql, *a)

    monkeypatch.setattr(db, "fetch", fetch)
    dados = await exportar_dados.exportar(USER)
    assert dados["tabelas"]["mensagens_whatsapp"][0]["texto"] == "gastei 45 no mercado"
    sql, args = [(s, a) for s, a in banco["consultas"] if "from public.messages_queue" in s][0]
    assert args == (USER, USER), "só as mensagens dela"
    assert "direction = 'inbound'" in sql, "só as recebidas"
    # campos escolhidos um a um: nunca o payload cru, o telefone, o id da Meta nem o erro
    for proibido in ("select payload", "to_jsonb(payload", "phone", "wa_message_id", "last_error", "thread_id"):
        assert proibido not in sql.replace("payload #>>", ""), proibido


@pytest.mark.asyncio
async def test_dados_do_espaco_sao_lidos_sob_rls_como_o_proprio_usuario(banco):
    await exportar_dados.exportar(USER)
    assert banco["rls"] == [USER]
    onde = banco["onde"]
    sob_rls = [s for s, o in onde.items() if o == "rls"]
    for tabela in ('public."transactions"', "public.workspaces t", "debt_installment_edits", "information_schema.tables"):
        assert any(tabela in s for s in sob_rls), tabela
    # o que é dela por user_id (sem policy para o app) e as credenciais ficam fora do bloco RLS
    fora = [s for s, o in onde.items() if o == "dono"]
    assert any("app_chat_messages" in s for s in fora) and any("messages_queue" in s for s in fora)
    assert any("auth.users" in s for s in fora)


@pytest.mark.asyncio
async def test_perfil_sai_sem_o_token_de_push(banco):
    await exportar_dados.exportar(USER)
    sql = [s for s in banco["onde"] if "from public.profiles" in s and "auth.users" in s][0]
    assert "expo_push_token" not in sql, "a lista de colunas é explícita e não inclui o token"
    assert "last_seen_at" in sql and "phone" in sql
