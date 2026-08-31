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
from app.domain import confirm, draft, matching
from app.domain.money import cents_to_brl
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


def _estado_base(sessao: dict, lote: list[dict], conteudo: dict, thread: str) -> dict:
    """O estado zerado de um turno. Extraído para o fast-path de rascunho poder
    reusá-lo sem duplicar a lista de chaves — duplicá-la é como uma delas deixa
    de ser reiniciada e volta a vazar entre turnos."""
    return {
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
        "draft": {},
        "preset": False,
        "confidence": 1.0,
        "llm_calls": 0,
        "approved": False,
        "halted": False,
    }


async def _run_graph(sessao: dict, lote: list[dict], conteudo: dict) -> str | dict:
    from app.graph.build import graph

    # o epoch já foi resolvido (e girado, se era o caso) no ensure_session
    thread = effective_thread_id(sessao["thread_id"], sessao["session_epoch"])
    config = {"configurable": {"thread_id": thread}, "callbacks": telemetry.callbacks()}

    # Quantas vezes o modelo foi chamado FORA do grafo neste turno. Os fast-paths
    # que classificam texto (rascunho, SIM/NÃO digitado) gastam token e retornam
    # antes do `_audit` — e é a contagem de `ai_events` que o paywall mensal usa.
    # Sem este contador o consumo é subcontado em silêncio.
    uso: dict = {}

    # --- fast-path: a mensagem completa um rascunho aberto? ---
    # Vem ANTES da pendência porque são coisas diferentes: pendência é uma
    # pergunta de SIM/NÃO travando a conversa; rascunho é um lançamento pela
    # metade que ficou inerte enquanto o usuário fazia outra coisa.
    await db.expire_drafts()
    rascunho = await db.open_draft(sessao["phone"])
    clique = conteudo.get("clicked_id") or ""
    # clique `pa:` é do HITL e nunca é do rascunho; `ds:` é o oposto. Sem esta
    # separação, um clique na lista de cartões cairia em `confirm.decide` sem
    # pendência aberta e viraria "essa confirmação expirou".
    if rascunho and (not clique or clique.startswith(draft.CLICK_PREFIX)):
        decidido = (
            draft.parse_slot_click(clique, rascunho["id"])
            if clique
            else await draft.interpretar(conteudo.get("text", ""), rascunho, uso)
        )
        if clique and decidido is None:
            # clique de uma lista que não é mais esta. NUNCA deixar seguir para o
            # grafo: o rótulo da linha ("Nubank Cartão") viraria mensagem nova.
            return await _fechar(
                sessao, uso,
                "⏰ Essa pergunta já expirou. Me manda de novo o que você quer.",
            )
        # "700 cada" em 12x é R$ 8.400, não R$ 700. Ponto ÚNICO da multiplicação:
        # digitar e clicar chegam os dois aqui.
        decidido = draft.com_total(decidido, rascunho["action"])
        if decidido and decidido["acao"] == "perguntar_tipo":
            # o rascunho fica exatamente como está: quem responder por texto
            # ("700 no total") é reclassificado, e o clique traz o valor no
            # próprio payload. Nada novo para guardar, nada novo para expirar.
            return await _fechar(
                sessao, uso,
                _pergunta_tipo_valor(
                    rascunho["id"], decidido["amount_cents"], decidido["installments"]
                ),
            )
        if decidido and decidido["acao"] == "descartar":
            await db.delete_draft(sessao["phone"])
            return await _fechar(sessao, uso, "👍 Beleza, esqueci aquele lançamento.")
        if decidido and decidido["acao"] == "completar":
            if decidido.get("slot") == "account":
                # Resolve o cartão ANTES de consumir o rascunho. Falhar aqui e
                # apagar deixaria o usuário a um dado do fim e obrigado a
                # repetir a compra inteira — foi essa a queixa.
                decidido, resposta = await _cartao_do_rascunho(sessao, rascunho, decidido)
                if resposta is not None:
                    return await _fechar(sessao, uso, resposta)

            acao = draft.mesclar(rascunho["action"], decidido)
            # Ainda falta outro slot? Guarda de novo e pergunta o próximo, em vez
            # de executar pela metade.
            from app.graph.schemas import FinanceAction
            from app.domain.required import faltando

            resta = faltando(FinanceAction.model_validate(acao), rascunho["raw_text"])
            if resta:
                slot, pergunta = resta
                novo_id = await db.save_draft(
                    thread_id=thread, phone=sessao["phone"],
                    user_id=UUID(str(sessao["user_id"])),
                    workspace_id=UUID(str(sessao["workspace_id"])),
                    action=acao, raw_text=rascunho["raw_text"],
                    missing=pergunta, slot=slot,
                )
                return await _fechar(
                    sessao, uso, await _perguntar_slot(sessao, novo_id, slot, pergunta)
                )
            await db.delete_draft(sessao["phone"])
            # segue o fluxo normal com a ação COMPLETA: as validações de
            # segurança (HITL de valor alto, alvo, propriedade) valem igual
            conteudo = {**conteudo, "text": rascunho["raw_text"]}
            return await _rodar_com_acoes(sessao, lote, conteudo, [acao], thread, config, uso)

    # --- fast-path: a mensagem é resposta a uma pergunta? ---
    await db.expire_pending(thread)
    pendente = await db.open_pending(sessao["phone"])
    decisao = await confirm.decide(conteudo, pendente, uso)

    if decisao is confirm.STALE:
        # clique de uma pergunta que não está mais aberta. NUNCA deixar seguir
        # para o grafo: o rótulo do botão ("1) R$45 mercado") seria lido como
        # mensagem nova e viraria um lançamento de verdade.
        return await _fechar(
            sessao, uso, "⏰ Essa confirmação já expirou. Me manda de novo o que você quer."
        )

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
            # SÓ o que este turno gastou. O estado que volta do checkpoint ainda
            # carrega o `llm_calls` do turno da PERGUNTA, que já virou linha em
            # `ai_events` lá atrás — somá-lo aqui cobraria de novo, e um CLIQUE
            # (que não chama modelo nenhum) passaria a consumir mensagem da cota.
            # Depois do gate ninguém chama o modelo: `executar` e `compor` são
            # código puro.
            await _audit(sessao, {}, uso)
            return estado.get("reply", "")

    estado_inicial = _estado_base(sessao, lote, conteudo, thread)
    with telemetry.trace(thread_id=thread, user_id=sessao["user_id"]):
        estado = await graph().ainvoke(estado_inicial, config=config)

    await _audit(sessao, estado, uso)
    return await _resposta_do_estado(sessao, estado, thread)


