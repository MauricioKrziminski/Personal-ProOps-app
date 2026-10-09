"""A reserva de disponibilidade entre provedores: Haiku -> Sonnet -> Gemini flash.

Com `IA_PROVEDOR=gemini` (as suítes) vale a cadeia antiga: o Lite cai no modelo do portão, e o
portão não cai.
"""

import pytest
from langchain_core.runnables.fallbacks import RunnableWithFallbacks
from pydantic import BaseModel

from app.services import gemini


class _S(BaseModel):
    x: int
    y: int | None = None


def _modelo(runnable) -> str:
    """O nome do modelo do primeiro passo da cadeia (chat model, com ou sem bind)."""
    primeiro = runnable.first if hasattr(runnable, "first") else runnable
    return getattr(getattr(primeiro, "bound", primeiro), "model", "")


def test_cadeia_com_claude_haiku_sonnet_gemini():
    for papel in ("router", "parse", "batch"):
        r = gemini.structured(_S, papel)
        assert isinstance(r, gemini._ComReserva), papel
        assert _modelo(r.runnable) == "claude-haiku-5-5"
        assert r.chave == "claude-haiku-5-5"
        sonnet = r.fallbacks[0]
        assert isinstance(sonnet, gemini._ComReserva)
        assert _modelo(sonnet.runnable) == "claude-sonnet-5-5"
        assert sonnet.chave == "claude-sonnet-5-5"
        # o rótulo do consumo continua sendo o do papel que pediu, também na reserva
        assert sonnet.metadados["papel"] == papel
        assert gemini.modelo("gate") == "claude-sonnet-5-5"
        # a última parada do volume é o Lite (o flash estava em 503 quando a reserva foi medida)
        assert _modelo(sonnet.fallbacks[0]) == gemini.MODELOS_GEMINI[papel]


def test_portao_com_claude_tem_reserva_no_gemini():
    r = gemini.structured(_S, "gate")
    assert isinstance(r, gemini._ComReserva)
    assert _modelo(r.runnable) == "claude-sonnet-5-5"
    assert len(r.fallbacks) == 1 and "gemini-3.7-flash" in _modelo(r.fallbacks[0])


def test_com_ia_provedor_gemini_vale_a_cadeia_antiga(monkeypatch):
    monkeypatch.setenv("IA_PROVEDOR", "gemini")
    for papel in ("router", "parse", "batch"):
        r = gemini.structured(_S, papel)
        assert isinstance(r, RunnableWithFallbacks), papel
        assert _modelo(r.runnable) == "gemini-3.1-flash-lite"
        assert "gemini-3.7-flash" in _modelo(r.fallbacks[0])
    # a reserva natural do portão seria o Lite, que já aprovou "apaga todos"
    assert not isinstance(gemini.structured(_S, "gate"), RunnableWithFallbacks)


def test_ia_provedor_invalido_levanta(monkeypatch):
    monkeypatch.setenv("IA_PROVEDOR", "gemni")
    with pytest.raises(ValueError, match="IA_PROVEDOR"):
        gemini.modelo("gate")
    monkeypatch.setenv("IA_PROVEDOR", "claude")
    assert gemini.modelo("gate") == "claude-sonnet-5-5"
    monkeypatch.setenv("IA_PROVEDOR", "")
    assert gemini.modelo("gate") == "claude-sonnet-5-5"


def test_provedor_pelo_nome():
    assert gemini.provedor("claude-haiku-5-5") == "anthropic"
    assert gemini.provedor("gemini-3.7-flash") == "gemini"
    with pytest.raises(ValueError):
        gemini.provedor("gpt-5")


def test_raciocinio_por_papel_so_com_a_variavel_no_gemini(monkeypatch):
    monkeypatch.setenv("IA_PROVEDOR", "gemini")
    monkeypatch.delenv("GEMINI_THINKING_GATE", raising=False)
    assert gemini.raciocinio("gate") is None
    assert gemini.llm("gate").reasoning_effort is None  # o padrão do modelo

    monkeypatch.setenv("GEMINI_THINKING_GATE", "low")
    assert gemini.llm("gate").reasoning_effort == "low"
    assert gemini.llm("parse").reasoning_effort is None  # só o papel da variável

    monkeypatch.setenv("GEMINI_THINKING_GATE", "baixo")
    with pytest.raises(ValueError):
        gemini.raciocinio("gate")


def test_raciocinio_no_claude_vira_effort(monkeypatch):
    # padrão por família; a variável do papel troca o effort ("minimal" vale "low")
    assert gemini.llm("gate").reasoning_effort == "medium"
    assert gemini.llm("parse").reasoning_effort == "low"
    monkeypatch.setenv("GEMINI_THINKING_GATE", "high")
    assert gemini.llm("gate").reasoning_effort == "high"
    monkeypatch.setenv("GEMINI_THINKING_PARSE", "minimal")
    assert gemini.llm("parse").reasoning_effort == "low"
