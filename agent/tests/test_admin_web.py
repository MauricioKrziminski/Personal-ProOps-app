"""Serving do SPA do /admin: 404 desligado, 503 sem build, fallback do SPA, CSP e build nunca versionado."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import get_settings
from app.routes import admin_web

ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


@pytest.fixture
def cli(monkeypatch, tmp_path):
    get_settings.cache_clear()
    monkeypatch.setenv("ADMIN_USER_IDS", ADMIN)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co/")
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>spa</html>")
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log(1)")
    (tmp_path / "theme.js").write_text("//t")
    monkeypatch.setattr(admin_web, "DIST", tmp_path)
    app = FastAPI()
    app.include_router(admin_web.router)
    yield TestClient(app)
    get_settings.cache_clear()


def test_desligado_e_404(cli, monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("ADMIN_USER_IDS", "")
    assert cli.get("/admin").status_code == 404
    assert cli.get("/admin/contas").status_code == 404


def test_sem_build_503(cli, monkeypatch, tmp_path):
    monkeypatch.setattr(admin_web, "DIST", tmp_path / "vazio")
    r = cli.get("/admin")
    assert r.status_code == 503 and "build" in r.json()["error"]


def test_index_no_store_e_fallback_do_spa(cli):
    for caminho in ("/admin", "/admin/", "/admin/contas/123", "/admin/auditoria"):
        r = cli.get(caminho)
        assert r.status_code == 200 and "spa" in r.text, caminho
        assert r.headers["cache-control"] == "no-store"
        assert r.headers["x-robots-tag"].startswith("noindex")


def test_csp_so_com_supabase_do_projeto(cli):
    csp = cli.get("/admin").headers["content-security-policy"]
    assert "script-src 'self';" in csp and "connect-src 'self' https://x.supabase.co;" in csp
    assert "frame-ancestors 'none'" in csp and "unsafe-inline" in csp.split("style-src")[1].split(";")[0]
    assert "script-src 'self' 'unsafe-inline'" not in csp


def test_assets_cache_longo_e_arquivo_inexistente_404(cli):
    r = cli.get("/admin/assets/app-abc123.js")
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    assert cli.get("/admin/assets/nao-existe.js").status_code == 404
    assert cli.get("/admin/theme.js").status_code == 200


def test_nao_captura_a_api_nem_sai_do_diretorio(cli):
    r = cli.get("/admin/api/nao-existe")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
    assert "spa" not in cli.get("/admin/../../etc/passwd").text


def test_build_do_painel_nao_e_versionado():
    raiz = Path(__file__).resolve().parents[2]
    r = subprocess.run(["git", "ls-files", "agent/app/static/admin"], cwd=raiz, capture_output=True, text=True)
    if r.returncode != 0:
        pytest.skip("sem git")
    assert r.stdout.strip() == "", "agent/app/static/admin/ é build (Dockerfile) e não pode ir para o git"
