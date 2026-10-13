"""Páginas legais: públicas, HTML, sem script nem recurso externo."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import legal

client = TestClient(FastAPI())
client.app.include_router(legal.router)


@pytest.mark.parametrize(
    "rota,titulo",
    [
        ("/termos", "Termos de Uso"),
        ("/privacidade", "Política de Privacidade"),
        ("/apagar-conta", "Apagar conta"),
    ],
)
def test_pagina_legal(rota, titulo):
    r = client.get(rota)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert titulo in r.text
    assert "<script" not in r.text.lower()
    # nenhum recurso externo carregado (link de texto para um site é permitido)
    assert 'src="http' not in r.text and '<link rel="stylesheet" href="http' not in r.text
    assert "noindex" not in r.text.lower() and "noindex" not in r.headers.get("x-robots-tag", "")


def test_descadastro_get_so_pergunta(monkeypatch):
    chamadas = []
    monkeypatch.setattr(legal.db, "execute", lambda *a: chamadas.append(a))
    tok = "11111111-2222-4333-8444-555555555555"
    r = client.get(f"/contato/sair/{tok}")
    assert r.status_code == 200 and f'action="/contato/sair/{tok}"' in r.text and 'method="post"' in r.text
    assert chamadas == [], "abrir o link não descadastra (leitor de e-mail abre sozinho)"
    assert r.headers["cache-control"] == "no-store" and "noindex" in r.headers["x-robots-tag"]


def test_descadastro_post_grava_e_token_invalido(monkeypatch):
    gravados = []

    async def execute(sql, *args):
        gravados.append(args)
        return 1 if str(args[0]).startswith("1111") else 0

    monkeypatch.setattr(legal.db, "execute", execute)
    ok = client.post("/contato/sair/11111111-2222-4333-8444-555555555555", data={"List-Unsubscribe": "One-Click"})
    assert ok.status_code == 200 and "Pronto" in ok.text
    assert client.post("/contato/sair/99999999-2222-4333-8444-555555555555").status_code == 404
    assert client.post("/contato/sair/nao-e-uuid").status_code == 404
    assert client.get("/contato/sair/<script>").status_code == 404
    assert len(gravados) == 2, "token que não é uuid nem chega ao banco"
