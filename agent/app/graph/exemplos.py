"""Exemplos dinâmicos (few-shot por recuperação) — só com `AGENT_PROMPT_V2` (auditoria 8.3).

Cada bug de prompt vira um EXEMPLO em `exemplos.json`, não uma linha no prompt de todo mundo. Por
turno, os `K` exemplos mais parecidos com a frase (cosseno de embeddings) entram no turno humano
como "Exemplos parecidos".

- **Banco sintético.** Nunca texto de usuário real: exemplo de outro usuário vazaria a frase dele no
  prompt de alguém (LGPD). `tests/test_prompt_v2.py` prende o formato; quem acrescenta exemplo
  escreve a frase do zero.
- **Texto NOSSO, fora do envelope do usuário** (a frase do exemplo não é entrada da pessoa).
- **Falhar nunca derruba o turno.** Sem chave, 429, prazo, índice que não montou: devolve "" e o
  turno segue sem exemplos. O índice é vetorizado UMA vez por processo (na primeira chamada, nunca
  no import) e, se falhar, tenta de novo só depois de `RETENTAR_APOS_S`.
- **Custo:** uma chamada de embedding por turno (`embed_consulta(..., no="exemplos")`, que entra no
  consumo do turno); os dois nós de finanças que rodam em paralelo no mesmo turno compartilham o
  vetor da mesma frase.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import struct
import time
from pathlib import Path

from app.services import embeddings
from app.services.gemini import modelo

log = logging.getLogger(__name__)

ARQUIVO = Path(__file__).with_name("exemplos.json")
# Vetores do banco gerados UMA vez (`scripts/vetorizar_exemplos.py`), versionados junto do json:
# vetorizar 113 frases no runtime custava 113 requisições a cada cold start (`min_instances=0`) e
# nunca montava no nível gratuito (100/min por modelo). `test_prompt_v2` acusa o arquivo defasado.
ARQUIVO_VETORES = Path(__file__).with_name("exemplos_vetores.json")
K = 4
# Calibrado em 06/10/2026 (`scripts/probe_exemplos.py`, gemini-embedding-2): finanças escritas de
# outro jeito tiveram top-1 de 0,640 a 0,972; frases de fora (saudação, nota, lembrete, conversa)
# de 0,508 a 0,771. As faixas SE SOBREPÕEM — o piso não separa domínio, e não precisa: frase de fora
# não chega aos nós de finanças (o router desvia antes). Ele só corta o que nem parece finanças.
SIMILARIDADE_MINIMA = 0.62
RETENTAR_APOS_S = 300.0
GRUPOS = ("parse", "consulta")

_indice: list[tuple[dict, list[float]]] | None = None
_falhou_em: float | None = None
_trava: asyncio.Lock | None = None
_vetores_do_turno: dict[str, asyncio.Future] = {}


def carregar() -> list[dict]:
    """Os exemplos do arquivo, validados (frase, saida e grupo são obrigatórios)."""
    brutos = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    for e in brutos:
        if e.get("grupo") not in GRUPOS or not e.get("frase") or not e.get("saida"):
            raise ValueError(f"exemplo inválido em exemplos.json: {e!r}")
    return brutos


def codificar(vetor: list[float]) -> str:
    """float16 em base64: 1/4 do float32 em texto, e o cosseno não sente a diferença."""
    return base64.b64encode(struct.pack(f"<{len(vetor)}e", *vetor)).decode()


def decodificar(texto: str) -> list[float] | None:
    bruto = base64.b64decode(texto)
    return embeddings.normalizar(list(struct.unpack(f"<{len(bruto) // 2}e", bruto)))


def vetores_gravados() -> dict[str, list[float]]:
    """Frase → vetor do arquivo, só se ele é do modelo em uso (espaços de modelos não se comparam)."""
    try:
        dados = json.loads(ARQUIVO_VETORES.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if dados.get("modelo") != modelo("embedding"):
        log.warning("exemplos_vetores.json é de %s; revetorizando no runtime", dados.get("modelo"))
        return {}
    gravados = {f: decodificar(t) for f, t in dados.get("vetores", {}).items()}
    return {f: v for f, v in gravados.items() if v is not None}


def formatar(exemplos: list[dict]) -> str:
    """O bloco do turno humano. Vazio se não há exemplo."""
    if not exemplos:
        return ""
    linhas = []
    for e in exemplos:
        antes = f' (depois de "{e["antes"]}")' if e.get("antes") else ""
        linhas.append(f'- "{e["frase"]}"{antes} -> {e["saida"]}')
    return (
        "Exemplos parecidos (nossos, sintéticos: frase -> o que extrair. Servem de guia de formato; "
        "valem só onde a frase da pessoa for do mesmo tipo):\n" + "\n".join(linhas)
    )


def _cosseno(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))  # já normalizados


def escolher(vetor: list[float], indice: list[tuple[dict, list[float]]], grupo: str, k: int = K) -> list[dict]:
    """Os `k` exemplos do grupo mais parecidos com o vetor, do mais para o menos, acima do piso."""
    pontuados = sorted(
        ((_cosseno(vetor, v), e) for e, v in indice if e["grupo"] == grupo),
        key=lambda p: p[0], reverse=True,
    )
    return [e for s, e in pontuados[:k] if s >= SIMILARIDADE_MINIMA]


async def _montar_indice() -> list[tuple[dict, list[float]]]:
    """Vetoriza o banco (UMA vez por processo). `[]` se falhar; tenta de novo depois do prazo."""
    global _indice, _falhou_em, _trava
    if _indice is not None:
        return _indice
    if _falhou_em is not None and time.monotonic() - _falhou_em < RETENTAR_APOS_S:
        return []
    if _trava is None:
        _trava = asyncio.Lock()
    async with _trava:
        if _indice is not None:  # outro nó montou enquanto esperávamos
            return _indice
        exemplos = carregar()
        gravados = vetores_gravados()
        faltam = [e["frase"] for e in exemplos if e["frase"] not in gravados]
        if faltam:  # arquivo defasado: vetoriza só o que falta
            novos = await embeddings.embed_documentos(faltam)
            if novos is None:
                _falhou_em = time.monotonic()
                return []
            gravados = {**gravados, **dict(zip(faltam, novos, strict=True))}
        _indice = [(e, gravados[e["frase"]]) for e in exemplos]
        _falhou_em = None
        return _indice


async def _vetor_da_frase(texto: str) -> list[float] | None:
    """O vetor da frase do turno, compartilhado entre os nós que rodam em paralelo."""
    futuro = _vetores_do_turno.get(texto)
    if futuro is None:
        if len(_vetores_do_turno) >= 64:
            _vetores_do_turno.pop(next(iter(_vetores_do_turno)))
        futuro = asyncio.ensure_future(embeddings.embed_consulta(texto, no="exemplos"))
        _vetores_do_turno[texto] = futuro
    try:
        vetor = await futuro
    except Exception:  # noqa: BLE001 — embed_consulta já não levanta; por garantia
        vetor = None
    if vetor is None:
        _vetores_do_turno.pop(texto, None)  # falha não fica em cache: o próximo turno tenta
    return vetor


async def parecidos(texto: str, grupo: str, k: int = K) -> str:
    """O bloco "Exemplos parecidos" para a frase, ou "" (qualquer falha = sem exemplos)."""
    texto = (texto or "").strip()
    if not texto:
        return ""
    try:
        indice = await _montar_indice()
        if not indice:
            return ""
        vetor = await _vetor_da_frase(texto)
        if vetor is None:
            return ""
        return formatar(escolher(vetor, indice, grupo, k))
    except Exception:  # noqa: BLE001 — exemplo é contexto opcional, nunca derruba o turno
        log.warning("exemplos dinâmicos falharam; o turno segue sem eles", exc_info=True)
        return ""
