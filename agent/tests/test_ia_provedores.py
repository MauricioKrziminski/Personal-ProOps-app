"""O cliente Claude (langchain-anthropic 1.7.1): parâmetros, payload, schema estrito e mídia.

Tudo offline: nada aqui chama a API, só inspeciona o que seria enviado.
"""

import base64

import pytest
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from app.graph import schemas as S
from app.services import ia

class _S(BaseModel):
    x: int
    y: int | None = None


def _payload(cliente, schema=S.FinancePlan):
    r = cliente.with_structured_output(schema, method="function_calling")
    bound = r.first if hasattr(r, "first") else r
    return bound.bound._get_request_payload([("system", "s"), ("human", "h")], **bound.kwargs)


@pytest.mark.parametrize("papel,thinking,effort,max_tokens,forcada", [
    ("router", "disabled", "low", 8192, True),
    ("parse", "disabled", "low", 8192, True),
    ("batch", "disabled", "low", 8192, True),
    ("gate", "adaptive", "medium", 16000, False),
])
def test_payload_do_claude(papel, thinking, effort, max_tokens, forcada):
    c = ia.llm(papel)
    assert c.temperature is None
    pl = _payload(c)
    assert "temperature" not in {k for k, v in pl.items() if v is not None}
    assert pl["thinking"] == {"type": thinking}
    assert pl["max_tokens"] == max_tokens
    assert pl["output_config"] == {"effort": effort}
    (tool,) = pl["tools"]
    assert tool["name"] == "FinancePlan" and "actions" in tool["input_schema"]["properties"]
    # Haiku (thinking desligado): tool forçada. Sonnet 5.5 REJEITA forçada: adaptive => sem tool_choice
    if forcada:
        assert pl["tool_choice"] == {"type": "tool", "name": "FinancePlan"}
    else:
        assert pl.get("tool_choice") in (None, {"type": "auto"})


def test_thinking_do_claude_e_fixo_por_familia(monkeypatch):
    """Sonnet/Opus 5.5 com thinking diferente de adaptive viraria tool_choice forçado (400)."""
    monkeypatch.setenv("IA_RACIOCINIO_GATE", "high")
    for nome in ("claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5-6"):
        assert ia._config_claude(nome, None)["thinking"] == {"type": "adaptive"}
        assert ia._config_claude(nome, "low")["thinking"] == {"type": "adaptive"}
    assert ia._config_claude("claude-haiku-5-5", "high")["thinking"] == {"type": "disabled"}
    for papel in ("router", "parse", "batch", "gate"):
        assert ia.llm(papel).thinking["type"] == (
            "disabled" if "haiku" in ia.modelo(papel) else "adaptive")


def _sem_tool_call(monkeypatch):
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    async def _agenerate(self, *a, **k):
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="texto solto"))])

    monkeypatch.setattr(ChatAnthropic, "_agenerate", _agenerate)


async def test_sonnet_sem_tool_call_levanta_e_vai_a_reserva(monkeypatch):
    """thinking adaptive: sem tool call o langchain levanta OutputParserException (= saída inválida)."""
    from langchain_core.exceptions import OutputParserException
    from langchain_core.runnables import RunnableLambda

    _sem_tool_call(monkeypatch)
    cadeia = ia._com_schema(ia.llm("gate"), "claude-sonnet-5-5", _S)
    with pytest.raises(OutputParserException):
        await cadeia.ainvoke("oi")

    ia._falhas.clear()
    r = ia._ComReserva(runnable=cadeia, fallbacks=[RunnableLambda(lambda _: "reserva")],
                           chave="sonnet", metadados={})
    assert await r.ainvoke("oi") == "reserva"
    assert "sonnet" not in ia._falhas  # saída inválida não abre o disjuntor


async def test_haiku_sem_tool_call_devolve_none_e_vai_a_reserva(monkeypatch):
    from langchain_core.runnables import RunnableLambda

    _sem_tool_call(monkeypatch)
    cadeia = ia._com_schema(ia.llm("router"), "claude-haiku-5-5", _S)
    assert await cadeia.ainvoke("oi") is None
    r = ia._ComReserva(runnable=cadeia, fallbacks=[RunnableLambda(lambda _: "reserva")],
                           chave="haiku", metadados={})
    assert await r.ainvoke("oi") == "reserva"