async def _fechar(sessao: dict, uso: dict, resposta: str | dict) -> str | dict:
    """Fecha um turno que terminou num fast-path, gravando o que ele gastou.

    Só existe porque estes caminhos não passam pelo grafo: sem esta linha, uma
    resposta de slot ou um "pode mandar" digitado chamariam o Gemini sem
    aparecer em `ai_events`, e `private.plan_status_for` conta exatamente essas
    linhas para saber quanto o workspace consumiu no mês.
    """
    await _audit(sessao, {}, uso)
    return resposta


async def _perguntar_slot(sessao: dict, draft_id: str, slot: str, pergunta: str) -> str | dict:
    """A pergunta do slot: menu quando dá para listar, texto quando não dá."""
    if slot != "account":
        return pergunta
    cartoes = await db.accounts(sessao["workspace_id"], only_cards=True)
    return _pergunta_cartao(draft_id, cartoes, pergunta)


async def _cartao_do_rascunho(
    sessao: dict, rascunho: dict, decidido: dict
) -> tuple[dict | None, str | dict | None]:
    """Troca o que o usuário disse pelo cartão REAL. `(decidido, resposta)`.

    Depois daqui `decidido["account"]` é o nome CANÔNICO do banco. Gravar o texto
    digitado era o defeito silencioso do fluxo: mesmo quando a validação passava,
    o `resolve_account` lá embaixo não achava a conta pelo que o usuário escreveu,
    devolvia None, e a compra parcelada nascia SEM cartão — exatamente o que a
    regra "cartão obrigatório em parcelado" existe para impedir.
    """
    cartoes = await db.accounts(sessao["workspace_id"], only_cards=True)
    if not cartoes:
        return None, draft.sem_cartoes(decidido.get("account", ""))

    if decidido.get("account_id"):
        # O id veio de um clique DO USUÁRIO e por isso nunca é usado direto: ele é
        # procurado na lista de cartões DO WORKSPACE, e o nome sai de lá. Sem
        # isso, um id de outro workspace entraria como argumento — o mesmo IDOR
        # que `ensure_owned` fecha nos outros caminhos.
        escolhido = next(
            (c for c in cartoes if str(c["id"]) == str(decidido["account_id"])), None
        )
        if escolhido is None:
            return None, _pergunta_cartao(
                rascunho["id"], cartoes, "🤔 Esse cartão não é seu. Qual deles?"
            )
        return {**decidido, "account": escolhido["name"]}, None

    nome = decidido.get("account", "")
    achados = matching.match_accounts(nome, cartoes)
    if len(achados) == 1:
        return {**decidido, "account": achados[0]["name"]}, None

    # Nada casou -> mostra todos. Empatou -> mostra só os candidatos. Empate NUNCA
    # vira escolha nossa: lançar no cartão errado é pior que uma pergunta a mais.
    corpo = (
        f"🤔 Achei mais de um parecido com *{nome}*. Qual deles?"
        if achados
        else f"❌ Não achei o cartão *{nome}*. É algum destes?"
    )
    return None, _pergunta_cartao(rascunho["id"], achados or cartoes, corpo)


