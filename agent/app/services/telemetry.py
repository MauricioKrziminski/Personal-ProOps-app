"""Langfuse: rastro de cada nó, aresta, tool e token do grafo.

Registro honesto: isto contraria a regra escrita do projeto ("sem serviços
externos") e foi decisão explícita do dono em 30/08/2026. Consequência prática:
conteúdo de conversa financeira sai do Supabase e vai para um terceiro.

Sem chaves configuradas o grafo roda igual, sem tracing. Telemetria NUNCA pode
ser o motivo de uma mensagem do usuário não ser processada.

API do langfuse 4.x: o cliente `Langfuse(...)` é inicializado uma vez (singleton)
e o `CallbackHandler()` pega esse cliente. Atributos de trace (user, sessão) vão
pelo context manager `propagate_attributes`, não por metadata do LangChain — isso
mudou da v2 para a v4 e vale conferir ao subir versão.
"""

from __future__ import annotations

import contextlib
import logging
import re
from typing import Any

from app.config import get_settings

log = logging.getLogger(__name__)

_handler: Any | None = None
_cliente: Any | None = None
_tentou = False

# ---------------------------------------------------------------------------
# máscara de dado pessoal ANTES de o texto sair para o Langfuse
# ---------------------------------------------------------------------------
# Só padrões ESTRUTURAIS (a forma do dado), nunca lista de palavras: e-mail, CPF/CNPJ, telefone
# e sequência longa de dígitos. Valor em R$ fica — é o que se precisa para depurar um turno.
# UUID fica DE PROPÓSITO: é o id do candidato, da pendência (`pa:<uuid>`) e do lançamento, sem
# ele o trace de uma confirmação não se depura; e a chave Pix aleatória, que tem a mesma forma,
# não identifica ninguém sozinha. Nome próprio não tem forma, e reconhecê-lo seria lista de
# palavras ou um segundo modelo por chamada — fica, e o Langfuse é configurado com retenção.
_MASCARAS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    (re.compile(r"(?<!\d)\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}(?!\d)"), "[cnpj]"),
    (re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)"), "[cpf]"),
    (re.compile(r"(?<!\d)(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?!\d)"), "[telefone]"),
    (re.compile(r"(?<![\w-])\d{9,}(?![\w-])"), "[numero]"),  # só número isolado: não corta um UUID
]


def mascarar_texto(texto: str) -> str:
    for padrao, troca in _MASCARAS:
        texto = padrao.sub(troca, texto)
    return texto


def mascarar(*, data: Any, **_: Any) -> Any:
    """`mask` do cliente Langfuse: devolve a MESMA estrutura com os textos mascarados.

    Nunca levanta (um erro aqui derrubaria o turno): se algo inesperado acontecer, o dado é
    omitido em vez de vazar sem máscara.
    """
    try:
        return _mascarar(data)
    except Exception:  # noqa: BLE001
        return "[omitido]"


def _mascarar(dado: Any) -> Any:
    if isinstance(dado, str):
        return mascarar_texto(dado)
    if isinstance(dado, dict):
        return {k: _mascarar(v) for k, v in dado.items()}
    if isinstance(dado, (list, tuple)):
        return [_mascarar(v) for v in dado]
    if hasattr(dado, "model_dump"):  # mensagem do langchain / modelo pydantic
        return _mascarar(dado.model_dump())
    return dado


def handler() -> Any | None:
    global _handler, _cliente, _tentou
    if _tentou:
        return _handler
    _tentou = True

    settings = get_settings()
    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        log.info("Langfuse desligado (sem chaves) — o grafo roda sem tracing")
        return None

    try:
        from langfuse import Langfuse
        from langfuse.langchain import CallbackHandler

        _cliente = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
            mask=mascarar,
        )
        _handler = CallbackHandler()
    except Exception:  # noqa: BLE001
        log.exception("Langfuse não inicializou — seguindo sem tracing")
        _handler = None
    return _handler


def callbacks() -> list[Any]:
    """Callbacks do GRAFO inteiro (nós, arestas, tools): só o Langfuse."""
    h = handler()
    return [h] if h else []


def callbacks_llm() -> list[Any]:
    """Callbacks de TODO cliente do Gemini: o coletor de tokens + Langfuse, se ligado.

    Fica no cliente (`ia.llm`) e não no `config` de quem chama: assim a chamada fora do grafo
    (portão, rascunho, lote de extrato) também é rastreada e contada. Dentro do grafo o handler é
    o mesmo objeto do `callbacks()` e o langchain não o duplica.
    """
    from app.services.consumo import coletor

    return [coletor, *callbacks()]


def shutdown() -> None:
    """Esvazia o que o Langfuse ainda tem na fila. Chamar no desligamento do app.

    Com `min_instances = 0` o container é desligado logo depois do último turno, e o envio do
    Langfuse é em segundo plano: sem isto os traces do último turno se perdem.
    """
    if _cliente is None:
        return
    try:
        _cliente.flush()
        _cliente.shutdown()
    except Exception:  # noqa: BLE001 — desligar nunca pode falhar por causa de telemetria
        log.warning("Langfuse não esvaziou no desligamento", exc_info=True)


def trace(*, thread_id: str, user_id: str | None, trace_name: str | None = None,
          channel: str = "whatsapp"):
    """Contexto do trace. Sem Langfuse, é um no-op.

    O nome e a tag seguem o CANAL real (`whatsapp` ou `app`): tudo saía como `whatsapp-message`.
    O TELEFONE não entra: é o identificador direto da pessoa e sairia do nosso
    banco para um terceiro. O hash da thread já agrupa a conversa.
    """
    if handler() is None:
        return contextlib.nullcontext()

    from langfuse import propagate_attributes

    return propagate_attributes(
        trace_name=trace_name or f"{channel}-message",
        session_id=thread_id,
        user_id=str(user_id) if user_id else "desconhecido",
        tags=[channel, "personal-proops"],
    )
