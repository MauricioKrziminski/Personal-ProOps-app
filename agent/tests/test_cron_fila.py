"""Checagem da fila no cron de minuto: só loga ERROR com `alerta` quando há o que alertar."""

import logging

from app.routes import cron


def _db(monkeypatch, paradas, falhas, erro=False):
    async def fetch_one(*_a):
        if erro:
            raise RuntimeError("banco fora")
        return {"paradas": paradas, "falhas": falhas}

    monkeypatch.setattr(cron.db, "fetch_one", fetch_one)


async def test_fila_saudavel_nao_alerta(monkeypatch, caplog):
    _db(monkeypatch, 0, 0)
    caplog.set_level(logging.INFO)
    assert await cron.checar_fila() == {"pendentes_antigas": 0, "falhas_1h": 0}
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


async def test_fila_parada_e_falhas_viram_error_com_alerta(monkeypatch, caplog):
    _db(monkeypatch, 2, 1)
    await cron.checar_fila()
    erros = {r.alerta: r for r in caplog.records if r.levelno == logging.ERROR}
    assert erros["fila_parada"].pendentes == 2
    assert erros["falhas_definitivas"].falhas == 1


async def test_banco_fora_nao_derruba_o_cron(monkeypatch):
    _db(monkeypatch, 0, 0, erro=True)
    assert "error" in await cron.checar_fila()
