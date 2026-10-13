"""Painel /admin — pacote "pronto para a loja": busca por telefone, CSV, notas, convites, membros, push,
configuração do app, versão em campo e MFA ligado por padrão. Mesmo desenho de `test_admin.py` (dublê de `db`)."""

from __future__ import annotations

import csv
import io
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app import db
from app.config import Settings, get_settings
from app.routes import admin
from tests.test_admin import ADMIN, ALVO, OUTRO, WS, cli  # noqa: F401 — `cli` é fixture

AGORA = datetime(2026, 10, 1, tzinfo=timezone.utc)
NOTA = uuid4()
CONVITE = uuid4()
MEMBRO = uuid4()
TELEFONE = "5511955554441"


def _linha(**kw):
    return {"user_id": ALVO, "workspace_id": WS, "email": "a@b.com", "name": "Ana", "created_at": AGORA,
            "last_sign_in_at": AGORA, "suspended": False, "whatsapp_linked": True, "plan": "pro",
            "status": "active", "access": "subscriber", "is_trial": False, "period_end": None,
            "provider": "manual", "ai_used": 3, "ai_max": 400, "wa_used": 1, "wa_max": 150,
            "notices_today": 0, "notices_max": 1, "phone": TELEFONE, "last_app_version": "1.4.2",
            "last_seen_at": AGORA, **kw}


@pytest.fixture
def banco(monkeypatch):
    est = {"sql": [], "args": [], "escritas": [], "total": 1, "linhas": [_linha()], "token": "ExponentPushToken[x]",
           "convite": {"status": "pending"}, "membro": {"role": "member"}, "nota_apagada": {"id": NOTA},
           "config": {c: None for c in admin._CONFIG_CAMPOS} | {"updated_at": AGORA, "updated_by": None}}

    @asynccontextmanager
    async def _uow():
        est["escritas"].append(("BEGIN",))
        yield
        est["escritas"].append(("COMMIT",))

    async def fetch_one(sql, *a):
        est["sql"].append(sql)
        est["args"].append(a)
        if "as onboarding" in sql:
            return {"phone": TELEFONE, "email_confirmed_at": AGORA, "banned_until": None, "onboarding": True,
                    "sessoes": 1, "terms_version": "2026-10-09", "terms_accepted_at": AGORA, "ai_consent_at": AGORA,
                    "last_app_version": "1.4.2", "last_app_platform": "ios", "last_seen_at": AGORA,
                    "push_tokens": 1, "notes_count": 2}
        if "w.owner_id = p.id" in sql:
            return {"id": ALVO, "email": "a@b.com", "phone": TELEFONE, "expo_push_token": est["token"], "ws": WS}
        if "count(*)::int as n" in sql:
            return {"n": est["total"]}
        if "from public.workspace_invites" in sql:
            return est["convite"]
        if "from public.workspace_members" in sql:
            return est["membro"]
        if "insert into public.admin_account_notes" in sql:
            return {"id": NOTA}
        if "delete from public.admin_account_notes" in sql:
            return est["nota_apagada"]
        if "from public.admin_account_notes n" in sql:
            return {"id": NOTA, "body": "ligou", "created_at": AGORA, "admin_user_id": ADMIN, "admin_email": "adm@x.com"}
        if "from public.app_config" in sql:
            return dict(est["config"])
        if "update public.app_config" in sql:
            est["config"] = est["config"] | dict(zip(admin._CONFIG_CAMPOS, a)) | {"updated_by": ADMIN}
            return dict(est["config"])
        if "from base where user_id" in sql:
            return _linha()
        return None

    async def fetch(sql, *a):
        est["sql"].append(sql)
        est["args"].append(a)
        if "from base where" in sql:
            return est["linhas"]
        if "from public.admin_account_notes n" in sql:
            return [{"id": NOTA, "body": "ligou", "created_at": AGORA, "admin_user_id": ADMIN, "admin_email": "adm@x.com"}]
        if "last_app_platform as platform" in sql:
            return [{"platform": "ios", "version": "1.4.2", "users": 7}, {"platform": "android", "version": "1.4.1", "users": 3}]
        return []

    async def execute(sql, *a):
        est["escritas"].append((sql, a))
        return 1

    monkeypatch.setattr(db, "unidade_de_trabalho", _uow)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "execute", execute)
    return est


