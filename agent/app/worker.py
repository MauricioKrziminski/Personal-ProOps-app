"""Worker: consome o lote da thread, roda o grafo e responde no WhatsApp.

Acordado pelo Cloud Tasks 3 segundos depois da última mensagem (o debounce). Uma
execução por thread por vez — o advisory lock da claim_thread_batch garante isso,
que é o que impede "gastei 45" e "apaga o último" de correrem fora de ordem.

Ordem das etapas, e o motivo de cada uma estar onde está:
  1. lock + claim do lote   -> serializa a conversa
  2. extrai conteúdo        -> ANTES do grafo, porque URL de mídia da Meta expira
                               e um resume horas depois não conseguiria baixar
  3. confirmação pendente   -> fast-path sem token: SIM/NÃO resolvido por regex
  4. grafo                  -> ainvoke ou Command(resume=...)
  5. marca done             -> ANTES de enviar: envio é best-effort e falha de
                               envio NUNCA pode reprocessar (duplicaria escrita)
  6. envia a confirmação
"""

from __future__ import annotations

import base64
import logging
import re
from uuid import UUID

from langgraph.types import Command

from app import db
from app.config import get_settings
from app.domain.confirm import interpret
from app.security import effective_thread_id, sanitize_untrusted
from app.services import gemini, groq, telemetry, whatsapp

log = logging.getLogger(__name__)

# Anexos que o Gemini lê direto.
VISION_MIME = re.compile(r"^(image/(jpeg|png|webp|heic|heif)|application/pdf)$")
MAX_MEDIA_BYTES = 8 * 1024 * 1024

SEM_CONTA = (
    "👋 Ainda não encontrei sua conta. Baixa o Personal ProOps app e se cadastra "
    "com este número para começar!"
)
SEM_WORKSPACE = "😕 Sua conta ainda não tem um espaço criado. Abre o app uma vez e me chama de novo!"
NAO_LI = "🙈 Não consegui ler isso. Mando bem com texto, áudio, foto de cupom e PDF de fatura (até 8MB)."
MUITAS = "😅 Muitas mensagens em pouco tempo. Aguarda um pouquinho e tenta de novo!"


async def process_thread(thread_id: str) -> dict:
    lote = await db.claim_batch(thread_id)
    if not lote:
        # ou outro worker está com a conversa, ou a task chegou depois de tudo
        # processado. Nos dois casos o certo é sair sem fazer nada.
        return {"claimed": 0}

    ids = [m["id"] for m in lote]
    phone = lote[-1]["phone"]

    try:
        sessao = await db.ensure_session(phone, thread_id)
        if not sessao.get("user_id"):
            await db.mark_done(ids)
            await whatsapp.try_send(phone, SEM_CONTA)
            return {"claimed": len(ids), "status": "sem_conta"}
        if not sessao.get("workspace_id"):
            await db.mark_done(ids)
            await whatsapp.try_send(phone, SEM_WORKSPACE)
            return {"claimed": len(ids), "status": "sem_workspace"}

        # limites ANTES de gastar Groq/Gemini: anti-flood por hora e cota do plano
        # por mês. Sem isto o paywall do WhatsApp simplesmente não existe.
        barrado = await _check_limits(sessao)
        if barrado:
            await db.mark_done(ids)
            await whatsapp.try_send(phone, barrado)
            return {"claimed": len(ids), "status": "limite"}

        conteudo = await _extract_batch(lote)
        if conteudo is None:
            await db.mark_done(ids)
            await whatsapp.try_send(phone, NAO_LI)
            return {"claimed": len(ids), "status": "ilegivel"}

        resposta = await _run_graph(sessao, lote, conteudo)

        # done ANTES do envio: a fonte da verdade já está salva
        await db.mark_done(ids)
        if resposta:
            await whatsapp.try_send(phone, resposta)
        return {"claimed": len(ids), "status": "ok"}

    except Exception as err:  # noqa: BLE001
        log.exception("worker falhou (thread=%s)", thread_id)
        estados = await db.mark_retry(ids, repr(err))
        # Sem "tenta de novo" para o usuário: a fila ainda vai tentar, e avisar de
        # um erro que vai se resolver sozinho em 2s só gera desconfiança.
        if any(e["status"] == "failed" for e in estados):
            await whatsapp.try_send(
                phone, "😕 Não consegui processar sua última mensagem. Pode mandar de novo?"
            )
        raise