def _pergunta_tipo_valor(draft_id: str, cents: int, parcelas: int) -> dict:
    """Total ou parcela? A pergunta que evita errar por um fator de 12.

    Os dois números aparecem no CORPO, não no rótulo: botão da Meta tem 20
    caracteres, e "R$ 12.345,67 no total" já não cabe — truncado, as duas opções
    ficariam parecidas justamente na parte que as distingue.
    """
    total = cents * parcelas
    corpo = (
        f"🤔 {cents_to_brl(cents)} é o total da compra ou o valor de cada parcela?\n"
        f"Se for cada parcela, {parcelas}x dá {cents_to_brl(total)} no total."
    )
    return {
        "ui": "buttons",
        "body": corpo,
        "buttons": [
            (f"{draft.CLICK_PREFIX}{draft_id}:t:{cents}", "É o total"),
            (f"{draft.CLICK_PREFIX}{draft_id}:p:{cents}", "É cada parcela"),
        ],
        "text": f"{corpo}\nResponde *no total* ou *cada parcela*.",
    }


def _pergunta_cartao(draft_id: str, cartoes: list[dict], corpo: str) -> str | dict:
    """A pergunta do cartão como MENU. Mesma divisão de forma que `_pergunta`.

    Até 2 cabem em botões (2 + cancelar = os 3 que a Meta aceita); 3+ viram Lista
    Interativa (9 + cancelar = as 10 linhas). O clique carrega o id do cartão, ou
    seja, executa sem passar por IA nenhuma — o texto livre vira o plano B.
    """
    if not cartoes:
        return draft.sem_cartoes()

    mostrar = cartoes[:9]
    # A Meta aceita 10 linhas e uma é sempre a saída, então do 10º cartão em
    # diante ninguém cabe. Truncar em silêncio seria o pior dos mundos: o cartão
    # existe, não aparece, e o usuário conclui que não está cadastrado. Digitar o
    # nome continua alcançando TODOS — o casamento roda sobre a lista inteira.
    sobraram = len(cartoes) - len(mostrar)
    aviso = f"\n(+{sobraram} que não coube na lista — é só digitar o nome.)" if sobraram else ""
    corpo = f"{corpo}{aviso}"
    cancelar = f"{draft.CLICK_PREFIX}{draft_id}:no"
    # O fallback pede o NOME, não o número: o rascunho não congela candidatos
    # (`pending_actions` congela porque o resume depende do id), então um número
    # digitado não teria a que se ancorar. Nome digitado a extração + o
    # casamento normalizado resolvem.
    texto = (
        f"{corpo}\n"
        + "\n".join(f"• {c['name']}" for c in mostrar)
        + "\nDigita o nome de um deles, ou *cancelar*."
    )

    if len(mostrar) <= 2:
        return {
            "ui": "buttons",
            "body": corpo,
            "buttons": [
                *[(f"{draft.CLICK_PREFIX}{draft_id}:c:{c['id']}", c["name"]) for c in mostrar],
                (cancelar, "Cancelar"),
            ],
            "text": texto,
        }
    return {
        "ui": "list",
        "body": corpo,
        "label": "Escolher cartão",
        "rows": [
            *[(f"{draft.CLICK_PREFIX}{draft_id}:c:{c['id']}", c["name"], "") for c in mostrar],
            (cancelar, "Cancelar", "Esquecer essa compra"),
        ],
        "text": texto,
    }


