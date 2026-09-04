"""A aba Agente: conversas do app sobre o mesmo motor do WhatsApp.

Esta camada existe para as três coisas que o WhatsApp já tinha resolvidas de
outro jeito e o app não tem:

1. **Dedupe pelo UUID do cliente.** A rede do celular cai no meio do POST o
   tempo todo. O app reenvia o MESMO `client_message_id`, e reenviar não pode
   virar um segundo lançamento. É a mesma função do `wa_message_id` da Meta, com
   a chave gerada do outro lado.
2. **Lease por conversa.** Dois turnos simultâneos correriam em cima do mesmo
   checkpoint. O WhatsApp serializa pelo claim da fila; aqui não há fila.
3. **Recuperar antes de reexecutar.** Um turno que rodou e não conseguiu gravar
   JÁ escreveu no banco. Reexecutar duplicaria — por isso `recover_turn` vem
   antes de uma segunda ida ao grafo.

Regra de escopo, e ela é a única que existe: `user_id` sai do `sub` do JWT e
entra em toda consulta. O serviço conecta com papel que IGNORA RLS.
"""

from __future__ import annotations

import logging
import re
import secrets
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from app import conversation, db
from app.graph.build import delete_thread

log = logging.getLogger(__name__)

repo = db  # trocável nos testes

TITLE_MAX = 48
SEM_TITULO = "Nova conversa"
HISTORY_LIMIT = CHARS = 40  # quantas mensagens são lidas antes do corte por janela

# O prefixo separa os dois canais dentro de `executed_actions`: um id da Meta
# nunca colide com um UUID do app, mas o prefixo torna a origem legível quando
# alguém for depurar um lançamento duplicado às 3 da manhã.
SOURCE_PREFIX = "app:"


class ChatError(Exception):
    """Erro de domínio. A rota traduz para código HTTP; nada de SQL sai daqui."""

    code = "internal"


class ConversationNotFound(ChatError):
    code = "conversation_not_found"


class ConversationBusy(ChatError):
    code = "conversation_busy"


class PlanLimit(ChatError):
    code = "plan_limit"


class RateLimit(ChatError):
    code = "rate_limit"


class PendingInvalid(ChatError):
    code = "pending_invalid"


class TurnFailed(ChatError):
    code = "internal"


@dataclass
class TurnResult:
    status: Literal["processing", "completed", "failed"]
    conversation: dict
    user_message: dict
    assistant_message: dict | None


@dataclass
class TurnClaim:
    kind: Literal["run", "processing", "completed"]
    session: dict
    user_message: dict
    assistant_message: dict | None = None
    retry: bool = False


# ---------------------------------------------------------------------------
# título
# ---------------------------------------------------------------------------


def derive_title(content: str) -> str:
    """A primeira linha do que a pessoa escreveu, colapsada e curta.

    Sem chamar modelo: um título é a coisa menos importante da tela para gastar
    uma requisição de cota, e a primeira linha acerta quase sempre. Renomear é
    um toque, e está na Fase 5.
    """
    primeira = next((l for l in (content or "").splitlines() if l.strip()), "")
    limpo = re.sub(r"\s+", " ", primeira).strip()
    if not limpo:
        return SEM_TITULO
    return limpo[:TITLE_MAX]


def _source_message_id(client_message_id: UUID) -> str:
    return f"{SOURCE_PREFIX}{client_message_id}"


def _split_reply(resposta: str | dict | None) -> tuple[str, dict | None]:
    """A resposta do motor em duas colunas: texto e estrutura.

    O motor devolve string para resposta simples e dict quando há botões (HITL,
    lista de cartões). `content` é `not null` no banco e é o que a tela lê —
    então um dict sem texto ainda precisa render alguma coisa.
    """
    if isinstance(resposta, dict):
        texto = resposta.get("text") or resposta.get("body") or ""
        return texto, resposta
    return (resposta or ""), None


# ---------------------------------------------------------------------------
# criar e enviar
# ---------------------------------------------------------------------------


