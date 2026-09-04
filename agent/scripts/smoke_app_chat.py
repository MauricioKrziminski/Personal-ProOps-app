"""Fumaça das queries de conversa do app contra o Postgres LOCAL.

Não entra no pytest de propósito: a regra do projeto é que teste com banco ou
rede não vive lá. Mas o SQL de `db.py` precisa ser EXECUTADO por alguém antes de
ir para o staging — nenhum teste de unidade toca nele (o repositório é dublê).

    npx supabase start
    agent/.venv/bin/python agent/scripts/smoke_app_chat.py

Cria um usuário descartável, roda o ciclo inteiro (criar, reivindicar, lease,
dedupe, retry, listar, renomear, excluir) e limpa o que criou.
"""
import asyncio, os, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
os.environ.setdefault("GEMINI_API_KEY", "x")

from app import db

async def main():
    await db.open_pools()
    conn_pool = db.pool()
    uid = uuid.uuid4()
    async with conn_pool.connection() as c:
        await c.execute(
            "insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)"
            " values (%s, '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated', %s, '{}','{}')",
            (uid, f"smoke-{uid}@teste.local"))

    perfil = await db.chat_profile(uid)
    assert perfil and perfil["workspace_id"], f"chat_profile: {perfil}"
    print("chat_profile           ok", perfil["timezone"])

    cid = uuid.uuid4()
    sessao, criada = await db.create_chat_session(
        user_id=uid, workspace_id=perfil["workspace_id"], title="gastei 45 no mercado",
        first_client_message_id=cid, thread_id=f"app-{uuid.uuid4()}", timezone_="America/Bahia")
    assert criada, "a sessão deveria nascer agora"
    de_novo, criada2 = await db.create_chat_session(
        user_id=uid, workspace_id=perfil["workspace_id"], title="gastei 45 no mercado",
        first_client_message_id=cid, thread_id=f"app-{uuid.uuid4()}", timezone_="America/Bahia")
    assert not criada2 and de_novo["id"] == sessao["id"], "o retry criou outra conversa"
    print("create_chat_session    ok (idempotente)")

    sid = sessao["id"]
    r = await db.claim_chat_turn(session_id=sid, user_id=uid, client_message_id=cid, content="gastei 45")
    assert r["kind"] == "run" and not r["retry"], r
    msg = r["user_message"]
    print("claim_chat_turn        ok", r["kind"])

    outro = await db.claim_chat_turn(session_id=sid, user_id=uid, client_message_id=uuid.uuid4(), content="atropelo")
    assert outro["kind"] == "busy", outro
    print("lease vivo             ok (busy)")

    intruso = await db.claim_chat_turn(session_id=sid, user_id=uuid.uuid4(), client_message_id=uuid.uuid4(), content="x")
    assert intruso["kind"] == "missing", intruso
    print("escopo por user_id     ok (missing)")

    resp = await db.finish_chat_turn(session_id=sid, user_message_id=msg["id"],
                                     content="R$ 1.234,00", ui_payload={"pending_id": "abc"})
    assert resp["role"] == "assistant" and resp["in_reply_to"] == msg["id"]
    print("finish_chat_turn       ok, ui_payload =", resp["ui_payload"])

    repetido = await db.claim_chat_turn(session_id=sid, user_id=uid, client_message_id=cid, content="gastei 45")
    assert repetido["kind"] == "completed" and repetido["assistant_message"]["content"] == "R$ 1.234,00", repetido
    print("dedupe do UUID         ok (completed)")

    hist = await db.chat_prompt_history(sid)
    assert [h["role"] for h in hist] == ["user", "assistant"], hist
    print("chat_prompt_history    ok", len(hist), "mensagens em ordem")

    c2 = uuid.uuid4()
    r2 = await db.claim_chat_turn(session_id=sid, user_id=uid, client_message_id=c2, content="quebra")
    await db.fail_chat_turn(session_id=sid, user_message_id=r2["user_message"]["id"], error_code="internal")
    r3 = await db.claim_chat_turn(session_id=sid, user_id=uid, client_message_id=c2, content="quebra")
    assert r3["kind"] == "run" and r3["retry"], r3
    print("retry após falha       ok (retry=True)")
    await db.fail_chat_turn(session_id=sid, user_message_id=r3["user_message"]["id"], error_code="internal")

    msgs = await db.chat_messages(sid, uid, limit=10)
    assert msgs and msgs[0]["sequence"] < msgs[-1]["sequence"], "a página não veio cronológica"
    print("chat_messages          ok", len(msgs), "linhas em ordem cronológica")

    lista = await db.chat_sessions(uid)
    assert any(s["id"] == sid for s in lista)
    pag = await db.chat_sessions(uid, cursor=(lista[0]["last_message_at"], lista[0]["id"]))
    print("chat_sessions          ok", len(lista), "→ página seguinte", len(pag))

    ren = await db.rename_chat_session(sid, uid, "Contas do mês")
    assert ren["title"] == "Contas do mês"
    print("rename_chat_session    ok")

    marcada = await db.mark_chat_deleting(sid, uid)
    assert marcada and not marcada.get("busy") and marcada["deleting_at"]
    assert await db.chat_session(sid, uid) is None, "conversa em exclusão ainda aparece"
    await db.drop_chat_session(sid)
    assert not await db.fetch("select 1 from public.app_chat_messages where session_id = %s", sid)
    print("exclusão               ok (cascade levou as mensagens)")

    async with conn_pool.connection() as c:
        await c.execute("delete from auth.users where id = %s", (uid,))
    await db.close_pools()
    print("\n✓ todas as queries novas rodaram contra o Postgres")

asyncio.run(main())
