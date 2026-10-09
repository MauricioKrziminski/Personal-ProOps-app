"""A reserva de disponibilidade entre provedores: Haiku -> Sonnet -> Gemini flash.

Com `IA_TABELA=economica` (as suítes) vale a cadeia antiga: o Lite cai no modelo do portão, e o
portão não cai.
"""

import pytest
from langchain_core.runnables.fallbacks import RunnableWithFallbacks
from pydantic import BaseModel

from app.services import ia


class _S(BaseModel):
    x: int
    y: int | None = None


def _modelo(runnable) -> str:
    """O nome do modelo do primeiro passo da cadeia (chat model, com ou sem bind)."""
    primeiro = runnable.first if hasattr(runnable, "first") else runnable
    return getattr(getattr(primeiro, "bound", primeiro), "model", "")


def test_cadeia_com_claude_haiku_sonnet_gemini():
    for papel in ("router", "parse", "batch"):
        r = ia.structured(_S, papel)
        assert isinstance(r, ia._ComReserva), papel
        assert _modelo(r.runnable) == "claude-haiku-5-5"
        assert r.chave == "claude-haiku-5-5"
        sonnet = r.fallbacks[0]
        assert isinstance(sonnet, ia._ComReserva)
        assert _modelo(sonnet.runnable) == "claude-sonnet-5-5"
        assert sonnet.chave == "claude-sonnet-5-5"
        # o rótulo do consumo continua sendo o do papel que pediu, também na reserva
        assert sonnet.metadados["papel"] == papel
        assert ia.modelo("gate") == "claude-sonnet-5-5"
        # a última parada do volume é o Lite (o flash estava em 503 quando a reserva foi medida)
        assert _modelo(sonnet.fallbacks[0]) == ia.MODELOS_ECONOMICOS[papel]


def test_portao_com_claude_tem_reserva_no_gemini():
    r = ia.structured(_S, "gate")
    assert isinstance(r, ia._ComReserva)
    assert _modelo(r.runnable) == "claude-sonnet-5-5"
    assert len(r.fallbacks) == 1 and "gemini-3.7-flash" in _modelo(r.fallbacks[0])


def test_com_ia_provedor_gemini_vale_a_cadeia_antiga(monkeypatch):
    monkeypatch.setenv("IA_TABELA", "economica")
    for papel in ("router", "parse", "batch"):
        r = ia.structured(_S, papel)
        assert isinstance(r, RunnableWithFallbacks), papel
        assert _modelo(r.runnable) == "gemini-3.1-flash-lite"
        assert "gemini-3.7-flash" in _modelo(r.fallbacks[0])
    # a reserva natural do portão seria o Lite, que já aprovou "apaga todos"
    assert not isinstance(ia.structured(_S, "gate"), RunnableWithFallbacks)


def test_ia_provedor_invalido_levanta(monkeypatch):
    monkeypatch.setenv("IA_TABELA", "economca")
    with pytest.raises(ValueError, match="IA_TABELA"):
        ia.modelo("gate")
    monkeypatch.setenv("IA_TABELA", "padrao")
    assert ia.modelo("gate") == "claude-sonnet-5-5"
    monkeypatch.setenv("IA_TABELA", "")
    assert ia.modelo("gate") == "claude-sonnet-5-5"


def test_provedor_pelo_nome():
    assert ia.provedor("claude-haiku-5-5") == "anthropic"
    assert ia.provedor("gemini-3.7-flash") == "gemini"
    with pytest.raises(ValueError):
        ia.provedor("gpt-5")


def test_raciocinio_por_papel_so_com_a_variavel_no_gemini(monkeypatch):
    monkeypatch.setenv("IA_TABELA", "economica")
    monkeypatch.delenv("IA_RACIOCINIO_GATE", raising=False)
    assert ia.raciocinio("gate") is None
    assert ia.llm("gate").reasoning_effort is None  # o padrão do modelo

    monkeypatch.setenv("IA_RACIOCINIO_GATE", "low")
    assert ia.llm("gate").reasoning_effort == "low"
    assert ia.llm("parse").reasoning_effort is None  # só o papel da variável

    monkeypatch.setenv("IA_RACIOCINIO_GATE", "baixo")
    with pytest.raises(ValueError):
        ia.raciocinio("gate")


def test_raciocinio_no_claude_vira_effort(monkeypatch):
    # padrão por família; a variável do papel troca o effort ("minimal" vale "low")
    assert ia.llm("gate").reasoning_effort == "medium"
    assert ia.llm("parse").reasoning_effort == "low"
    monkeypatch.setenv("IA_RACIOCINIO_GATE", "high")
    assert ia.llm("gate").reasoning_effort == "high"
    monkeypatch.setenv("IA_RACIOCINIO_PARSE", "minimal")
    assert ia.llm("parse").reasoning_effort == "low"
