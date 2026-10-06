"""Checagem da fila no cron de minuto: só loga ERROR com `alerta` quando há o que alertar."""

import logging

from app.routes import cron


def _db(monkeypatch, paradas, falhas, erro=False, custo=0):
    async def fetch_one(sql, *_a):
        if erro:
            raise RuntimeError("banco fora")
        if "ai_events" in sql:
            return {"custo": custo}
        return {"paradas": paradas, "falhas": falhas}

    monkeypatch.setattr(cron.db, "fetch_one", fetch_one)


async def test_fila_saudavel_nao_alerta(monkeypatch, caplog):
    _db(monkeypatch, 0, 0)
    caplog.set_level(logging.INFO)
    assert await cron.checar_fila() == {"pendentes_antigas": 0, "falhas_1h": 0, "custo_24h_usd": 0.0}
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


async def test_custo_de_24h_acima_do_teto_vira_alerta(monkeypatch, caplog):
    teto = cron.get_settings().custo_diario_alerta_usd
    _db(monkeypatch, 0, 0, custo=teto + 0.5)
    assert (await cron.checar_fila())["custo_24h_usd"] == teto + 0.5
    erros = {r.alerta: r for r in caplog.records if r.levelno == logging.ERROR}
    assert erros["custo_diario"].custo_usd == round(teto + 0.5, 4)

    caplog.clear()
    _db(monkeypatch, 0, 0, custo=teto)  # no teto não alerta
    await cron.checar_fila()
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]