async def _check_limits(sessao: dict) -> str | None:
    """Mensagem de recusa, ou None para seguir.

    Duas camadas, com propósitos diferentes: a hora protege o CUSTO contra rajada
    (um script maluco, um grupo colando mensagens); o mês é o PRODUTO — o limite
    do plano. O número do plano vive em `private.plan_limits`, num lugar só:
    espalhar isso pelo código é como o produto acaba cobrando de um jeito e
    entregando de outro.
    """
    settings = get_settings()

    if await db.ai_events_last_hour(sessao["user_id"]) >= settings.max_parses_per_hour:
        return MUITAS

    plano = await db.plan_status(sessao["workspace_id"])
    if plano and plano["ai_messages_month"] >= plano["max_ai_messages_month"]:
        return (
            f"📊 Você usou as {plano['max_ai_messages_month']} mensagens do plano "
            f"{plano['plan']} este mês. No app dá para subir de plano e continuar "
            "agora mesmo — seus dados continuam todos aí."
        )
    return None


# ---------------------------------------------------------------------------
# conteúdo
# ---------------------------------------------------------------------------


async def _extract_batch(lote: list[dict]) -> dict | None:
    """Consolida o lote num texto só + no máximo um anexo.

    Três mensagens seguidas viram UMA chamada de IA e UMA resposta — é isso que o
    debounce compra. Anexo: só o primeiro; dois cupons na mesma rajada é raro e
    mandar os dois numa chamada multiplicaria o custo por mensagem.
    """
    textos: list[str] = []
    media: dict[str, str] | None = None

    for item in lote:
        mensagem = item["payload"]
        tipo = mensagem.get("type")

        if tipo == "text":
            corpo = (mensagem.get("text") or {}).get("body")
            if corpo:
                textos.append(corpo)

        elif tipo == "audio":
            media_id = (mensagem.get("audio") or {}).get("id")
            if media_id:
                audio, _ = await whatsapp.download_media(media_id)
                transcrito = await groq.transcribe(audio)
                if transcrito:
                    textos.append(transcrito)

        elif tipo in ("image", "document") and media is None:
            anexo = mensagem.get(tipo) or {}
            if not anexo.get("id"):
                continue
            conteudo, mime = await whatsapp.download_media(anexo["id"])
            mime = anexo.get("mime_type") or mime
            if not VISION_MIME.match(mime) or len(conteudo) > MAX_MEDIA_BYTES:
                continue
            media = {"mime_type": mime, "data_b64": base64.b64encode(conteudo).decode()}
            if anexo.get("caption"):
                textos.append(anexo["caption"])

    if not textos and media is None:
        return None

    texto = sanitize_untrusted("\n".join(textos))
    if media and not texto:
        texto = "Extraia os lançamentos deste documento (cupom, comprovante ou fatura)."
    return {"text": texto, "media": media, "raw_texts": textos}


# ---------------------------------------------------------------------------
# grafo
# ---------------------------------------------------------------------------


