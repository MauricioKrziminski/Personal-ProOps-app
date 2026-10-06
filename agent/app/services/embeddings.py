"""Vetores de texto para a busca semântica de lançamento (`resolve.por_transacao`).

Duas portas, as duas com a MESMA garantia: **falhar nunca é erro para quem chamou**. Sem chave,
429 do nível gratuito (os limites do embedding não são documentados), prazo estourado, resposta
fora de forma — tudo devolve `None`, e quem chama cai no comportamento lexical de sempre.

Modelo: `gemini-embedding-2` (06/10/2026). O `gemini-embedding-001` respondeu 429 no nível
gratuito do staging enquanto o 2 respondia; o 2 também é o de preço público no gratuito. Usamos
`DIMENSOES = 768` (truncamento MRL) e a norma unitária é refeita aqui de qualquer forma — é ela que
faz `1 - (a <=> b)` do pgvector ser um cosseno comparável entre chamadas. Os espaços dos dois
modelos NÃO se comparam: o job revetoriza o que foi gravado com outro modelo (`e.model <> %s`).

`task_type` (documento `RETRIEVAL_DOCUMENT`, consulta `RETRIEVAL_QUERY`) continua indo: o 2 aceita
o campo sem erro, e o par assimétrico é o que a doc do 001 recomendava.
"""

from __future__ import annotations

import asyncio
import logging
import math
from typing import Any

from app.config import get_settings
from app.services import consumo
from app.services.gemini import modelo

log = logging.getLogger(__name__)

DIMENSOES = 768  # tem que ser a mesma de `extensions.vector(768)` na migration
PRAZO_CONSULTA = 4.0  # s — está no caminho de uma conversa; passou disso, vale o lexical
PRAZO_DOCUMENTOS = 30.0  # s — o job tem folga

_cliente: Any = None


def _embeddings() -> Any:
    """O cliente do langchain, criado na primeira chamada (os testes sobem sem chave)."""
    global _cliente
    if _cliente is None:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        _cliente = GoogleGenerativeAIEmbeddings(
            model=modelo("embedding"),
            google_api_key=get_settings().gemini_api_key,
            output_dimensionality=DIMENSOES,
        )
    return _cliente


def normalizar(vetor: list[float]) -> list[float] | None:
    """Norma unitária; `None` se o vetor não tem o tamanho certo ou é nulo."""
    if len(vetor) != DIMENSOES:
        return None
    norma = math.sqrt(math.fsum(x * x for x in vetor))
    if norma == 0:
        return None
    return [x / norma for x in vetor]


def literal(vetor: list[float]) -> str:
    """O vetor como literal do pgvector (`'[0.1,0.2,...]'::extensions.vector`)."""
    return "[" + ",".join(f"{x:.7g}" for x in vetor) + "]"


def _registrar(no: str, textos: int) -> None:
    """Põe a chamada no consumo do turno, se houver um aberto.

    O `ColetorDeUso` só escuta chat model; o cliente de embedding não dispara callback. A
    resposta do SDK que o langchain devolve também não traz contagem de tokens, então os campos
    ficam `None` (custo `None`, nunca chutado) e a chamada ao menos aparece no detalhe do turno.
    `scripts/probe_busca_semantica.py` imprime o que o SDK expõe, para ligar o custo depois.
    """
    atual = consumo.atual()
    if atual is None:
        return
    atual.somar({
        "papel": "embedding", "no": no, "versao_prompt": None, "reserva": False,
        "modelo": modelo("embedding"), "input_tokens": None, "output_tokens": None,
        "cached_tokens": None, "reasoning_tokens": None, "custo_usd": None,
        "textos": textos,
    })


async def embed_consulta(texto: str) -> list[float] | None:
    """Vetor da frase que a pessoa disse, ou `None` se algo falhou."""
    texto = (texto or "").strip()
    if not texto:
        return None
    try:
        bruto = await asyncio.wait_for(
            _embeddings().aembed_query(texto, task_type="RETRIEVAL_QUERY"), PRAZO_CONSULTA
        )
        vetor = normalizar(list(bruto))
    except Exception:  # noqa: BLE001 — sem semântica, cai no lexical
        log.warning("embedding da consulta falhou — busca só por texto", exc_info=True)
        return None
    if vetor is not None:
        _registrar("busca_semantica", 1)
    return vetor


async def embed_documentos(textos: list[str]) -> list[list[float]] | None:
    """Um vetor por texto, na ordem; `None` se QUALQUER item falhou (lote tudo-ou-nada)."""
    if not textos:
        return []
    try:
        brutos = await asyncio.wait_for(
            _embeddings().aembed_documents(textos, task_type="RETRIEVAL_DOCUMENT"),
            PRAZO_DOCUMENTOS,
        )
        vetores = [normalizar(list(b)) for b in brutos]
    except Exception:  # noqa: BLE001
        log.warning("embedding dos documentos falhou — o job tenta na próxima rodada", exc_info=True)
        return None
    if len(vetores) != len(textos) or any(v is None for v in vetores):
        log.warning("embedding dos documentos veio fora de forma")
        return None
    return vetores  # type: ignore[return-value]