def _auditorias(banco):
    return [e[1] for e in banco["escritas"] if len(e) == 2 and "admin_audit_events" in e[0]]


NOVAS_ROTAS = [
    ("get", "/admin/api/accounts.csv", None),
    ("get", f"/admin/api/accounts/{ALVO}/notes", None),
    ("post", f"/admin/api/accounts/{ALVO}/notes", {"body": "x"}),
    ("delete", f"/admin/api/accounts/{ALVO}/notes/{NOTA}", None),
    ("post", f"/admin/api/accounts/{ALVO}/invites/{CONVITE}/revoke", {}),
    ("post", f"/admin/api/accounts/{ALVO}/members/{MEMBRO}/remove", {}),
    ("post", f"/admin/api/accounts/{ALVO}/notify", {"title": "t", "body": "b"}),
    ("get", "/admin/api/app-config", None),
    ("put", "/admin/api/app-config", {}),
]


# ── autorização: nenhuma rota nova toca o banco sem ser admin ──────────────────────────────────────────────
def test_rotas_novas_exigem_admin_e_nao_tocam_no_banco(cli, banco):
    cli.estado["id"] = None
    for metodo, url, corpo in NOVAS_ROTAS:
        assert getattr(cli, metodo)(url, **({"json": corpo} if corpo is not None else {})).status_code == 401, url
    cli.estado["id"] = OUTRO
    for metodo, url, corpo in NOVAS_ROTAS:
        r = getattr(cli, metodo)(url, **({"json": corpo} if corpo is not None else {}))
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, url
    assert banco["sql"] == [] and banco["escritas"] == []


def test_painel_desligado_e_404_nas_rotas_novas(cli, banco, monkeypatch):
    monkeypatch.setenv("ADMIN_USER_IDS", "")
    monkeypatch.setenv("SERVICO", "admin")
    get_settings.cache_clear()
    for metodo, url, corpo in NOVAS_ROTAS:
        assert getattr(cli, metodo)(url, **({"json": corpo} if corpo is not None else {})).status_code == 404


def test_mfa_e_ligado_por_padrao(monkeypatch):
    monkeypatch.delenv("ADMIN_REQUIRE_MFA", raising=False)
    assert Settings(_env_file=None).admin_require_mfa is True
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "")  # variável vazia = não configurada = ligado
    assert Settings(_env_file=None).admin_require_mfa is True
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "false")
    assert Settings(_env_file=None).admin_require_mfa is False


def test_mfa_padrao_barra_aal1_nas_rotas_novas(cli, banco, monkeypatch):
    monkeypatch.delenv("ADMIN_REQUIRE_MFA", raising=False)
    get_settings.cache_clear()
    assert cli.get("/admin/api/accounts.csv").json() == {"error": "mfa_required"}
    assert cli.put("/admin/api/app-config", json={}).status_code == 403


# ── busca por telefone ─────────────────────────────────────────────────────────────────────────────────────
def test_busca_com_4_ou_mais_digitos_compara_so_os_digitos_do_telefone(cli, banco):
    assert cli.get("/admin/api/accounts?q=(11)%2095555-4441").status_code == 200
    sql = [s for s in banco["sql"] if "from base where" in s and "limit" in s][0]
    assert "regexp_replace(coalesce(phone" in sql
    args = [a for s, a in zip(banco["sql"], banco["args"]) if s is sql][0]
    assert "%1195555444" in args[-3] and args[-3].endswith("1%") and "(11)" not in args[-3]