async def _run_graph(sessao: dict, lote: list[dict], conteudo: dict) -> str:
    from app.graph.build import graph

    # o epoch já foi resolvido (e girado, se era o caso) no ensure_session
    thread = effective_thread_id(sessao["thread_id"], sessao["session_epoch"])
    config = {"configurable": {"thread_id": thread}, "callbacks": telemetry.callbacks()}

    # --- fast-path: a mensagem é resposta a uma pergunta? ---
    await db.expire_pending(thread)
    pendente = await db.open_pending(sessao["phone"])
    if pendente:
        entrada = _resume_command(conteudo["text"], pendente)
        if entrada is None:
            # não foi sim nem não: a intenção mudou. Cancela a pergunta e trata
            # como mensagem nova — insistir na confirmação prenderia a conversa.
            await db.resolve_pending(pendente["id"], "expired")
        else:
            await db.resolve_pending(
                pendente["id"], "approved" if entrada.resume else "rejected"
            )
            # retomar exige o thread EXATO em que o interrupt() aconteceu — é o
            # que está gravado no pendente, não o recalculado agora
            retomada = {**config, "configurable": {"thread_id": pendente["thread_id"]}}
            with telemetry.trace(thread_id=pendente["thread_id"], user_id=sessao["user_id"]):
                estado = await graph().ainvoke(entrada, config=retomada)
            return estado.get("reply", "")

    estado_inicial = {
        "thread_id": thread,
        "phone": sessao["phone"],
        "user_id": sessao["user_id"],
        "workspace_id": sessao["workspace_id"],
        "timezone": sessao["timezone"] or "America/Sao_Paulo",
        "wa_message_id": lote[-1]["wa_message_id"],
        "text": conteudo["text"],
        "media": conteudo["media"],
        "raw_texts": conteudo["raw_texts"],
        "results": [],
        "domains": [],
        "finance_actions": [],
        "notes_actions": [],
        "confidence": 1.0,
        "llm_calls": 0,
        "approved": False,
        "halted": False,
    }
    with telemetry.trace(thread_id=thread, user_id=sessao["user_id"]):
        estado = await graph().ainvoke(estado_inicial, config=config)

    await _audit(sessao, estado)

    # --- o grafo pausou pedindo confirmação? ---
    pausa = _interrupt_payload(estado)
    if pausa:
        pergunta = f"⚠️ Confirma {pausa['summary']}?\nResponde *SIM* ou *NÃO*."
        await db.create_pending(
            thread_id=thread,
            phone=sessao["phone"],
            user_id=UUID(str(sessao["user_id"])),
            workspace_id=UUID(str(sessao["workspace_id"])),
            action={"reason": pausa.get("reason"), "action_type": pausa.get("action_type")},
            summary=pausa["summary"],
        )
        return pergunta

    return estado.get("reply", "")


async def _audit(sessao: dict, estado: dict) -> None:
    """Uma linha em `ai_events` por execução que REALMENTE chamou o modelo.

    Fast-path (saudação, SIM/NÃO, anexo direto) não gasta token e por isso não
    pode consumir mensagem da cota do usuário — é `llm_calls` que separa os dois.
    """
    if not estado.get("llm_calls"):
        return
    await db.record_ai_event(
        user_id=sessao["user_id"],
        model=gemini.GEMINI_PARSE,
        confidence=estado.get("confidence"),
        result={
            "domains": estado.get("domains", []),
            "finance_actions": estado.get("finance_actions", []),
            "notes_actions": estado.get("notes_actions", []),
            "llm_calls": estado.get("llm_calls", 0),
        },
    )


def _resume_command(texto: str, pendente: dict) -> Command | None:
    """SIM/NÃO por regra pura — zero token na resposta mais comum do fluxo."""
    decisao = interpret(texto)
    return None if decisao is None else Command(resume=decisao)


def _interrupt_payload(estado: dict) -> dict | None:
    """Lê o interrupt do resultado do ainvoke.

    A chave `__interrupt__` é o contrato do LangGraph para "parei aqui". O
    formato do item mudou entre versões (objeto Interrupt com .value, ou o dict
    direto), então os dois são aceitos.
    """
    pausas = estado.get("__interrupt__") if isinstance(estado, dict) else None
    if not pausas:
        return None
    primeira = pausas[0]
    valor = getattr(primeira, "value", primeira)
    return valor if isinstance(valor, dict) else None
