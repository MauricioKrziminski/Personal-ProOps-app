"""A API da aba Agente.

Uma camada fina de propósito: valida o que entra, traduz o que sai e mapeia erro
de domínio para código HTTP. Nenhuma regra de conversa mora aqui — ela está em
`app_chat.py`, e é o mesmo motor que atende o WhatsApp.

Duas coisas que SÓ esta camada pode errar, e as duas são caras:

**O que sai.** A linha de `user_sessions` carrega `phone`, `thread_id`, o lease e
o `workspace_id`. O desenho diz que o app nunca vê nada disso — um `**row` numa
resposta entregaria os quatro de uma vez. Por isso toda resposta passa por um
modelo Pydantic com os campos ESCRITOS À MÃO: acrescentar coluna no banco não
pode acrescentar campo na API.

**O que entra.** `user_id` vem do `sub` do token e de nenhum outro lugar.
`extra='forbid'` recusa um corpo que tente mandar escopo — ignorar em silêncio
também seria seguro, mas recusar denuncia um cliente que acha que manda nisso.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app import app_chat
from app.auth import current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/chat", tags=["chat"])

MAX_CONTENT = 4_000
MAX_TITLE = 80

# Erro de domínio → HTTP. Uma tabela e não `if`s espalhados: o app precisa que
# esses códigos sejam estáveis para decidir entre paywall, "espera um pouco" e
# "tenta de novo".
STATUS = {
    app_chat.ConversationNotFound: 404,
    app_chat.ConversationBusy: 409,
    app_chat.PlanLimit: 402,
    app_chat.RateLimit: 429,
    app_chat.PendingInvalid: 422,
    app_chat.TurnFailed: 500,
}

MENSAGEM = {
    404: "Essa conversa não existe.",
    409: "Essa conversa está processando uma mensagem. Tenta de novo em instantes.",
    402: "Você usou as mensagens de IA do seu plano este mês.",
    429: "Muitas mensagens em pouco tempo. Aguarda um pouquinho.",
    422: "Essa confirmação não vale mais. Me manda de novo o que você quer.",
    500: "Não consegui processar essa mensagem.",
}


# ---------------------------------------------------------------------------
# entrada
# ---------------------------------------------------------------------------


class Corpo(BaseModel):
    """`forbid` + trim em todo corpo da API.

    O corpo NUNCA carrega `user_id`, `workspace_id`, `thread_id`, `phone` nem
    `channel`: escopo sai do token, e um campo desses chegando aqui é um cliente
    tentando escolher a conversa de outra pessoa.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NovaConversa(Corpo):
    client_message_id: UUID
    content: str = Field(min_length=1, max_length=MAX_CONTENT)


class NovaMensagem(Corpo):
    client_message_id: UUID
    content: str = Field(min_length=1, max_length=MAX_CONTENT)


class Renomear(Corpo):
    title: str = Field(min_length=1, max_length=MAX_TITLE)


class Decisao(Corpo):
    client_message_id: UUID
    decision: Literal["approve", "reject", "choose"]
    candidate_id: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _escolha_precisa_de_escolhido(self):
        # Sem isso, `choose` sem candidato chegaria ao domínio como uma escolha
        # sem escolha — e viraria 422 lá, um passo depois, com o turno já reservado.
        if self.decision == "choose" and not self.candidate_id:
            raise ValueError("candidate_id é obrigatório para choose")
        if self.decision != "choose" and self.candidate_id:
            raise ValueError("candidate_id só vale para choose")
        return self


# ---------------------------------------------------------------------------
# saída — campos escritos à mão, nunca **row
# ---------------------------------------------------------------------------


class ConversaOut(BaseModel):
    id: UUID
    title: str
    last_message_at: datetime | None
    created_at: datetime | None = None

    @staticmethod
    def de(linha: dict) -> "ConversaOut":
        return ConversaOut(
            id=linha["id"],
            title=linha.get("title") or "",
            last_message_at=linha.get("last_message_at"),
            created_at=linha.get("created_at"),
        )


