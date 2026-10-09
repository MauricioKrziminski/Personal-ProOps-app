"""Modo sombra: desligado por padrão; ligado, loga a divergência sem mudar nem atrasar a resposta."""

import asyncio
import logging
from types import SimpleNamespace

from pydantic import BaseModel

from app.services import gemini


class _S(BaseModel):
    x: int
    y: list[str] = []


class _Principal:
    def __init__(self, resp):
        self.resp = resp

    async def ainvoke(self, entrada, config=None, **kw):
        return self.resp


def _liga(monkeypatch, retorno_sombra, falha=False):
    monkeypatch.setenv("GEMINI_SHADOW_PARSE", "gemini-sombra-x")
    monkeypatch.setattr(gemini, "_structured", lambda *a, **k: _Principal(_S(x=1, y=["a"])))

    class _Cliente:
        def __init__(self, **kw):
            pass

        def with_structured_output(self, schema, include_raw=False):
            assert include_raw
            return self

        async def ainvoke(self, entrada):
            if falha:
                raise RuntimeError("sombra caiu")
            return retorno_sombra

    gemini._clientes_sombra.clear()
    monkeypatch.setattr(gemini, "ChatGoogleGenerativeAI", _Cliente)


def test_desligado_devolve_o_runnable_de_sempre(monkeypatch):
    monkeypatch.delenv("GEMINI_SHADOW_PARSE", raising=False)
    sentinela = object()
    monkeypatch.setattr(gemini, "_structured", lambda *a, **k: sentinela)
    assert gemini.structured(_S, "parse") is sentinela


def test_campos_divergentes():
    assert gemini.campos_divergentes(_S(x=1, y=["a", "b"]), _S(x=2, y=["a"])) == ["x", "y[1]"]
    assert gemini.campos_divergentes(_S(x=1), _S(x=1)) == []


async def test_loga_diff_e_nao_muda_a_resposta(monkeypatch, caplog):
    raw = SimpleNamespace(usage_metadata={"input_tokens": 1000, "output_tokens": 100})
    _liga(monkeypatch, {"raw": raw, "parsed": _S(x=2, y=["a"]), "parsing_error": None})
    caplog.set_level(logging.INFO, logger="app.services.gemini")

    resposta = await gemini.structured(_S, "parse", no="teste").ainvoke("oi")
    assert resposta == _S(x=1, y=["a"])
    await asyncio.gather(*gemini._sombras_vivas)

    reg = next(r for r in caplog.records if r.getMessage() == "shadow_diff")
    assert reg.shadow["campos"] == ["x"] and reg.shadow["divergiu"]
    assert reg.shadow["papel"] == "parse" and reg.shadow["no"] == "teste"
    assert reg.shadow["modelo_sombra"] == "gemini-sombra-x"
    assert "custo_usd" in reg.shadow


async def test_erro_da_sombra_so_loga(monkeypatch, caplog):
    _liga(monkeypatch, None, falha=True)
    caplog.set_level(logging.INFO, logger="app.services.gemini")
    assert await gemini.structured(_S, "parse").ainvoke("oi") == _S(x=1, y=["a"])
    await asyncio.gather(*gemini._sombras_vivas)
    assert any("shadow_diff falhou" in r.getMessage() for r in caplog.records)


def test_aviso_no_boot(monkeypatch, caplog):
    monkeypatch.setenv("GEMINI_SHADOW_GATE", "gemini-sombra-x")
    caplog.set_level(logging.WARNING, logger="app.services.gemini")
    gemini.avisar_sombras()
    assert any("MODO SOMBRA" in r.getMessage() for r in caplog.records)