async def create_conversation(
    *, user_id: UUID, client_message_id: UUID, content: str
) -> TurnResult:
    """Cria a conversa JÁ com a primeira mensagem dentro.

    Nunca uma conversa vazia: ela apareceria na lista sem o usuário ter pedido, e
    abrir e voltar da tela `new` viraria lixo acumulado.
    """
    perfil = await repo.chat_profile(user_id)
    if not perfil or not perfil.get("workspace_id"):
        raise ConversationNotFound()

    # `thread_id` aleatório e opaco: no app ele não deriva de nada do usuário
    # (no WhatsApp deriva do telefone) e nunca sai para o cliente.
    sessao, _criada = await repo.create_chat_session(
        user_id=user_id,
        workspace_id=perfil["workspace_id"],
        title=derive_title(content),
        first_client_message_id=client_message_id,
        thread_id=f"app-{secrets.token_urlsafe(16)}",
        timezone_=perfil.get("timezone") or "America/Sao_Paulo",
    )

    return await _execute_turn(
        user_id=user_id,
        session_id=sessao["id"],
        client_message_id=client_message_id,
        content=content,
    )


async def send_message(
    *, user_id: UUID, session_id: UUID, client_message_id: UUID, content: str
) -> TurnResult:
    return await _execute_turn(
        user_id=user_id,
        session_id=session_id,
        client_message_id=client_message_id,
        content=content,
    )


async def _execute_turn(
    *,
    user_id: UUID,
    session_id: UUID,
    client_message_id: UUID,
    content: str,
    clicked_id: str | None = None,
) -> TurnResult:
    """O caminho único de todo turno do app: criar, enviar e responder HITL.

    Um caminho só porque as três coisas precisam exatamente da mesma sequência —
    reservar, checar cota, recuperar, rodar, persistir, soltar — e três cópias
    dela é como uma delas perde o lease ou a recuperação.
    """
    reivindicado = await repo.claim_chat_turn(
        session_id=session_id,
        user_id=user_id,
        client_message_id=client_message_id,
        content=content,
    )
    claim = _as_claim(reivindicado)

    if claim.kind == "completed":
        return TurnResult("completed", claim.session, claim.user_message,
                          claim.assistant_message)
    if claim.kind == "processing":
        return TurnResult("processing", claim.session, claim.user_message, None)

    sessao = claim.session
    mensagem = claim.user_message
    origem = _source_message_id(client_message_id)

    # A cota vem DEPOIS da reserva e antes de gastar token: reservar primeiro é o
    # que impede duas abas do mesmo usuário passarem juntas pelo limite.
    limite = await conversation.check_limits(sessao)
    if limite:
        await repo.fail_chat_turn(
            session_id=session_id, user_message_id=mensagem["id"],
            error_code="rate_limit" if limite == conversation.MUITAS else "plan_limit",
        )
        raise RateLimit(limite) if limite == conversation.MUITAS else PlanLimit(limite)

    try:
        resposta = None
        if claim.retry:
            # O turno anterior pode ter rodado inteiro e morrido ao gravar. O
            # checkpoint sabe; o banco de mensagens não.
            resposta = await conversation.recover_turn(sessao, source_message_id=origem)

        if resposta is None:
            resposta = await conversation.run_turn(
                sessao,
                source_message_id=origem,
                conteudo={
                    "text": content,
                    "media": None,
                    "raw_texts": [content],
                    "clicked_id": clicked_id or "",
                },
                prompt_history=conversation.trim_prompt_history(
                    await repo.chat_prompt_history(session_id), "app"
                ),
            )
    except Exception as err:  # noqa: BLE001
        # A exceção crua carrega SQL e às vezes a URL do banco. O que chega ao
        # cliente é um código da nossa lista, e o resto vai para o log.
        log.exception("turno do app falhou (session=%s)", session_id)
        await repo.fail_chat_turn(
            session_id=session_id, user_message_id=mensagem["id"], error_code="internal"
        )
        raise TurnFailed("não consegui processar essa mensagem") from err

    texto, payload = _split_reply(resposta)
    pendente = await repo.open_pending(session_id)
    if pendente and payload is not None:
        # A tela precisa saber a QUAL pergunta os botões pertencem: sem isso, um
        # toque numa pergunta antiga resolveria a nova.
        payload = {**payload, "pending_id": str(pendente["id"])}

    assistente = await repo.finish_chat_turn(
        session_id=session_id,
        user_message_id=mensagem["id"],
        content=texto or " ",
        ui_payload=payload,
    )
    return TurnResult("completed", sessao, mensagem, assistente)