class MensagemOut(BaseModel):
    id: UUID
    sequence: int | None = None
    client_message_id: UUID | None = None
    role: Literal["user", "assistant"]
    content: str
    ui_payload: dict[str, Any] | None = None
    in_reply_to: UUID | None = None
    status: Literal["processing", "completed", "failed"]
    error_code: str | None = None
    created_at: datetime | None = None

    @staticmethod
    def de(linha: dict | None) -> "MensagemOut | None":
        if not linha:
            return None
        return MensagemOut(
            id=linha["id"],
            sequence=linha.get("sequence"),
            client_message_id=linha.get("client_message_id"),
            role=linha["role"],
            content=linha["content"],
            ui_payload=linha.get("ui_payload"),
            in_reply_to=linha.get("in_reply_to"),
            status=linha["status"],
            error_code=linha.get("error_code"),
            created_at=linha.get("created_at"),
        )


class TurnOut(BaseModel):
    status: Literal["processing", "completed", "failed"]
    conversation: ConversaOut
    user_message: MensagemOut
    assistant_message: MensagemOut | None = None

    @staticmethod
    def de(r: app_chat.TurnResult) -> "TurnOut":
        return TurnOut(
            status=r.status,
            conversation=ConversaOut.de(r.conversation),
            user_message=MensagemOut.de(r.user_message),
            assistant_message=MensagemOut.de(r.assistant_message),
        )


class PaginaConversas(BaseModel):
    items: list[ConversaOut]
    next_cursor: str | None = None


class PaginaMensagens(BaseModel):
    items: list[MensagemOut]
    next_cursor: str | None = None


# ---------------------------------------------------------------------------
# cursor opaco
# ---------------------------------------------------------------------------


def _encode_cursor(linha: dict) -> str:
    """`(last_message_at, id)`, não só a data.

    Duas conversas criadas no mesmo instante embaralhariam entre páginas e uma
    delas sumiria da lista. Opaco em base64 porque é detalhe de implementação —
    o cliente devolve o que recebeu, sem interpretar.
    """
    bruto = json.dumps(
        [linha["last_message_at"].isoformat() if linha.get("last_message_at") else None,
         str(linha["id"])]
    )
    return base64.urlsafe_b64encode(bruto.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    """Cursor corrompido é 422, não 500.

    Sem validar aqui, o lixo chegaria como argumento da query e o Postgres
    devolveria erro de tipo — que aparece como falha do servidor por causa de um
    parâmetro que o cliente digitou.
    """
    try:
        preenchido = cursor + "=" * (-len(cursor) % 4)
        quando, ident = json.loads(base64.urlsafe_b64decode(preenchido))
        return datetime.fromisoformat(quando), UUID(ident)
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError) as err:
        raise RequestValidationError([]) from err


# ---------------------------------------------------------------------------
# erros
# ---------------------------------------------------------------------------


def _erro(status: int, code: str, message: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"code": code, "message": message or MENSAGEM.get(status, "Erro.")},
    )


def install_error_handlers(app) -> None:
    """`{code, message}` em TODA resposta de erro, inclusive 422 e 401.

    O 422 padrão do FastAPI descreve o modelo interno campo a campo: ele conta ao
    cliente como o servidor é feito por dentro e obriga o app a aprender dois
    formatos de erro.
    """

    @app.exception_handler(RequestValidationError)
    async def _validacao(request: Request, exc: RequestValidationError):
        return _erro(422, "invalid_request", "Esse pedido não está no formato esperado.")

    @app.exception_handler(HTTPException)
    async def _http(request: Request, exc: HTTPException):
        if exc.status_code == 401:
            return _erro(401, "unauthorized", "Faça login de novo.")
        if exc.status_code == 403:
            return _erro(403, "forbidden", "Você não tem acesso a isso.")
        codigo = getattr(exc, "code", None) or "error"
        return _erro(exc.status_code, codigo, MENSAGEM.get(exc.status_code))

    @app.exception_handler(app_chat.ChatError)
    async def _dominio(request: Request, exc: app_chat.ChatError):
        status = STATUS.get(type(exc), 500)
        # A mensagem NUNCA é `str(exc)`: a exceção pode carregar SQL e às vezes a
        # URL do banco. O texto que chega ao usuário é escrito por nós.
        return _erro(status, exc.code)


