"""Worker: consome o lote da thread, roda o grafo e responde no WhatsApp.

Acordado pelo Cloud Tasks 3 segundos depois da última mensagem (o debounce). Uma
execução por thread por vez — o advisory lock da claim_thread_batch garante isso,
que é o que impede "gastei 45" e "apaga o último" de correrem fora de ordem.

Ordem das etapas, e o motivo de cada uma estar onde está:
  1. lock + claim do lote   -> serializa a conversa
  2. extrai conteúdo        -> ANTES do grafo, porque URL de mídia da Meta expira
                               e um resume horas depois não conseguiria baixar
  3. motor (`conversation`) -> fast-paths, grafo, auditoria e resposta; é o
                               MESMO motor que a aba Agente do app usa
  5. marca done             -> ANTES de enviar: envio é best-effort e falha de
                               envio NUNCA pode reprocessar (duplicaria escrita)
  6. envia a confirmação
"""

from __future__ import annotations

import base64
import logging
import re

from app import conversation, db
from app.security import sanitize_untrusted
from app.services import groq, whatsapp

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
MUITAS = conversation.MUITAS


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
        barrado = await conversation.check_limits(sessao)
        if barrado:
            await db.mark_done(ids)
            await whatsapp.try_send(phone, barrado)
            return {"claimed": len(ids), "status": "limite"}

        conteudo = await _extract_batch(lote)
        if conteudo is None:
            await db.mark_done(ids)
            await whatsapp.try_send(phone, NAO_LI)
            return {"claimed": len(ids), "status": "ilegivel"}

        # Feedback visual instantâneo: marca mensagens como lidas na Meta
        for m in lote:
            wa_mid = (m.get("payload") or {}).get("id") or m.get("wa_message_id")
            if wa_mid:
                await whatsapp.try_mark_read(str(wa_mid))

        resposta = await _run_graph(sessao, lote, conteudo)

        # done ANTES do envio: a fonte da verdade já está salva
        await db.mark_done(ids)
        if isinstance(resposta, dict):
            # pergunta interativa; o `mark_done` acima continua vindo ANTES do
            # envio, que é a ordem que impede reprocessar por falha de envio
            await whatsapp.try_send_interactive(phone, resposta)
        elif resposta:
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
    clicked_id: str | None = None

    for item in lote:
        mensagem = item["payload"]
        tipo = mensagem.get("type")

        if tipo == "interactive":
            # Sem este ramo, o clique caía no `return None` lá embaixo e o
            # usuário recebia "não consegui ler isso" — com a pendência presa até
            # o TTL de 10 min. Botão sem tratar a entrada é PIOR que não ter botão.
            escolha = _interactive_reply(mensagem)
            if escolha:
                clicked_id = escolha["id"]      # o último clique do lote vence
                title = escolha["title"]
                if clicked_id.startswith("qpage:"):
                    textos.append("ver mais")
                elif clicked_id.startswith("qfilter:parcelas"):
                    textos.append("ver lançamentos e parcelas")
                elif clicked_id.startswith("qfilter:meses"):
                    textos.append("ver resumo de gastos por mês")
                else:
                    textos.append(title)

        elif tipo == "text":
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
    return {"text": texto, "media": media, "raw_texts": textos, "clicked_id": clicked_id}


def _interactive_reply(mensagem: dict) -> dict | None:
    """`{id, title}` do botão/linha clicado, ou None para o resto.

    Só `button_reply` e `list_reply`. `nfm_reply` (Flows) não é usado aqui e cai
    fora de propósito: tratar como texto deixaria payload de formulário entrar no
    modelo.
    """
    inter = mensagem.get("interactive") or {}
    escolha = inter.get("button_reply") or inter.get("list_reply")
    if not escolha or not escolha.get("id"):
        return None
    return {"id": escolha["id"], "title": escolha.get("title") or ""}


# ---------------------------------------------------------------------------
# adaptador do canal
# ---------------------------------------------------------------------------


async def _run_graph(sessao: dict, lote: list[dict], conteudo: dict) -> str | dict:
    """Traduz um lote da fila da Meta num turno do motor compartilhado.

    Duas coisas acontecem só aqui, e as duas são do WhatsApp: a chave de
    idempotência é o id da ÚLTIMA mensagem do lote (recompor o lote mudaria a
    chave, que é o que separa retentativa de mensagem nova), e o histórico sai do
    CHECKPOINT — no app ele sai da tabela de mensagens.
    """
    return await conversation.run_turn(
        sessao,
        source_message_id=lote[-1]["wa_message_id"] if lote else "",
        conteudo=conteudo,
        prompt_history=await conversation.load_prompt_history(sessao),
    )