def test_busca_com_menos_de_4_digitos_ou_so_texto_nao_olha_o_telefone(cli, banco):
    cli.get("/admin/api/accounts?q=ana12")
    cli.get("/admin/api/accounts?q=ana")
    sqls = [s for s in banco["sql"] if "from base where" in s]
    assert sqls and not any("regexp_replace(coalesce(phone" in s for s in sqls)


# ── lista, detalhe, visão geral ──────────────────────────────────────────────────────────────────────────
def test_lista_traz_versao_e_ultimo_uso_e_aceita_as_ordens_novas(cli, banco):
    item = cli.get("/admin/api/accounts").json()["items"][0]
    assert item["last_app_version"] == "1.4.2" and item["last_seen_at"].startswith("2026-10-01")
    assert "phone" not in item
    for ordem, trecho in (("last_seen_desc", "last_seen_at desc nulls last"), ("last_seen_asc", "last_seen_at nulls first")):
        assert cli.get(f"/admin/api/accounts?sort={ordem}").status_code == 200
        assert any(trecho in s for s in banco["sql"])


def test_detalhe_traz_aceite_consentimento_versao_push_e_notas(cli, banco):
    p = cli.get(f"/admin/api/accounts/{ALVO}").json()["profile"]
    assert p["terms_version"] == "2026-10-09" and p["terms_accepted_at"] and p["ai_consent_at"]
    assert (p["last_app_version"], p["last_app_platform"]) == ("1.4.2", "ios") and p["last_seen_at"]
    assert p["push_tokens"] == 1 and p["notes_count"] == 2
    assert "expo_push_token" not in json.dumps(p)  # só a contagem, nunca o token


def test_visao_geral_traz_versoes_dos_ultimos_30_dias(cli, banco, monkeypatch):
    banco_fetch_one = db.fetch_one

    async def fetch_one(sql, *a):
        return {} if "count(*)::int as total" in sql else await banco_fetch_one(sql, *a)

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    v = cli.get("/admin/api/overview").json()["versions"]
    assert v == [{"platform": "ios", "version": "1.4.2", "users": 7}, {"platform": "android", "version": "1.4.1", "users": 3}]
    assert any("last_seen_at >= now() - interval '30 days'" in s for s in banco["sql"])


def test_sinal_de_inativos_usa_uso_do_app_e_cai_no_login():
    assert "coalesce(last_seen_at, last_sign_in_at)" in admin._SINAIS["inactive_subscribers_30d"]


# ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────
def test_csv_com_bom_cabecalho_filtros_e_auditoria(cli, banco):
    banco["linhas"] = [_linha(), _linha(name="=HYPERLINK(\"x\")", email="b@c.com")]
    r = cli.get("/admin/api/accounts.csv?plan=pro&sort=email_asc")
    assert r.status_code == 200 and r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.headers["content-disposition"].startswith('attachment; filename="contas-')
    assert r.content.startswith(b"\xef\xbb\xbf")
    linhas = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert linhas[0] == list(admin._CSV_COLUNAS) and len(linhas) == 3
    assert linhas[1][linhas[0].index("email")] == "a@b.com" and linhas[1][linhas[0].index("is_trial")] == "false"
    assert linhas[2][linhas[0].index("name")].startswith("'="), "fórmula neutralizada"
    sql = [s for s in banco["sql"] if "order by lower(email)" in s]
    assert sql and "limit" not in sql[0], "sem paginação"
    (aud,) = _auditorias(banco)
    assert aud[1] == "accounts_exported" and aud[0] == ADMIN and aud[2] is None
    assert aud[4].obj == {"filters": {"plan": "pro", "sort": "email_asc"}, "total": 2}
    assert not any(t in r.text for t in (TELEFONE, "phone"))  # telefone não sai no CSV


def test_csv_acima_do_teto_e_422_sem_auditoria(cli, banco):
    banco["total"] = 10_001
    r = cli.get("/admin/api/accounts.csv")
    assert r.status_code == 422 and r.json()["error"] == "too_many_rows"
    assert _auditorias(banco) == []
    banco["total"] = 10_000
    assert cli.get("/admin/api/accounts.csv").status_code == 200


