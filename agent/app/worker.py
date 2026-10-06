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

import asyncio
import base64
import logging
import re

from app import conversation, db, logctx
from app.config import get_settings
from app.security import sanitize_untrusted
from app.services import groq, whatsapp

log = logging.getLogger(__name__)

# Anexos que o Gemini lê direto.
VISION_MIME = re.compile(r"^(image/(jpeg|png|webp|heic|heif)|application/pdf)$")
MAX_MEDIA_BYTES = 8 * 1024 * 1024

SEM_CONTA = (
    "👋 Ainda não encontrei sua conta. Baixa o ProOps e se cadastra "
    "com este número para começar!"
)
SEM_WORKSPACE = "😕 Sua conta ainda não tem um espaço criado. Abre o app uma vez e me chama de novo!"
NAO_LI = "🙈 Não consegui ler isso. Mando bem com texto, áudio, foto de cupom e PDF de fatura (até 8MB)."
MUITAS = conversation.MUITAS
GRANDE_DEMAIS = "📦 Esse arquivo é grande demais para eu ler. Manda uma foto ou um PDF menor (até 8 MB)."


# Tarefas de devolução à fila em andamento: o loop só guarda referência fraca, e uma
# tarefa sem dono pode ser coletada no meio do UPDATE.
_devolvendo: set[asyncio.Task] = set()


async def _devolver_a_fila(ids: list, motivo: str) -> list[dict]:
    """`mark_retry` que sobrevive ao cancelamento do turno.

    Cancelamento e timeout são exatamente os casos em que a mensagem ficaria
    presa em `processing`; um `await` direto seria cancelado junto com o turno e
    não gravaria nada. A tarefa roda desacoplada (shield): se formos cancelados
    de novo enquanto esperamos, ela termina sozinha.
    """
    tarefa = asyncio.ensure_future(db.mark_retry(ids, motivo))
    _devolvendo.add(tarefa)
    tarefa.add_done_callback(_devolvendo.discard)
    try:
        return await asyncio.shield(tarefa)
    except asyncio.CancelledError:
        return []


async def process_thread(thread_id: str) -> dict:
    # Todo log do turno sai com a conversa: no Cloud Logging, filtrar por `thread_id` mostra o
    # turno inteiro (fila, grafo, envio) em vez de linhas soltas de várias conversas.
    with logctx.bind(thread_id=thread_id):
        return await _process_thread(thread_id)


FALHOU = "😕 Não consegui processar sua última mensagem. Pode mandar de novo?"


async def _avisar_falhas(thread_id: str) -> None:
    """Avisa UMA vez a falha definitiva — a do `mark_retry` e a do claim que recupera presa."""
    try:
        phone = await db.falhas_a_avisar(thread_id)
        if phone:
            await whatsapp.try_send(phone, FALHOU)
    except Exception:  # noqa: BLE001 — aviso é best-effort; não derruba o turno
        log.exception("aviso de falha não saiu (thread=%s)", thread_id)


async def _process_thread(thread_id: str) -> dict:
    lote = await db.claim_batch(thread_id)
    # O claim pode ter estourado o teto de uma mensagem presa: ela vira `failed` sem passar
    # pelo `except` deste worker.
    await _avisar_falhas(thread_id)
    if not lote:
        # ou outro worker está com a conversa, ou a task chegou depois de tudo
        # processado. Nos dois casos o certo é sair sem fazer nada.
        return {"claimed": 0}

    ids = [m["id"] for m in lote]
    phone = lote[-1]["phone"]
    with logctx.bind(message_id=str(lote[-1].get("wa_message_id") or "")):
        return await _turno_com_prazo(lote, ids, phone, thread_id)


