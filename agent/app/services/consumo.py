"""Consumo de IA por turno: tokens, modelo REAL que respondeu e custo estimado.

Um `ColetorDeUso` (callback do langchain) fica em todo cliente de IA (`ia.llm`: Claude ou Gemini) e lê o
`usage_metadata` de cada resposta. Quem acumula é o `ConsumoDoTurno` do turno corrente, guardado
num `ContextVar`: o motor abre um por turno (`abrir`), e toda chamada feita dentro dele — nó do
grafo, portão, rascunho, lote de extrato — soma no MESMO objeto, sem ninguém precisar passar nada.
Fora de um turno aberto o coletor ignora a resposta.

Também mora aqui a RESERVA de cota (`reserva`): a linha provisória de `ai_events` que
`db.reservar_cota` cria sob lock e que `db.record_ai_event` completa (ou `conversation._audit`
solta, se o turno não chamou o modelo).
"""

from __future__ import annotations

import contextvars
import logging
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

log = logging.getLogger(__name__)


class ConsumoDoTurno:
    """As chamadas de modelo de UM turno, na ordem em que terminaram."""

    def __init__(self) -> None:
        self.chamadas: list[dict[str, Any]] = []

    def somar(self, chamada: dict[str, Any]) -> None:
        self.chamadas.append(chamada)

    def totais(self) -> dict[str, Any]:
        """Somas para as colunas de `ai_events`; tudo `None` quando nada foi medido.

        O custo é `None` se QUALQUER chamada com token for de modelo sem preço na tabela:
        somar só o que se conhece subestimaria em silêncio, e `ia.md` manda não chutar.
        """
        if not self.chamadas:
            return {"input_tokens": None, "output_tokens": None, "cached_tokens": None,
                    "reasoning_tokens": None, "custo_usd": None, "chamadas": []}
        custos = [c["custo_usd"] for c in self.chamadas if c.get("input_tokens") or c.get("output_tokens")]
        return {
            "input_tokens": sum(c.get("input_tokens") or 0 for c in self.chamadas),
            "output_tokens": sum(c.get("output_tokens") or 0 for c in self.chamadas),
            "cached_tokens": sum(c.get("cached_tokens") or 0 for c in self.chamadas),
            "reasoning_tokens": sum(c.get("reasoning_tokens") or 0 for c in self.chamadas),
            "custo_usd": (round(sum(custos), 6) if custos and None not in custos else None),
            "chamadas": self.chamadas,
        }


_atual: contextvars.ContextVar[ConsumoDoTurno | None] = contextvars.ContextVar(
    "consumo_do_turno", default=None
)


def abrir() -> ConsumoDoTurno:
    """Começa a contar um turno novo (substitui o anterior do mesmo contexto)."""
    consumo = ConsumoDoTurno()
    _atual.set(consumo)
    return consumo


def atual() -> ConsumoDoTurno | None:
    return _atual.get()


class ColetorDeUso(BaseCallbackHandler):
    """Lê tokens e modelo real de cada resposta do chat model."""

    # inline: roda no próprio loop, no mesmo contexto — o `ContextVar` do turno é visível
    run_inline = True

    def __init__(self) -> None:
        self._em_voo: dict[Any, dict] = {}

    def on_chat_model_start(self, serialized, messages, *, run_id, metadata=None, **kwargs):
        self._em_voo[run_id] = dict(metadata or {})

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._em_voo.pop(run_id, None)

    def on_llm_end(self, response, *, run_id, **kwargs):
        meta = self._em_voo.pop(run_id, {})
        consumo = _atual.get()
        if consumo is None:
            return
        try:
            consumo.somar(_chamada(response, meta))
        except Exception:  # noqa: BLE001 — contar nunca derruba o turno
            log.warning("consumo de IA não lido", exc_info=True)


def _chamada(response: Any, meta: dict) -> dict[str, Any]:
    from app.services.ia import custo_usd

    msg = response.generations[0][0].message
    uso = getattr(msg, "usage_metadata", None) or {}
    resposta = getattr(msg, "response_metadata", None) or {}
    # o modelo que de fato respondeu: com a reserva do `structured` ele não é o do papel
    modelo = resposta.get("model_name") or meta.get("ls_model_name") or None
    entrada = int(uso.get("input_tokens") or 0)
    # `output_tokens` do langchain-google-genai JÁ inclui os de raciocínio (candidates + thoughts)
    saida = int(uso.get("output_tokens") or 0)
    return {
        "papel": meta.get("papel"),
        "no": meta.get("no"),
        "versao_prompt": meta.get("prompt_versao"),
        "reserva": bool(meta.get("reserva")),
        "reserva_motivo": meta.get("reserva_motivo"),
        "modelo": modelo,
        "input_tokens": entrada,
        "output_tokens": saida,
        "cached_tokens": int((uso.get("input_token_details") or {}).get("cache_read") or 0),
        "reasoning_tokens": int((uso.get("output_token_details") or {}).get("reasoning") or 0),
        "custo_usd": custo_usd(modelo, entrada, saida),
    }


coletor = ColetorDeUso()

# ---------------------------------------------------------------------------
# reserva de cota
# ---------------------------------------------------------------------------
# `check_limits` reserva a linha antes do turno (sob lock, para N conversas paralelas não
# passarem juntas); o fim do turno a completa com o uso real ou a solta.

_reserva: contextvars.ContextVar[str | None] = contextvars.ContextVar("reserva_de_cota", default=None)


def guardar_reserva(reserva_id: str | None) -> None:
    _reserva.set(str(reserva_id) if reserva_id else None)


def reserva_atual() -> str | None:
    return _reserva.get()


def consumir_reserva() -> str | None:
    """A reserva do contexto, uma vez só: quem a pega fica responsável por completá-la."""
    reserva_id = _reserva.get()
    _reserva.set(None)
    return reserva_id