def _as_claim(bruto) -> TurnClaim:
    """Aceita o dict do `db.claim_chat_turn` ou um `TurnClaim` já pronto."""
    if isinstance(bruto, TurnClaim):
        return bruto
    kind = bruto.get("kind")
    if kind == "missing":
        raise ConversationNotFound()
    if kind == "busy":
        raise ConversationBusy()
    return TurnClaim(
        kind=kind,
        session=bruto["session"],
        user_message=bruto["user_message"],
        assistant_message=bruto.get("assistant_message"),
        retry=bool(bruto.get("retry")),
    )


# ---------------------------------------------------------------------------
# HITL
# ---------------------------------------------------------------------------

ROTULO = {"approve": "Confirmar", "reject": "Cancelar"}


async def resolve_pending(
    *,
    user_id: UUID,
    session_id: UUID,
    pending_id: UUID,
    client_message_id: UUID,
    decision: Literal["approve", "reject", "choose"],
    candidate_id: str | None = None,
) -> TurnResult:
    """Responde uma pergunta do HITL vinda da tela.

    A validação é toda do SERVIDOR e roda ANTES de qualquer coisa: a pendência
    tem que ser desta conversa, e o candidato tem que estar na lista congelada da
    própria pergunta. Aceitar um id de fora dela seria deixar o cliente escolher
    qual registro apagar — o payload do botão vem do aparelho, não de nós.
    """
    pendente = await repo.open_pending(session_id)
    if not pendente or str(pendente["id"]) != str(pending_id):
        raise PendingInvalid()

    if decision == "choose":
        candidatos = (pendente.get("action") or {}).get("candidates") or []
        if not candidate_id or not any(
            str(c.get("id")) == str(candidate_id) for c in candidatos
        ):
            raise PendingInvalid()
        clique = f"pa:{pending_id}:c:{candidate_id}"
        rotulo = next(
            (c.get("label") for c in candidatos if str(c.get("id")) == str(candidate_id)),
            "Escolher",
        )
    elif decision in ROTULO:
        clique = f"pa:{pending_id}:{'ok' if decision == 'approve' else 'no'}"
        rotulo = ROTULO[decision]
    else:
        raise PendingInvalid()

    # O rótulo visível vira mensagem do usuário: quem reabrir a conversa amanhã
    # precisa ver o que respondeu, não um payload de botão.
    return await _execute_turn(
        user_id=user_id,
        session_id=session_id,
        client_message_id=client_message_id,
        content=rotulo,
        clicked_id=clique,
    )


# ---------------------------------------------------------------------------
# excluir
# ---------------------------------------------------------------------------


async def delete_conversation(*, user_id: UUID, session_id: UUID) -> None:
    """Esconde, apaga a memória, e só então remove a linha.

    Nessa ordem porque a chamada ao checkpointer pode falhar: com `deleting_at`
    a conversa já sumiu da tela e uma retentativa ainda encontra a sessão. Se a
    linha saísse primeiro, o checkpoint ficaria órfão no banco para sempre, e um
    `thread_id` reciclado herdaria o contexto do que foi apagado.
    """
    marcada = await repo.mark_chat_deleting(session_id, user_id)
    if marcada is None:
        raise ConversationNotFound()
    if isinstance(marcada, dict) and marcada.get("busy"):
        raise ConversationBusy()

    await delete_thread(marcada["thread_id"])
    await repo.drop_chat_session(session_id)