def test_csv_usa_o_mesmo_filtro_da_lista(cli, banco):
    cli.get("/admin/api/accounts?signal=near_limit&access=subscriber&q=%2011999")
    cli.get("/admin/api/accounts.csv?signal=near_limit&access=subscriber&q=%2011999")
    listas = [(s, a) for s, a in zip(banco["sql"], banco["args"]) if "from base where" in s and "count" not in s]
    csv_, lista = listas[-1], listas[-2]
    onde = lambda s: s.split("where", 1)[1].split("order by")[0]  # noqa: E731
    assert onde(csv_[0]) == onde(lista[0])


# ── notas internas ───────────────────────────────────────────────────────────────────────────────────────
def test_notas_lista_cria_e_apaga_com_auditoria_sem_o_texto(cli, banco):
    itens = cli.get(f"/admin/api/accounts/{ALVO}/notes").json()["items"]
    assert itens == [{"id": str(NOTA), "body": "ligou", "created_at": AGORA.isoformat(),
                      "admin_user_id": str(ADMIN), "admin_email": "adm@x.com"}]
    r = cli.post(f"/admin/api/accounts/{ALVO}/notes", json={"body": "  cliente pediu reembolso  "})
    assert r.status_code == 200 and r.json()["id"] == str(NOTA)
    ins = [a for s, a in zip(banco["sql"], banco["args"]) if "insert into public.admin_account_notes" in s][0]
    assert ins == (ALVO, ADMIN, "cliente pediu reembolso")
    assert cli.delete(f"/admin/api/accounts/{ALVO}/notes/{NOTA}").json() == {"deleted": True}
    a1, a2 = _auditorias(banco)
    assert (a1[1], a2[1]) == ("note_added", "note_deleted") and a1[2] == ALVO
    assert a1[4].obj == {"note_id": str(NOTA)} and "reembolso" not in json.dumps(a1[4].obj)


@pytest.mark.parametrize("corpo", [{"body": ""}, {"body": "   "}, {"body": "x" * 2001}, {}])
def test_nota_invalida_e_422_sem_escrever(cli, banco, corpo):
    assert cli.post(f"/admin/api/accounts/{ALVO}/notes", json=corpo).status_code == 422
    assert banco["escritas"] == []
    assert cli.post(f"/admin/api/accounts/{ALVO}/notes", json={"body": "x" * 2000}).status_code == 200


def test_apagar_nota_inexistente_ou_de_outra_conta_e_404_sem_auditoria(cli, banco):
    banco["nota_apagada"] = None
    r = cli.delete(f"/admin/api/accounts/{ALVO}/notes/{uuid4()}")
    assert r.status_code == 404 and r.json() == {"error": "not_found"} and _auditorias(banco) == []
    delete = [(s, a) for s, a in zip(banco["sql"], banco["args"]) if "delete from public.admin_account_notes" in s][0]
    assert "user_id = %s" in delete[0], "a nota tem que ser DESTA conta"


# ── convites e membros ───────────────────────────────────────────────────────────────────────────────────
def test_revogar_convite_audita_sem_o_telefone_do_convidado(cli, banco):
    r = cli.post(f"/admin/api/accounts/{ALVO}/invites/{CONVITE}/revoke")
    assert r.status_code == 200 and "account" in r.json()
    assert any("set status = 'revoked'" in e[0] for e in banco["escritas"] if len(e) == 2)
    (aud,) = _auditorias(banco)
    assert aud[1] == "invite_revoked" and aud[4].obj == {"invite_id": str(CONVITE)}
    consulta = [s for s in banco["sql"] if "from public.workspace_invites" in s][0]
    assert "workspace_id = %s" in consulta, "só os convites do espaço desta conta"


def test_revogar_convite_ja_aceito_e_409_e_inexistente_404(cli, banco):
    banco["convite"] = {"status": "accepted"}
    r = cli.post(f"/admin/api/accounts/{ALVO}/invites/{CONVITE}/revoke")
    assert r.status_code == 409 and r.json()["error"] == "invite_not_pending"
    banco["convite"] = None
    assert cli.post(f"/admin/api/accounts/{ALVO}/invites/{CONVITE}/revoke").status_code == 404
    assert _auditorias(banco) == []