async def _resposta_do_estado(sessao: dict, estado: dict, thread: str) -> str | dict:
    """A resposta do turno: a pergunta pendente, ou o texto composto.

    Extraído para o fast-path de rascunho reusar — ele também precisa gravar
    `pending_actions` quando a ação completada exigir confirmação (valor alto,
    por exemplo). Duplicar isso deixaria o rascunho fora do HITL.
    """
    rascunho = estado.get("draft") or {}
    if not rascunho:
        # Nada novo pela metade — mas pode haver um rascunho ANTIGO esperando.
        # Lembrar dele aqui é o que permite trocar de assunto sem perder nada:
        # a nota de café é salva e o mac continua ali, mencionado de leve.
        antigo = await db.open_draft(sessao["phone"])
        if antigo:
            estado = {
                **estado,
                "reply": f"{estado.get('reply', '')}\n\n{draft.lembrete(antigo)}".strip(),
            }
    draft_id = ""
    if rascunho:
        # a extração ficou pela metade: guarda para o usuário poder mudar de
        # assunto e voltar, em vez de ter que repetir a frase inteira
        draft_id = await db.save_draft(
            thread_id=thread,
            phone=sessao["phone"],
            user_id=UUID(str(sessao["user_id"])),
            workspace_id=UUID(str(sessao["workspace_id"])),
            action=rascunho["action"],
            raw_text=rascunho["raw_text"],
            missing=rascunho["missing"],
            slot=rascunho.get("slot", "amount"),
        )

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

    # A pergunta do cartão vira MENU aqui, e não logo depois do `save_draft`, por
    # uma razão de correção: rascunho e `interrupt()` coexistem no mesmo turno
    # ("comprei um mac em 12x e apaga o último" — a irmã destrutiva completa pausa
    # o grafo do mesmo jeito). Interceptar antes do bloco acima pularia o
    # `create_pending` e deixaria o grafo parado num checkpoint que nenhum resume
    # alcança. Com pausa, a pergunta pendente vence e o rascunho volta pelo
    # `lembrete`, como já era.
    if rascunho.get("slot") == "account" and draft_id:
        cartoes = await db.accounts(sessao["workspace_id"], only_cards=True)
        # o corpo leva a resposta INTEIRA, não só a pergunta: o lote pode ter
        # salvo uma nota junto, e perder isso seria pior que o menu
        return _pergunta_cartao(draft_id, cartoes, estado.get("reply", ""))

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


async def _audit(sessao: dict, estado: dict, uso: dict | None = None) -> None:
    """Uma linha em `ai_events` por TURNO que realmente chamou o modelo.

    Fast-path que não gasta token (saudação, clique, anexo direto) continua sem
    consumir mensagem da cota — é `llm_calls` que separa os dois.

    `uso` são as chamadas feitas FORA do grafo (classificador de rascunho,
    SIM/NÃO digitado). Elas entram somadas aqui, e não como semente do estado,
    porque o reducer `_soma_no_turno` trata `0` na entrada como RESET: semear com
    1 num thread que já rodou somaria em cima do turno anterior em vez de zerar.
    """
    total = (estado.get("llm_calls") or 0) + ((uso or {}).get("llm_calls") or 0)
    if not total:
        return
    await db.record_ai_event(
        user_id=sessao["user_id"],
        model=gemini.GEMINI_PARSE,
        confidence=estado.get("confidence"),
        result={
            "domains": estado.get("domains", []),
            "finance_actions": estado.get("finance_actions", []),
            "notes_actions": estado.get("notes_actions", []),
            "llm_calls": total,
        },
    )


async def _rodar_com_acoes(sessao, lote, conteudo, acoes, thread, config, uso=None):
    """Roda o grafo pulando o modelo: as ações já estão prontas.

    O rascunho já foi extraído por um turno anterior; reextrair gastaria uma
    chamada para chegar no mesmo lugar — e correria o risco de o modelo
    interpretar diferente da segunda vez.
    """
    from app.graph.build import graph

    estado_inicial = _estado_base(sessao, lote, conteudo, thread)
    estado_inicial["finance_actions"] = acoes
    estado_inicial["domains"] = ["financas"]
    estado_inicial["preset"] = True
    with telemetry.trace(thread_id=thread, user_id=sessao["user_id"]):
        estado = await graph().ainvoke(estado_inicial, config=config)
    await _audit(sessao, estado, uso)
    return await _resposta_do_estado(sessao, estado, thread)


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
