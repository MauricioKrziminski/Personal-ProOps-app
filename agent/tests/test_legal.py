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