def test_remover_membro_audita(cli, banco):
    r = cli.post(f"/admin/api/accounts/{ALVO}/members/{MEMBRO}/remove")
    assert r.status_code == 200
    assert any("delete from public.workspace_members" in e[0] for e in banco["escritas"] if len(e) == 2)
    (aud,) = _auditorias(banco)
    assert aud[1] == "member_removed" and aud[4].obj == {"member_user_id": str(MEMBRO)}


def test_nao_remove_o_dono_nem_quem_nao_e_membro(cli, banco):
    banco["membro"] = {"role": "owner"}
    r = cli.post(f"/admin/api/accounts/{ALVO}/members/{ALVO}/remove")
    assert r.status_code == 409 and r.json()["error"] == "cannot_remove_owner"
    banco["membro"] = None
    assert cli.post(f"/admin/api/accounts/{ALVO}/members/{MEMBRO}/remove").status_code == 404
    assert _auditorias(banco) == [] and not any("delete from" in e[0] for e in banco["escritas"] if len(e) == 2)


# ── push ─────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def expo(monkeypatch):
    enviados = []

    async def send(token, title, body, target="today", ref=None):
        enviados.append((token, title, body))

    monkeypatch.setattr(admin.push, "send", send)
    return enviados


def test_aviso_por_push_envia_e_audita_so_o_titulo(cli, banco, expo):
    r = cli.post(f"/admin/api/accounts/{ALVO}/notify", json={"title": "Novidade", "body": "Atualize o app"})
    assert r.status_code == 200 and r.json() == {"sent": 1}
    assert expo == [("ExponentPushToken[x]", "Novidade", "Atualize o app")]
    (aud,) = _auditorias(banco)
    assert aud[1] == "push_sent" and aud[4].obj == {"title": "Novidade"}


def test_aviso_sem_token_e_409_sem_enviar(cli, banco, expo):
    banco["token"] = None
    r = cli.post(f"/admin/api/accounts/{ALVO}/notify", json={"title": "t", "body": "b"})
    assert r.status_code == 409 and r.json()["error"] == "no_push_tokens"
    assert expo == [] and _auditorias(banco) == []


@pytest.mark.parametrize("corpo", [{"title": "x" * 61, "body": "b"}, {"title": "t", "body": "x" * 181},
                                   {"title": "", "body": "b"}, {"title": "t"}])
def test_aviso_valida_tamanhos(cli, banco, expo, corpo):
    assert cli.post(f"/admin/api/accounts/{ALVO}/notify", json=corpo).status_code == 422
    assert expo == []
    assert cli.post(f"/admin/api/accounts/{ALVO}/notify", json={"title": "x" * 60, "body": "y" * 180}).status_code == 200


def test_falha_do_expo_e_502_sem_auditoria(cli, banco, monkeypatch):
    async def quebra(*_a, **_k):
        raise RuntimeError("Expo push falhou (500): corpo com segredo")

    monkeypatch.setattr(admin.push, "send", quebra)
    r = cli.post(f"/admin/api/accounts/{ALVO}/notify", json={"title": "t", "body": "b"})
    assert r.status_code == 502 and r.json()["error"] == "push_failed" and "segredo" not in r.text
    assert _auditorias(banco) == []


# ── configuração remota do app ───────────────────────────────────────────────────────────────────────────
def test_config_get_devolve_todos_os_campos(cli, banco):
    j = cli.get("/admin/api/app-config").json()
    assert set(j) == set(admin._CONFIG_CAMPOS) | {"updated_at", "updated_by"}
    assert j["updated_by"] is None and j["min_version_ios"] is None


