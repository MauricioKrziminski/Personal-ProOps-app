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
from app.domain import confirm
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
                textos.append(escolha["title"])

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
# grafo
# ---------------------------------------------------------------------------


async def _run_graph(sessao: dict, lote: list[dict], conteudo: dict) -> str | dict:
    from app.graph.build import graph

    # o epoch já foi resolvido (e girado, se era o caso) no ensure_session
    thread = effective_thread_id(sessao["thread_id"], sessao["session_epoch"])
    config = {"configurable": {"thread_id": thread}, "callbacks": telemetry.callbacks()}

    # --- fast-path: a mensagem é resposta a uma pergunta? ---
    await db.expire_pending(thread)
    pendente = await db.open_pending(sessao["phone"])
    decisao = await confirm.decide(conteudo, pendente)

    if decisao is confirm.STALE:
        # clique de uma pergunta que não está mais aberta. NUNCA deixar seguir
        # para o grafo: o rótulo do botão ("1) R$45 mercado") seria lido como
        # mensagem nova e viraria um lançamento de verdade.
        return "⏰ Essa confirmação já expirou. Me manda de novo o que você quer."

    if pendente:
        if decisao is None:
            # não foi sim, não, nem escolha: a intenção mudou. Cancela a pergunta
            # e trata como mensagem nova — insistir prenderia a conversa.
            await db.resolve_pending(pendente["id"], "expired")
        else:
            await db.resolve_pending(
                pendente["id"], "approved" if decisao.get("approved") else "rejected"
            )
            # O id CONGELADO vem de `pending_actions`, não de uma busca nova: é o
            # que garante que o SIM execute o registro que o usuário LEU, mesmo
            # que outro lançamento tenha entrado entre a pergunta e a resposta.
            entrada = Command(resume=_congelado(decisao, pendente))
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
        # Zerar TUDO é obrigatório, não zelo: o thread do checkpointer é o
        # mesmo a conversa inteira, então chave não reiniciada vaza para a
        # mensagem seguinte. `finance_queries` esquecido aqui fez uma consulta
        # antiga ser re-executada e o agente repetir a resposta anterior.
        # `tests/test_state_reset.py` quebra o build se sobrar chave nova.
        "results": [],
        "domains": [],
        "finance_actions": [],
        "finance_queries": [],
        "notes_actions": [],
        "reply": "",
        "targets": [],
        "chosen_id": "",
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
        candidatos = pausa.get("options") or []
        # O ALVO CONGELADO vai para `pending_actions`: é de lá que o resume lê o
        # id, e é o que torna a mutação imune ao que entrar no banco no meio.
        linha = await db.create_pending(
            thread_id=thread,
            phone=sessao["phone"],
            user_id=UUID(str(sessao["user_id"])),
            workspace_id=UUID(str(sessao["workspace_id"])),
            action={
                "reason": pausa.get("reason"),
                "action_type": pausa.get("action_type"),
                "kind": pausa.get("kind"),
                "candidates": candidatos,
            },
            summary=pausa["summary"],
        )
        return _pergunta(pausa, candidatos, linha)

    return estado.get("reply", "")


def _pergunta(pausa: dict, candidatos: list[dict], pendente: dict | None) -> dict | str:
    """A pergunta, no formato que o número de candidatos pede.

    O texto numerado vai SEMPRE junto (`text`): é o fallback de quem não
    renderiza interativo e de quem prefere digitar. Sem pendente gravado
    (corrida com outra pergunta aberta), devolve só texto — os ids dos botões
    dependem do uuid do pendente.
    """
    itens = pausa.get("items") or [pausa["summary"]]
    if pendente is None:
        return f"⚠️ Confirma {pausa['summary']}?\nResponde *SIM* ou *NÃO*."

    pid = pendente["id"]
    numerado = "\n".join(f"{i}) {c['label']}" for i, c in enumerate(candidatos, 1))

    if not candidatos:
        corpo = "⚠️ Confirma " + ("; ".join(itens) if len(itens) > 1 else pausa["summary"]) + "?"
        return {
            "ui": "buttons", "body": corpo,
            "buttons": [(f"pa:{pid}:ok", "Confirmar"), (f"pa:{pid}:no", "Cancelar")],
            "text": f"{corpo}\nResponde *SIM* ou *NÃO*.",
        }

    corpo = f"🤔 {pausa['summary']} — qual deles?"
    if len(candidatos) <= 2:
        # 2 opções + "nenhuma dessas" = os 3 botões que a Meta permite
        return {
            "ui": "buttons", "body": f"{corpo}\n{numerado}",
            "buttons": [
                *[(f"pa:{pid}:c:{c['id']}", f"{i}) {c['label']}")
                  for i, c in enumerate(candidatos, 1)],
                (f"pa:{pid}:none", "Nenhuma dessas"),
            ],
            "text": f"{corpo}\n{numerado}\nResponde com o número, ou *NENHUMA*.",
        }

    # 3..10 -> lista. Acima de 10, os 9 mais recentes + a saída.
    mostrar = candidatos[:9]
    return {
        "ui": "list", "body": corpo, "label": "Escolher",
        "rows": [
            *[(f"pa:{pid}:c:{c['id']}", f"{i}) {c['label']}", c.get("when", ""))
              for i, c in enumerate(mostrar, 1)],
            (f"pa:{pid}:none", "Nenhuma dessas", "Buscar de outro jeito"),
        ],
        "text": f"{corpo}\n{numerado}\nResponde com o número, ou *NENHUMA*.",
    }


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


def _congelado(decisao: dict, pendente: dict) -> dict | bool:
    """A decisão, com o alvo congelado que está gravado no pendente.

    Quando o usuário escolheu um candidato, é o id DELE que volta. Quando só
    confirmou, devolve o booleano — que é a forma que os ramos antigos do gate
    entendem, e por isso os testes de SIM/NÃO continuam valendo.
    """
    if decisao.get("candidate_id"):
        return {"approved": True, "candidate_id": decisao["candidate_id"]}
    if decisao.get("none_of_these"):
        return {"approved": False, "none_of_these": True}
    return bool(decisao.get("approved"))


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
