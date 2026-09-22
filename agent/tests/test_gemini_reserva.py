"""A reserva de disponibilidade: o Lite fora do ar cai no modelo do portão; o portão não cai."""

from langchain_core.runnables.fallbacks import RunnableWithFallbacks
from pydantic import BaseModel

from app.services import gemini


class _S(BaseModel):
    x: int


def _modelo(runnable) -> str:
    # with_structured_output devolve uma sequência cujo primeiro passo é o chat model (bound)
    primeiro = runnable.first if hasattr(runnable, "first") else runnable
    return getattr(getattr(primeiro, "bound", primeiro), "model", "")


def test_papeis_de_volume_tem_reserva_no_modelo_do_portao():
    for papel in ("router", "parse", "batch"):
        r = gemini.structured(_S, papel)
        assert isinstance(r, RunnableWithFallbacks), papel
        assert gemini.modelo(papel) in _modelo(r.runnable)
        assert gemini.modelo("gate") in _modelo(r.fallbacks[0])


def test_portao_nao_tem_reserva():
    # a reserva natural do portão seria o Lite, que já aprovou "apaga todos"
    assert not isinstance(gemini.structured(_S, gemini.GEMINI_GATE), RunnableWithFallbacks)
    assert not isinstance(gemini.structured(_S, "gate"), RunnableWithFallbacks)