async def _turno_com_prazo(lote: list[dict], ids: list, phone: str, thread_id: str) -> dict:
    try:
        # Prazo do turno: abaixo dos 300 s do Cloud Run. Sem ele, um lote com
        # áudios e chamadas lentas passava do limite, o container era morto e a
        # mensagem ficava em `processing` sem resposta.
        async with asyncio.timeout(get_settings().worker_turn_timeout_seconds):
            return await _processar(lote, ids, phone, thread_id)

    except Exception as err:  # noqa: BLE001
        log.exception("worker falhou (thread=%s)", thread_id)
        motivo = "prazo do turno estourou" if isinstance(err, TimeoutError) else repr(err)
        await _devolver_a_fila(ids, motivo)
        # Sem "tenta de novo" para o usuário enquanto a fila ainda vai tentar: avisar de um
        # erro que vai se resolver sozinho em 2s só gera desconfiança. Só a falha DEFINITIVA
        # avisa, e pelo mesmo caminho da que nasce no claim.
        await _avisar_falhas(thread_id)
        raise
    except BaseException:
        # CancelledError (cliente do Cloud Tasks desistiu, shutdown do container):
        # devolve o lote antes de propagar, senão ele espera 5 minutos para ser
        # recuperado pelo claim.
        log.warning("worker cancelado (thread=%s)", thread_id)
        await _devolver_a_fila(ids, "turno cancelado")
        raise


async def _processar(lote: list[dict], ids: list, phone: str, thread_id: str) -> dict:
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

    # Retentativa: o turno anterior pode ter rodado (e escrito) antes de morrer.
    # Refazer router+parse (temperatura 0,1) pode propor ações em outra ordem, e aí
    # o `action_index` da idempotência não casa e o lançamento duplica. O
    # checkpoint sabe o que aconteceu — é o mesmo caminho da aba Agente do app.
    resposta = None
    if any((m.get("retry_count") or 0) > 0 for m in lote):
        resposta = await conversation.recover_turn(
            sessao, source_message_id=lote[-1]["wa_message_id"]
        )

    if resposta is None:
        # Lida + "digitando…" ANTES de baixar mídia e transcrever: é a parte lenta do turno, e
        # é nela que a pessoa precisa ver que foi entendida. Só a ÚLTIMA: marcar uma mensagem
        # como lida marca as anteriores da conversa, e uma chamada por item custava até 20 s
        # cada, em série.
        ultima = lote[-1]
        wa_mid = (ultima.get("payload") or {}).get("id") or ultima.get("wa_message_id")
        if wa_mid:
            await whatsapp.try_mark_read(str(wa_mid))

        conteudo = await _extract_batch(lote)
        if conteudo is None:
            await db.mark_done(ids)
            await whatsapp.try_send(phone, NAO_LI)
            return {"claimed": len(ids), "status": "ilegivel"}
        if conteudo.get("grande_demais"):
            await db.mark_done(ids)
            await whatsapp.try_send(phone, GRANDE_DEMAIS)
            return {"claimed": len(ids), "status": "grande_demais"}

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
    grande_demais = False

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
                try:
                    audio, _ = await whatsapp.download_media(media_id)
                except whatsapp.MidiaGrandeDemais:
                    grande_demais = True
                    continue
                transcrito = await groq.transcribe(audio)
                if transcrito:
                    textos.append(transcrito)

        elif tipo in ("image", "document") and media is None:
            anexo = mensagem.get(tipo) or {}
            if not anexo.get("id"):
                continue
            try:
                conteudo, mime = await whatsapp.download_media(anexo["id"], max_bytes=MAX_MEDIA_BYTES)
            except whatsapp.MidiaGrandeDemais:
                grande_demais = True
                continue
            mime = anexo.get("mime_type") or mime
            if not VISION_MIME.match(mime) or len(conteudo) > MAX_MEDIA_BYTES:
                continue
            media = {"mime_type": mime, "data_b64": base64.b64encode(conteudo).decode()}
            if anexo.get("caption"):
                textos.append(anexo["caption"])

    if not textos and media is None:
        if grande_demais:
            return {"text": "", "media": None, "raw_texts": [], "clicked_id": clicked_id,
                    "grande_demais": True}
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