def test_config_put_grava_audita_o_diff_e_carimba_quem_mudou(cli, banco):
    corpo = {"min_version_ios": "1.5.0", "latest_version_android": "1.6.2", "store_url_ios": "https://apps.apple.com/x",
             "notice_title": "Manutenção", "notice_body": "Sábado às 22h", "notice_level": "warning",
             "notice_until": "2026-10-20T12:00:00Z"}
    r = cli.put("/admin/api/app-config", json=corpo)
    assert r.status_code == 200 and r.json()["min_version_ios"] == "1.5.0" and r.json()["updated_by"] == str(ADMIN)
    (aud,) = _auditorias(banco)
    assert aud[1] == "app_config_changed" and aud[2] is None
    diff = aud[4].obj["changes"]
    assert diff["min_version_ios"] == {"from": None, "to": "1.5.0"}
    assert set(diff) == {"min_version_ios", "latest_version_android", "store_url_ios", "notice_title", "notice_body",
                         "notice_level", "notice_until"}
    assert banco["escritas"][0] == ("BEGIN",) and banco["escritas"][-1] == ("COMMIT",)


def test_config_put_sem_mudanca_nao_escreve_nem_audita(cli, banco):
    assert cli.put("/admin/api/app-config", json={}).status_code == 200
    assert _auditorias(banco) == [] and not any("update public.app_config" in s for s in banco["sql"])


def test_config_string_vazia_vira_nulo_e_remove_o_valor(cli, banco):
    banco["config"]["min_version_ios"] = "1.4.0"
    assert cli.put("/admin/api/app-config", json={"min_version_ios": ""}).json()["min_version_ios"] is None
    (aud,) = _auditorias(banco)
    assert aud[4].obj["changes"] == {"min_version_ios": {"from": "1.4.0", "to": None}}


@pytest.mark.parametrize("corpo", [
    {"min_version_ios": "1.4"}, {"min_version_android": "v1.4.0"}, {"latest_version_ios": "1.4.0-beta"},
    {"latest_version_android": "1.4.x"}, {"store_url_ios": "http://apps.apple.com/x"},
    {"store_url_android": "play.google.com/x"}, {"store_url_ios": "https://evil.example/app"},
    {"store_url_ios": "https://apps.apple.com.evil.example/x"}, {"store_url_android": "https://apps.apple.com/x"},
    {"store_url_ios": "https://play.google.com/x"}, {"store_url_android": "https://evil.example/play.google.com/"},
    {"notice_level": "grave"}, {"notice_until": "amanhã"},
])
def test_config_valida_versao_url_e_nivel(cli, banco, corpo):
    r = cli.put("/admin/api/app-config", json=corpo)
    assert r.status_code == 422 and r.json()["error"] == "invalid_request"
    assert banco["escritas"] == []


def test_config_aceita_o_objeto_que_o_get_devolveu(cli, banco):
    j = cli.get("/admin/api/app-config").json()
    assert cli.put("/admin/api/app-config", json=j).status_code == 200  # updated_at/updated_by são ignorados


def test_config_mesmo_instante_em_outro_fuso_nao_e_mudanca(cli, banco):
    banco["config"]["notice_until"] = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
    assert cli.put("/admin/api/app-config", json={"notice_until": "2026-10-20T09:00:00-03:00"}).status_code == 200
    assert _auditorias(banco) == []
    # sem fuso na entrada vale Brasília
    cli.put("/admin/api/app-config", json={"notice_until": "2026-10-21T09:00:00"})
    (aud,) = _auditorias(banco)
    assert aud[4].obj["changes"]["notice_until"]["to"] == "2026-10-21T09:00:00-03:00"


@pytest.mark.parametrize("corpo", [
    {"store_url_ios": "https://apps.apple.com/br/app/proops/id1"}, {"store_url_ios": "https://itunes.apple.com/br/app/id1"},
    {"store_url_android": "https://play.google.com/store/apps/details?id=com.proops.personal"}])
def test_config_aceita_so_os_hosts_das_lojas(cli, banco, corpo):
    assert cli.put("/admin/api/app-config", json=corpo).status_code == 200
