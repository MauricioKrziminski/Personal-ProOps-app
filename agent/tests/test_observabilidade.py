"""Observabilidade: fingerprint estável, máscara de PII, captura best-effort, POST /internal/errors
(limites, 429, 202, usuário do `sub`) e as rotas de issues do painel. O agrupamento/reabertura em si é
SQL e fica em supabase/tests/observabilidade.sql."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import db, ratelimit
from app.config import get_settings
from app.routes import admin, admin_observabilidade, chat, errors
from app.services import observabilidade

ADMIN = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
USER = uuid4()
OUTRO = uuid4()
AGORA = datetime(2026, 10, 9, tzinfo=timezone.utc)
JS = ("TypeError: x is undefined\n"
      "    at hoje (http://10.0.0.1:8081/index.bundle?platform=ios&dev=true:1234:56)\n"
      "    at render (http://10.0.0.1:8081/index.bundle?platform=ios&dev=true:99:7)\n"
      "    at a (x.js:1:1)\n    at b (x.js:2:2)")


# ── fingerprint ───────────────────────────────────────────────────────────────────────────────────────
def test_fingerprint_ignora_linha_coluna_e_query():
    outro = JS.replace("1234:56", "4321:8").replace("platform=ios&dev=true", "platform=android&dev=false")
    assert observabilidade.fingerprint("app", "TypeError", "m", JS) == observabilidade.fingerprint("app", "TypeError", "m", outro)


def test_fingerprint_usa_so_3_frames_e_separa_origem_e_nome():
    mais = JS + "\n    at c (x.js:3:3)"
    base = observabilidade.fingerprint("app", "TypeError", "m", JS)
    assert base == observabilidade.fingerprint("app", "TypeError", "outra mensagem", mais)
    assert base != observabilidade.fingerprint("admin", "TypeError", "m", JS)
    assert base != observabilidade.fingerprint("app", "RangeError", "m", JS)


def test_fingerprint_sem_stack_normaliza_digitos_e_uuid():
    f = observabilidade.fingerprint
    assert f("app", "E", "falhou 123 vezes", None) == f("app", "E", "falhou 98 vezes", None)
    assert f("app", "E", f"id {uuid4()}", None) == f("app", "E", f"id {uuid4()}", None)
    assert f("app", "E", "a", None) != f("app", "E", "b", None)


def test_fingerprint_python_usa_o_frame_mais_interno():
    def tb(fn_interna):
        return ('Traceback (most recent call last):\n  File "/app/starlette/routing.py", line 10, in handle\n'
                f'    x\n  File "/app/app/tools/finance.py", line 77, in {fn_interna}\n    y\nValueError: v')
    f = observabilidade.fingerprint
    assert f("agent", "ValueError", "", tb("a")) != f("agent", "ValueError", "", tb("b"))
    assert f("agent", "ValueError", "", tb("a")) == f("agent", "ValueError", "", tb("a").replace("line 77", "line 80"))


# ── registrar / capturar ──────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def gravacoes(monkeypatch):
    chamadas = []

    async def execute(sql, *args):
        chamadas.append(args)
        return 1

    monkeypatch.setattr(db, "execute", execute)
    return chamadas


@pytest.mark.asyncio
async def test_registrar_mascara_pii_e_corta_tamanho(gravacoes):
    await observabilidade.registrar(
        source="app", kind="error", severity="warning", name="Boom",
        message="falhou para ana@x.com cpf 123.456.789-09 tel 11999998888 " + "z" * 900,
        stack="at f (a.js:1:1) 98765432101234", user_id=USER, platform="ios", app_version="1.4.0",
        context={"email": "b@y.com", "n": "12345678901"})
    (fp, source, kind, sev, title, msg, route, stack, uid, plat, ver, ctx) = gravacoes[0]
    assert "ana@x.com" not in msg and "[email]" in msg and "123.456.789-09" not in msg and "11999998888" not in msg
    assert len(msg) <= 500
    assert "98765432101234" not in stack and "b@y.com" not in ctx and "12345678901" not in ctx
    assert uid == str(USER) and source == "app" and len(fp) == 64


@pytest.mark.asyncio
async def test_capturar_nunca_levanta(monkeypatch):
    async def quebra(*_a, **_k):
        raise RuntimeError("banco fora")

    monkeypatch.setattr(db, "execute", quebra)
    await observabilidade.capturar(ValueError("x"), severity="critical", route="GET /x")  # não levanta
    await observabilidade.capturar(nome="N", mensagem="m")


@pytest.mark.asyncio
async def test_capturar_excecao_grava_nome_stack_e_origem_agente(gravacoes):
    try:
        raise KeyError("k1")
    except KeyError as e:
        await observabilidade.capturar(e, severity="critical", route="worker:turno")
    (_fp, source, kind, sev, title, msg, route, stack, *_r) = gravacoes[0]
    assert (source, kind, sev, route) == ("agent", "error", "critical", "worker:turno")
    assert title.startswith("KeyError") and "Traceback" in stack


# ── POST /internal/errors ─────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def cli(monkeypatch, gravacoes):
    ratelimit._chamadas.clear()
    app = FastAPI()
    app.include_router(errors.router)
    chat.install_error_handlers(app)
    estado = {"sub": None}

    def decode(token):
        if token == "ruim":
            raise ValueError("token")
        return {"sub": str(estado["sub"] or USER)}

    monkeypatch.setattr(errors, "decode_token", decode)
    c = TestClient(app)
    c.estado = estado
    c.gravacoes = gravacoes
    yield c
    ratelimit._chamadas.clear()


def _corpo(n=1, **extra):
    return {"errors": [{"source": "app", "kind": "crash", "name": "E", "message": f"m{i}", **extra} for i in range(n)]}


def test_202_sem_login_e_com_login_o_usuario_vem_do_sub(cli):
    r = cli.post("/internal/errors", json=_corpo(user_id=str(OUTRO)))
    assert r.status_code == 202 and r.json() == {"accepted": 1}
    assert cli.gravacoes[-1][8] is None  # anônimo; campo `user_id` do corpo é ignorado
    cli.post("/internal/errors", json=_corpo(user_id=str(OUTRO)), headers={"Authorization": "Bearer ok"})
    assert cli.gravacoes[-1][8] == str(USER)  # `sub`, nunca o corpo


def test_token_invalido_vira_anonimo_e_crash_e_critico(cli):
    r = cli.post("/internal/errors", json=_corpo(), headers={"Authorization": "Bearer ruim"})
    assert r.status_code == 202
    assert cli.gravacoes[-1][8] is None and cli.gravacoes[-1][3] == "critical"


def test_limites_de_tamanho_e_quantidade(cli):
    assert cli.post("/internal/errors", json=_corpo(21)).status_code == 422
    assert cli.post("/internal/errors", json={"errors": []}).status_code == 422
    assert cli.post("/internal/errors", content=b"{nao json", headers={"content-type": "application/json"}).status_code == 422
    grande = json.dumps(_corpo(stack="x" * 40_000))
    assert cli.post("/internal/errors", content=grande, headers={"content-type": "application/json"}).status_code == 413
    assert cli.post("/internal/errors", json={"errors": [{"source": "agent", "name": "x"}]}).status_code == 422


def test_429_por_ip_e_por_usuario(cli):
    for _ in range(errors.POR_IP_MIN):
        assert cli.post("/internal/errors", json=_corpo()).status_code == 202
    r = cli.post("/internal/errors", json=_corpo())
    assert r.status_code == 429
    ratelimit._chamadas.clear()
    for i in range(errors.POR_USUARIO_MIN):
        assert cli.post("/internal/errors", json=_corpo(), headers={"Authorization": "Bearer ok",
                                                                    "X-Forwarded-For": f"9.9.9.{i}"}).status_code == 202
    assert cli.post("/internal/errors", json=_corpo(), headers={"Authorization": "Bearer ok",
                                                                "X-Forwarded-For": "8.8.8.8"}).status_code == 429


def test_falha_do_banco_nao_vira_erro_para_o_app(cli, monkeypatch):
    async def quebra(*_a, **_k):
        raise RuntimeError("banco")

    monkeypatch.setattr(db, "execute", quebra)
    r = cli.post("/internal/errors", json=_corpo())
    assert r.status_code == 202 and r.json() == {"accepted": 0}


# ── handler global de exceção ─────────────────────────────────────────────────────────────────────────
def test_handler_global_captura_5xx_como_critico(monkeypatch):
    from app import main

    vistos = []

    async def capturar(exc, **kw):
        vistos.append((type(exc).__name__, kw))

    monkeypatch.setattr(observabilidade, "capturar", capturar)
    app = FastAPI()
    app.add_exception_handler(Exception, main._erro_inesperado)

    @app.get("/boom/{x}")
    async def boom(x: str):
        raise RuntimeError("quebrou")

    r = TestClient(app, raise_server_exceptions=False).get("/boom/7")
    assert r.status_code == 500 and r.json()["code"] == "internal_error"
    assert vistos == [("RuntimeError", {"severity": "critical", "route": "GET /boom/{x}"})]


# ── admin: issues ─────────────────────────────────────────────────────────────────────────────────────
def _issue_row(**kw):
    return {"id": uuid4(), "fingerprint": "f" * 64, "source": "app", "kind": "crash", "severity": "critical",
            "title": "T", "message": "m", "route": "/hoje", "status": "open", "first_seen": AGORA,
            "last_seen": AGORA, "count": 3, "last_app_version": "1.4.0", "platforms": ["ios"],
            "users_affected": 2, "stack": "at f", **kw}


@pytest.fixture
def adm(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("ADMIN_USER_IDS", str(ADMIN))
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "false")
    estado = {"id": ADMIN, "sql": [], "writes": [], "status": "open"}

    async def _user(_req):
        if estado["id"] is None:
            raise HTTPException(status_code=401, detail="token inválido")
        return estado["id"]

    @asynccontextmanager
    async def uow():
        yield

    async def fetch_one(sql, *a):
        estado["sql"].append(sql)
        if "count(*)::int as n from public.error_issues" in sql:
            return {"n": 1}
        if "as open" in sql and "as nw" in sql:
            return {"open": 4, "ev": 9, "users": 2, "nw": 1}
        if "select status from public.error_issues" in sql:
            return None if estado.get("falta") else {"status": estado["status"]}
        if "from public.error_issues i where i.id" in sql:
            return None if estado.get("falta") else _issue_row()
        return None

    async def fetch(sql, *a):
        estado["sql"].append(sql)
        if "from (select" in sql and "error_issues" in sql:
            return [_issue_row()]
        if "group by i.source" in sql:
            return [{"source": "app", "n": 5}]
        if "generate_series(date_trunc('hour'" in sql:
            return [{"h": AGORA, "n": 1}]
        if "generate_series((now()" in sql:
            return [{"day": "2026-10-09", "n": 1}]
        if "from public.error_events e left join" in sql:
            return [{"id": uuid4(), "created_at": AGORA, "user_id": USER, "user_email": "u@x.com", "platform": "ios",
                     "app_version": "1.4.0", "route": "/hoje", "message": "m", "context": {"a": 1}}]
        if "from public.admin_audit_events e" in sql:
            return [{"id": uuid4(), "created_at": AGORA, "action": "issue_triaged", "admin_user_id": ADMIN,
                     "admin_email": "a@x.com", "target_user_id": None, "target_email": None,
                     "payload": {"from": "open", "to": "resolved"}}]
        return []

    async def execute(sql, *a):
        estado["writes"].append((sql, a))
        return 1

    monkeypatch.setattr(admin, "current_user", _user)
    monkeypatch.setattr(admin, "decode_token", lambda _t: {"aal": "aal1"})
    monkeypatch.setattr(db, "unidade_de_trabalho", uow)
    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "execute", execute)
    app = FastAPI()
    app.include_router(admin_observabilidade.router)
    c = TestClient(app, headers={"Authorization": "Bearer x"})
    c.estado = estado
    yield c
    get_settings.cache_clear()


def test_lista_no_formato_do_contrato(adm):
    j = adm.get("/admin/api/issues?status=open&source=app&severity=critical&period=24h&q=hoje&sort=count_desc").json()
    assert set(j) == {"items", "total", "page", "page_size", "summary"} and j["total"] == 1 and j["page_size"] == 25
    assert set(j["items"][0]) == {"id", "fingerprint", "source", "kind", "severity", "title", "message", "route",
                                  "status", "first_seen", "last_seen", "count", "users_affected",
                                  "last_app_version", "platforms"}
    assert j["summary"] == {"open": 4, "events_24h": 9, "users_affected_24h": 2, "new_24h": 1,
                            "by_source_24h": {"app": 5, "admin": 0, "agent": 0}}
    assert adm.get("/admin/api/issues?sort=drop table").status_code == 422
    assert adm.get("/admin/api/issues?period=1y").status_code == 422


def test_detalhe_no_formato_do_contrato(adm):
    j = adm.get(f"/admin/api/issues/{uuid4()}").json()
    assert set(j) == {"issue", "stack", "hourly_24h", "daily_30d", "events", "triage"}
    assert j["events"][0]["user_email"] == "u@x.com" and j["triage"][0]["action"] == "issue_triaged"
    adm.estado["falta"] = True
    assert adm.get(f"/admin/api/issues/{uuid4()}").status_code == 404


def test_triagem_audita_na_mesma_transacao_com_de_para(adm):
    iid = uuid4()
    r = adm.post(f"/admin/api/issues/{iid}/status", json={"status": "resolved"})
    assert r.status_code == 200 and "issue" in r.json()
    upd, aud = adm.estado["writes"]
    assert "update public.error_issues" in upd[0] and upd[1][0] == "resolved"
    assert "admin_audit_events" in aud[0] and aud[1][1].obj == {"issue_id": str(iid), "from": "open", "to": "resolved"}
    assert adm.post(f"/admin/api/issues/{iid}/status", json={"status": "x"}).status_code == 422


def test_autorizacao_igual_ao_admin(adm, monkeypatch):
    adm.estado["id"] = OUTRO
    assert adm.get("/admin/api/issues").status_code == 403
    adm.estado["id"] = None
    assert adm.get("/admin/api/issues").status_code == 401
    monkeypatch.setenv("ADMIN_USER_IDS", "")
    get_settings.cache_clear()
    assert adm.get("/admin/api/issues").status_code == 404
    assert adm.post(f"/admin/api/issues/{uuid4()}/status", json={"status": "open"}).status_code == 404
    assert adm.estado["writes"] == []


# ── retenção ──────────────────────────────────────────────────────────────────────────────────────────
def test_retencao_tem_os_prazos_da_observabilidade():
    from app.jobs import retencao

    regras = {n: c for n, _t, c in retencao._REGRAS}
    assert "30 days" in regras["error_events"]
    assert "'resolved', 'ignored'" in regras["error_issues"] and "90 days" in regras["error_issues"]
    assert "open" not in regras["error_issues"]


# ── ganchos: worker e cron ────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_falha_do_turno_no_worker_vira_issue_critical(monkeypatch):
    from app import worker

    vistos = []

    async def capturar(exc, **kw):
        vistos.append((type(exc).__name__, kw))

    async def nada(*_a, **_k):
        return None

    async def quebra(*_a, **_k):
        raise RuntimeError("turno quebrou")

    monkeypatch.setattr(observabilidade, "capturar", capturar)
    monkeypatch.setattr(worker, "_processar", quebra)
    monkeypatch.setattr(worker, "_soltar_reserva_sem_falhar", nada)
    monkeypatch.setattr(worker, "_devolver_a_fila", nada)
    monkeypatch.setattr(worker, "_avisar_falhas", nada)
    with pytest.raises(RuntimeError):
        await worker._turno_com_prazo([], [], "5511", "t1")
    assert vistos == [("RuntimeError", {"severity": "critical", "route": "worker:turno"})]


@pytest.mark.asyncio
async def test_falha_de_job_do_cron_vira_issue(monkeypatch):
    from app.routes import cron

    vistos = []

    async def capturar(exc, **kw):
        vistos.append(kw["route"])

    async def vazio(*_a, **_k):
        return {}

    async def quebra(*_a, **_k):
        raise RuntimeError("embeddings")

    monkeypatch.setattr(observabilidade, "capturar", capturar)
    for mod, nome in ((cron.reminders, "run"), (cron.bill_reminders, "run"), (cron.scheduler, "materialize_horizon")):
        monkeypatch.setattr(mod, nome, vazio)
    monkeypatch.setattr(cron, "sweep", vazio)
    monkeypatch.setattr(cron, "checar_fila", vazio)
    monkeypatch.setattr(cron.embeddings, "run", quebra)
    r = await cron.run_reminders()
    assert vistos == ["cron:reminders/vetores"] and r["embeddings"] == {"error": "vetores de lançamento falharam"}


# ── máscara de PII: o rótulo certo para cada formato BR ───────────────────────────────────────────────
@pytest.mark.parametrize("texto,rotulo", [
    ("11988887777", "[telefone]"), ("(11) 98888-7777", "[telefone]"), ("11 98888-7777", "[telefone]"),
    ("+55 11 98888-7777", "[telefone]"), ("5511988887777", "[telefone]"), ("(11) 3333-4444", "[telefone]"),
    ("123.456.789-09", "[cpf]"), ("12345678909", "[cpf]"),
    ("12.345.678/0001-90", "[cnpj]"), ("12345678000190", "[cnpj]"),
    ("ana.silva+x@empresa.com.br", "[email]"),
])
def test_mascara_rotula_cada_formato(texto, rotulo):
    from app.services.telemetry import mascarar_texto
    assert mascarar_texto(f"erro com {texto} no meio") == f"erro com {rotulo} no meio"


def test_422_da_captura_segue_o_contrato(cli):
    r = cli.post("/internal/errors", json={"errors": []})
    assert r.status_code == 422 and r.json()["error"] == "invalid_request" and r.json()["message"]