async def test_sombra_no_claude_usa_function_calling_com_raw(monkeypatch):
    _sem_tool_call(monkeypatch)
    c = ia._construir("claude-haiku-5-5", None, 0.1, 30, 0, callbacks=False)
    assert c.callbacks is None
    r = await ia._com_schema(c, "claude-haiku-5-5", _S, include_raw=True).ainvoke("oi")
    assert r["parsed"] is None and r["raw"].content == "texto solto"


def test_prazo_e_tentativas_vao_ao_cliente():
    c = ia.llm("router", timeout=10, max_retries=0)
    assert (c.default_request_timeout, c.max_retries) == (10, 0)


@pytest.mark.parametrize("erro,fora", [
    ("anthropic.APIConnectionError", True), ("anthropic.APITimeoutError", True),
    ("anthropic.InternalServerError", True), ("anthropic.RateLimitError", True),
])
def test_indisponivel_por_classe_do_sdk(erro, fora):
    import anthropic
    import httpx

    cls = getattr(anthropic, erro.split(".")[1])
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    if cls is anthropic.APIConnectionError or cls is anthropic.APITimeoutError:
        e = cls(request=req)
    else:
        status = 429 if cls is anthropic.RateLimitError else 500
        e = cls("x", response=httpx.Response(status, request=req), body=None)
    assert ia._indisponivel(e) is fora


def _http(status, mensagem):
    import anthropic
    import httpx

    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    corpo = {"type": "error", "error": {"type": "invalid_request_error", "message": mensagem}}
    return anthropic.APIStatusError(mensagem, response=httpx.Response(status, request=req),
                                    body=corpo)


def test_indisponivel_529_402_e_credito_esgotado():
    assert ia._indisponivel(_http(529, "Overloaded"))
    assert ia._indisponivel(_http(402, "billing"))
    assert ia._indisponivel(_http(400, "Your credit balance is too low to access the API"))
    assert not ia._indisponivel(_http(400, "schema inválido"))


def test_precos_do_claude():
    assert ia.custo_usd("claude-haiku-5-5", 1_000_000, 1_000_000) == 0.6
    assert ia.custo_usd("claude-sonnet-5-5", 1_000_000, 1_000_000) == 12.0


B64 = base64.b64encode(b"abc").decode()


def test_midia_vira_bloco_do_anthropic_e_inline_data_do_gemini():
    from langchain_anthropic.chat_models import _format_messages
    from langchain_google_genai.chat_models import _parse_chat_history

    from app.graph.nodes import _turno_humano

    for mime, bloco in (("image/png", "image"), ("application/pdf", "document")):
        msg = _turno_humano("t", {"mime_type": mime, "data_b64": B64})
        assert isinstance(msg, HumanMessage)
        _, formatadas = _format_messages([msg])
        parte = formatadas[0]["content"][1]
        assert parte["type"] == bloco
        assert parte["source"] == {"type": "base64", "media_type": mime, "data": B64}
        _, (conteudo,) = _parse_chat_history([msg])
        blob = conteudo.parts[1].inline_data
        assert (blob.mime_type, blob.data) == (mime, b"abc")


def test_usage_e_modelo_chegam_ao_coletor_pelo_formato_do_anthropic():
    from types import SimpleNamespace

    from langchain_anthropic.chat_models import _create_usage_metadata

    from app.services import consumo

    uso = _create_usage_metadata(SimpleNamespace(
        input_tokens=100, output_tokens=20, cache_read_input_tokens=50,
        cache_creation_input_tokens=0))
    assert uso["input_tokens"] == 150 and uso["input_token_details"]["cache_read"] == 50
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, LLMResult

    msg = AIMessage(content="{}", usage_metadata=uso,
                    response_metadata={"model_name": "claude-haiku-5-5"})
    turno = consumo.abrir()
    consumo.coletor.on_chat_model_start({}, [[]], run_id="a", metadata={"papel": "router"})
    consumo.coletor.on_llm_end(LLMResult(generations=[[ChatGeneration(message=msg)]]), run_id="a")
    (c,) = turno.chamadas
    assert (c["modelo"], c["input_tokens"], c["output_tokens"], c["cached_tokens"]) == (
        "claude-haiku-5-5", 150, 20, 50)
    assert c["custo_usd"] == pytest.approx((150 * 0.10 + 20 * 0.50) / 1e6)