def _traduz(exc: app_chat.ChatError) -> HTTPException:
    status = STATUS.get(type(exc), 500)
    erro = HTTPException(status_code=status, detail=MENSAGEM.get(status, "Erro."))
    erro.code = exc.code  # type: ignore[attr-defined]
    return erro


# ---------------------------------------------------------------------------
# rotas
# ---------------------------------------------------------------------------

Usuario = Annotated[UUID, Depends(current_user)]


@router.get("/conversations", response_model=PaginaConversas)
async def listar(
    user_id: Usuario,
    cursor: str | None = None,
    limit: int = Query(default=20, ge=1, le=50),
) -> PaginaConversas:
    depois = _decode_cursor(cursor) if cursor else None
    # `limit + 1` para saber se HÁ próxima página sem uma segunda consulta —
    # e sem devolver cursor numa página que já é a última.
    linhas = await app_chat.list_conversations(
        user_id=user_id, cursor=depois, limit=limit + 1
    )
    tem_mais = len(linhas) > limit
    linhas = linhas[:limit]
    return PaginaConversas(
        items=[ConversaOut.de(l) for l in linhas],
        next_cursor=_encode_cursor(linhas[-1]) if tem_mais and linhas else None,
    )


@router.post("/conversations", response_model=TurnOut)
async def criar(body: NovaConversa, user_id: Usuario) -> TurnOut:
    try:
        r = await app_chat.create_conversation(
            user_id=user_id,
            client_message_id=body.client_message_id,
            content=body.content,
        )
    except app_chat.ChatError as err:
        raise _traduz(err) from err
    return TurnOut.de(r)


@router.patch("/conversations/{session_id}", response_model=ConversaOut)
async def renomear(session_id: UUID, body: Renomear, user_id: Usuario) -> ConversaOut:
    try:
        linha = await app_chat.rename_conversation(
            user_id=user_id, session_id=session_id, title=body.title
        )
    except app_chat.ChatError as err:
        raise _traduz(err) from err
    if linha is None:
        raise _traduz(app_chat.ConversationNotFound())
    return ConversaOut.de(linha)


@router.delete("/conversations/{session_id}", status_code=204)
async def excluir(session_id: UUID, user_id: Usuario) -> Response:
    try:
        await app_chat.delete_conversation(user_id=user_id, session_id=session_id)
    except app_chat.ChatError as err:
        raise _traduz(err) from err
    return Response(status_code=204)


@router.get("/conversations/{session_id}/messages", response_model=PaginaMensagens)
async def historico(
    session_id: UUID,
    user_id: Usuario,
    before: int | None = None,
    limit: int = Query(default=40, ge=1, le=100),
) -> PaginaMensagens:
    try:
        linhas = await app_chat.list_messages(
            user_id=user_id, session_id=session_id, before=before, limit=limit + 1
        )
    except app_chat.ChatError as err:
        raise _traduz(err) from err
    tem_mais = len(linhas) > limit
    # A página vem em ordem CRONOLÓGICA e a paginação anda para trás: o que sobra
    # quando há mais é a mensagem mais ANTIGA, no começo da lista.
    linhas = linhas[-limit:] if tem_mais else linhas
    return PaginaMensagens(
        items=[MensagemOut.de(l) for l in linhas],
        next_cursor=str(linhas[0]["sequence"]) if tem_mais and linhas else None,
    )


@router.post("/conversations/{session_id}/messages", response_model=TurnOut)
async def enviar(session_id: UUID, body: NovaMensagem, user_id: Usuario) -> TurnOut:
    try:
        r = await app_chat.send_message(
            user_id=user_id,
            session_id=session_id,
            client_message_id=body.client_message_id,
            content=body.content,
        )
    except app_chat.ChatError as err:
        raise _traduz(err) from err
    return TurnOut.de(r)


@router.post("/conversations/{session_id}/actions/{pending_id}", response_model=TurnOut)
async def responder(
    session_id: UUID, pending_id: UUID, body: Decisao, user_id: Usuario
) -> TurnOut:
    try:
        r = await app_chat.resolve_pending(
            user_id=user_id,
            session_id=session_id,
            pending_id=pending_id,
            client_message_id=body.client_message_id,
            decision=body.decision,
            candidate_id=body.candidate_id,
        )
    except app_chat.ChatError as err:
        raise _traduz(err) from err
    return TurnOut.de(r)
