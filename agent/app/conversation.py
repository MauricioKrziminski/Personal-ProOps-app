"""O motor de um turno, compartilhado pelos dois canais.

Aqui mora tudo que vale igual no WhatsApp e no app: limite de cota, estado
inicial do grafo, fast-path de rascunho, fast-path de confirmação, execução do
grafo, auditoria em `ai_events` e a materialização da resposta.

O que NÃO mora aqui é tão importante quanto: fila, download de mídia, read
receipt e envio pela Meta ficam em `worker.py`, e a API HTTP fica em
`routes/chat.py`. A URL de mídia da Meta expira — extrair anexo aqui faria um
resume de HITL horas depois tentar baixar de novo e falhar.

O turno é identificado por `source_message_id`: o id da Meta no WhatsApp,
`app:<uuid do cliente>` no app. O motor não conhece nenhum dos dois formatos —
ele só usa a string como chave de idempotência.
"""

from __future__ import annotations

import logging
from uuid import UUID

from langgraph.types import Command

from app import db
from app.config import get_settings
from app.domain import confirm, draft, matching
from app.domain.money import cents_to_brl
from app.security import effective_thread_id
from app.services import gemini, telemetry

log = logging.getLogger(__name__)

MUITAS = "😅 Muitas mensagens em pouco tempo. Aguarda um pouquinho e tenta de novo!"

# Quanto do passado entra no prompt, por canal.
#
# O app conversa com o dedo e a tela: turnos curtos, encadeados, e o histórico
# fica visível enquanto a pessoa escreve. O WhatsApp é assíncrono e caro, e o
# histórico dele mora no checkpoint, onde cada mensagem a mais é token em toda
# chamada seguinte da conversa.
#
# Não existe resumo por IA nesta fase de propósito: um resumo impreciso pode
# trocar um valor, uma conta ou um lançamento, e é justamente sobre isso que o
# usuário faz a pergunta seguinte.
CHANNEL_LIMITS = {
    "app": {"turns": 10, "chars": 12_000},
    "whatsapp": {"turns": 5, "chars": 8_000},
}


def trim_prompt_history(messages: list[dict], channel: str) -> list[dict]:
    """As mensagens INTEIRAS mais recentes que cabem nos dois limites do canal.

    Nunca fatia uma mensagem: metade de "gastei 45 no mercado e 120 na farmácia"
    é um valor que o modelo lê como se fosse o total. Uma mensagem sozinha maior
    que o orçamento passa inteira — cortá-la seria inventar conteúdo.

    Canal desconhecido cai na janela mais estreita: errar para o lado barato.
    """
    limites = CHANNEL_LIMITS.get(channel) or min(
        CHANNEL_LIMITS.values(), key=lambda l: l["chars"]
    )
    maximo = limites["turns"] * 2  # um par é usuário + assistente

    escolhidas: list[dict] = []
    gasto = 0
    for msg in reversed(messages[-maximo:]):
        custo = len(msg.get("content") or "")
        if escolhidas and gasto + custo > limites["chars"]:
            break
        escolhidas.append(msg)
        gasto += custo
    escolhidas.reverse()
    return escolhidas


async def check_limits(sessao: dict) -> str | None:
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
# grafo
# ---------------------------------------------------------------------------


def _estado_base(
    sessao: dict,
    source_message_id: str,
    conteudo: dict,
    thread: str,
    prompt_history: list[dict] | None = None,
) -> dict:
    """O estado zerado de um turno. Extraído para o fast-path de rascunho poder
    reusá-lo sem duplicar a lista de chaves — duplicá-la é como uma delas deixa
    de ser reiniciada e volta a vazar entre turnos."""
    return {
        "thread_id": thread,
        "session_id": str(sessao["id"]),
        "channel": sessao.get("channel") or "whatsapp",
        "phone": sessao["phone"],
        "user_id": sessao["user_id"],
        "workspace_id": sessao["workspace_id"],
        "timezone": sessao["timezone"] or "America/Sao_Paulo",
        "source_message_id": source_message_id,
        "text": conteudo.get("text", ""),
        "media": conteudo.get("media"),
        "raw_texts": conteudo.get("raw_texts") or [conteudo.get("text", "")],
        "clicked_id": conteudo.get("clicked_id") or "",
        # O histórico chega JÁ CORTADO pela borda; o turno atual entra no fim.
        # É um vetor de substituição, não acumulação: quem decide o que cabe é
        # quem conhece o canal, e o reducer cego repetia o corte errado.
        "messages": [*(prompt_history or []),
                     {"role": "user", "content": conteudo.get("text", "")}],
        "last_query_data": {},
        # Zerar TUDO é obrigatório, não zelo: o thread do checkpointer é o
        # mesmo a conversa inteira, então chave não reiniciada vaza para a
        # mensagem seguinte. `finance_queries` esquecido aqui fez uma consulta
        # antiga ser re-executada e o agente repetir a resposta anterior.
        # `tests/test_state_reset.py` quebra o build se sobrar chave nova.
        "results": [],
        "domains": [],
        "domain_options": [],
        "finance_actions": [],
        "finance_queries": [],
        "notes_actions": [],
        "resource_actions": [],
        "resource_prepared": [],
        "resource_draft": None,
        "reply": "",
        "targets": [],
        "chosen_id": "",
        "draft": {},
        "preset": False,
        "confidence": 1.0,
        "llm_calls": 0,
        "revision_pending": False,
        "approved": False,
        "halted": False,
    }


async def run_turn(
    sessao: dict,
    *,
    source_message_id: str,
    conteudo: dict,
    prompt_history: list[dict] | None = None,
) -> str | dict:
    """Um turno inteiro, do limite de cota à resposta pronta.

    `conteudo` é `{text, media, raw_texts, clicked_id}` — o app só preenche
    `text`. `prompt_history` já vem CORTADO pela borda (`trim_prompt_history`):
    o motor não decide janela porque quem sabe o canal é quem chamou.
    """
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
    # A pendência vence o rascunho: SIM confirma a proposta exibida, nunca
    # preenche um slot de outra operação que ficou pela metade.
    await db.expire_drafts()
    rascunho = await db.open_draft(sessao["id"])
    clique = conteudo.get("clicked_id") or ""
    # --- fast-path: a mensagem é resposta a uma pergunta? ---
    await db.expire_pending(thread)
    pendente = await db.open_pending(sessao["id"])
    decisao = (None if rascunho and not pendente and clique.startswith(draft.CLICK_PREFIX)
               else await confirm.decide(conteudo, pendente, uso))

    if decisao is confirm.STALE:
        # clique de uma pergunta que não está mais aberta. NUNCA deixar seguir
        # para o grafo: o rótulo do botão ("1) R$45 mercado") seria lido como
        # mensagem nova e viraria um lançamento de verdade.
        return await _fechar(
            sessao, uso, "⏰ Essa confirmação já expirou. Me manda de novo o que você quer."
        )

    if isinstance(decisao, dict) and decisao.get("keep_pending"):
        return await _fechar(
            sessao, uso,
            decisao.get("clarification")
            or "Ainda não alterei nada e mantive a proposta. Confirme, cancele ou diga exatamente o que deseja mudar.",
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
            cadastro = str((pendente.get("action") or {}).get("action_type", "")).startswith("resource_")
            if not cadastro:
                await db.delete_draft(sessao["id"])
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
            if cadastro or estado.get("draft") or _interrupt_payload(estado):
                # Resume can ask another question or change card. Persist that
                # next step just like an initial turn; reply alone loses it.
                return await _resposta_do_estado(sessao, estado, pendente["thread_id"])
            return estado.get("reply", "")

    if (
        rascunho and rascunho.get("slot") == "account"
        and clique == f"{draft.CLICK_PREFIX}{rascunho['id']}:financing"
    ):
        compra = rascunho["action"]
        fields = [{"name": "kind", "value": "financing"}]
        if compra.get("installments") is not None:
            fields.append({"name": "installments", "value": str(compra["installments"])})
        if compra.get("already_paid_count") is not None:
            fields.append({"name": "installments_paid", "value": str(compra["already_paid_count"])})
        # Total parcelado inclui juros. Não é o principal nem o saldo do contrato.
        await graph().aupdate_state(config, {"resource_draft": [{
            "type": "resource_create", "resource": "debts",
            "name": compra.get("description"), "fields": fields,
        }]})
        # Só consome a compra DEPOIS de guardar o financiamento inerte.
        await db.delete_draft(sessao["id"])
        return await _fechar(sessao, uso, (
            "Vamos cadastrar como financiamento. Guardei as parcelas informadas. "
            "Qual é o principal original financiado, o saldo devedor atual e a taxa mensal do contrato? "
            "O total das parcelas inclui juros e não determina esses valores. "
            "Vou mostrar os dados para você confirmar antes de salvar."
        ))

    # Cadastro incompleto fica no checkpoint; seus dias não são resposta ao
    # slot de cartão da compra que continua inerte no banco.
    cadastro_incompleto = False
    if rascunho:
        snapshot = await graph().aget_state(config)
        cadastro_incompleto = bool((getattr(snapshot, "values", None) or {}).get("resource_draft"))
    # clique `pa:` é do HITL e nunca é do rascunho; `ds:` é o oposto. Sem esta
    # separação, um clique na lista de cartões cairia em `confirm.decide` sem
    # pendência aberta e viraria "essa confirmação expirou".
    if rascunho and not cadastro_incompleto and (not clique or clique.startswith(draft.CLICK_PREFIX)):
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
            await db.delete_draft(sessao["id"])
            return await _fechar(sessao, uso, "👍 Beleza, esqueci aquele lançamento.")
        # Resolve o cartão ANTES de consumir o rascunho. Falhar aqui e apagar
        # deixaria o usuário a um dado do fim e obrigado a repetir a compra
        # inteira — foi essa a queixa. `criar_cartao` e `escolher_cartao` entram
        # aqui como não-cartão ainda e SAEM como `completar`, ou como pergunta.
        if decidido and (
            decidido["acao"] in ("criar_cartao", "escolher_cartao")
            or (decidido["acao"] == "completar" and decidido.get("slot") == "account")
        ):
            decidido, resposta = await _cartao_do_rascunho(sessao, rascunho, decidido)
            if resposta is not None:
                return await _fechar(sessao, uso, resposta)

        if decidido and decidido["acao"] == "completar":
            acao = draft.mesclar(rascunho["action"], decidido)
            # Ainda falta outro slot? Guarda de novo e pergunta o próximo, em vez
            # de executar pela metade.
            from app.graph.schemas import FinanceAction
            from app.domain.required import faltando

            resta = faltando(FinanceAction.model_validate(acao), rascunho["raw_text"], sessao.get("timezone", "America/Sao_Paulo"))
            if resta:
                slot, pergunta = resta
                novo_id = await db.save_draft(
                    session_id=sessao["id"],
                    thread_id=thread, phone=sessao["phone"],
                    user_id=UUID(str(sessao["user_id"])),
                    workspace_id=UUID(str(sessao["workspace_id"])),
                    action=acao, raw_text=rascunho["raw_text"],
                    missing=pergunta, slot=slot,
                )
                return await _fechar(
                    sessao, uso, await _perguntar_slot(sessao, novo_id, slot, pergunta)
                )
            await db.delete_draft(sessao["id"])
            # segue o fluxo normal com a ação COMPLETA: as validações de
            # segurança (HITL de valor alto, alvo, propriedade) valem igual
            conteudo = {**conteudo, "text": rascunho["raw_text"]}
            resposta = await _rodar_com_acoes(
                sessao, source_message_id, conteudo, [acao], thread, config, uso,
                prompt_history=prompt_history,
            )
            return resposta

    estado_inicial = _estado_base(
        sessao, source_message_id, conteudo, thread, prompt_history
    )
    if cadastro_incompleto:
        estado_inicial.update(domains=["cadastros"], preset=True)
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
    draft_id = rascunho["id"]

    if decidido["acao"] == "escolher_cartao":
        if not cartoes:
            return None, draft.sem_cartoes()
        return None, _pergunta_cartao(draft_id, cartoes, "💳 Então me diz: qual cartão?")

    if decidido["acao"] == "criar_cartao":
        from app.graph.build import graph

        nome = draft.nome_de_cartao(decidido.get("name"))
        if not nome:
            return None, "Qual é o nome do cartão que você quer cadastrar?"
        thread = effective_thread_id(sessao["thread_id"], sessao["session_epoch"])
        pergunta = (
            f"Qual é o dia de fechamento e o dia de vencimento do cartão {nome}? "
            "Vou mostrar o cadastro para você confirmar. A compra continua guardada."
        )
        await graph().aupdate_state(
            {"configurable": {"thread_id": thread}},
            {"resource_draft": [{"type": "resource_create", "resource": "cards", "name": nome, "fields": []}]},
        )
        return None, pergunta

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
                draft_id, cartoes, "🤔 Esse cartão não é seu. Qual deles?"
            )
        return {**decidido, "account": escolhido["name"]}, None

    nome = draft.nome_de_cartao(decidido.get("account"))
    achados = matching.match_accounts(nome, cartoes)
    if len(achados) == 1:
        return {**decidido, "account": achados[0]["name"]}, None
    if achados:
        # Empate NUNCA vira escolha nossa: lançar no cartão errado é pior que uma
        # pergunta a mais.
        return None, _pergunta_cartao(
            draft_id, achados, f"🤔 Achei mais de um parecido com *{nome}*. Qual deles?"
        )
    if not nome:
        return None, draft.sem_cartoes()
    # Nada casou. Antes isto era um beco: listava os cartões existentes e, se não
    # houvesse nenhum, mandava o usuário cadastrar no app e voltar. Agora o
    # cadastro acontece aqui mesmo, sem sair da compra.
    return None, _pergunta_criar_cartao(draft_id, nome, cartoes)


def _pergunta_criar_cartao(draft_id: str, nome: str, cartoes: list[dict]) -> dict:
    """Cartão que não existe vira oferta de cadastro, não beco sem saída."""
    corpo = (
        f"❌ Não achei o cartão *{nome}* cadastrado.\n"
        "Quer que eu crie um cartão com esse nome agora mesmo?"
    )
    botoes = [(f"{draft.CLICK_PREFIX}{draft_id}:create_card:{nome}", "Sim, cadastrar")]
    if cartoes:
        # só faz sentido oferecer "escolher outro" se houver outro
        botoes.append((f"{draft.CLICK_PREFIX}{draft_id}:retry_card", "Escolher outro"))
    botoes.append((f"{draft.CLICK_PREFIX}{draft_id}:no", "Cancelar"))
    return {
        "ui": "buttons",
        "body": corpo,
        "buttons": botoes,
        # promete só o que TEM handler: "criar" digitado viraria um cartão
        # chamado *criar*, que é o loop de promessa morta que a 2.6 deletou
        "text": f"{corpo}\nToca num botão, digita o nome de outro cartão, ou *cancelar*.",
    }


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


def _pergunta_cartao(draft_id: str, cartoes: list[dict], corpo: str) -> dict:
    """Cartão ou financiamento: decisões distintas, ambas ainda sem escrita."""
    mostrar = cartoes[:8]
    sobraram = len(cartoes) - len(mostrar)
    aviso = f"\n(+{sobraram} que não coube na lista — é só digitar o nome.)" if sobraram else ""
    explicacao = (
        "Se foi compra no cartão, escolha ou diga o nome do cartão. "
        "Se foi um contrato de financiamento, escolha É financiamento; vou pedir os dados do contrato."
    )
    corpo = f"{corpo}\n{explicacao}{aviso}"
    cancelar = f"{draft.CLICK_PREFIX}{draft_id}:no"
    financiamento = f"{draft.CLICK_PREFIX}{draft_id}:financing"
    texto = (
        f"{corpo}\n"
        + "\n".join(f"• {c['name']}" for c in mostrar)
        + "\nDigita o nome de um cartão, escolhe É financiamento, ou *cancelar*."
    )
    if len(mostrar) <= 1:
        return {
            "ui": "buttons", "body": corpo,
            "buttons": [
                *[(f"{draft.CLICK_PREFIX}{draft_id}:c:{c['id']}", c["name"]) for c in mostrar],
                (financiamento, "É financiamento"), (cancelar, "Cancelar"),
            ],
            "text": texto,
        }
    return {
        "ui": "list", "body": corpo, "label": "Escolher opção",
        "rows": [
            *[(f"{draft.CLICK_PREFIX}{draft_id}:c:{c['id']}", c["name"], "") for c in mostrar],
            (financiamento, "É financiamento", "Informar os dados do contrato"),
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
        # Se uma ação financeira completa foi processada, descarta rascunho antigo residual
        if estado.get("finance_actions"):
            await db.delete_draft(sessao["id"])
            antigo = None
        else:
            antigo = await db.open_draft(sessao["id"])

        # Nunca anexa lembrete de rascunho a consultas financeiras/extratos
        if antigo and not estado.get("finance_queries"):
            rep = estado.get("reply")
            lembr = draft.lembrete(antigo)
            if isinstance(rep, dict):
                rep["body"] = f"{rep.get('body', '')}\n\n{lembr}".strip()
                rep["text"] = f"{rep.get('text', '')}\n\n{lembr}".strip()
                estado = {**estado, "reply": rep}
            elif isinstance(rep, str) and rep:
                estado = {**estado, "reply": f"{rep}\n\n{lembr}".strip()}
            elif not rep:
                estado = {**estado, "reply": lembr}
    draft_id = ""
    if rascunho:
        # a extração ficou pela metade: guarda para o usuário poder mudar de
        # assunto e voltar, em vez de ter que repetir a frase inteira
        draft_id = await db.save_draft(
            session_id=sessao["id"],
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
            session_id=sessao["id"],
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

    if pausa.get("kind") == "soft_warning":
        corpo = pausa["summary"]
        return {
            "ui": "buttons",
            "body": corpo,
            "buttons": [
                (f"pa:{pid}:c:confirm", "Confirmar"),
                (f"pa:{pid}:c:change_card", "Trocar de Cartão"),
                (f"pa:{pid}:no", "Cancelar"),
            ],
            "text": f"{corpo}\n1) Confirmar mesmo assim\n2) Trocar de Cartão\n3) Cancelar\nResponde com o número ou SIM/NÃO.",
        }

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
        workspace_id=sessao["workspace_id"],
        channel=sessao.get("channel") or "whatsapp",
        model=gemini.GEMINI_PARSE,
        confidence=estado.get("confidence"),
        result={
            "domains": estado.get("domains", []),
            "finance_actions": estado.get("finance_actions", []),
            "notes_actions": estado.get("notes_actions", []),
            "llm_calls": total,
        },
    )


async def _rodar_com_acoes(
    sessao, source_message_id, conteudo, acoes, thread, config, uso=None,
    *, prompt_history=None,
):
    """Roda o grafo pulando o modelo: as ações já estão prontas.

    O rascunho já foi extraído por um turno anterior; reextrair gastaria uma
    chamada para chegar no mesmo lugar — e correria o risco de o modelo
    interpretar diferente da segunda vez.
    """
    from app.graph.build import graph

    estado_inicial = _estado_base(
        sessao, source_message_id, conteudo, thread, prompt_history
    )
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
        frozen = {"approved": True, "candidate_id": decisao["candidate_id"]}
        if decisao["candidate_id"] == "change_card" and decisao.get("new_account"):
            frozen["new_account"] = decisao["new_account"]
        return frozen
    if decisao.get("revision_scope"):
        return {"approved": False, "revision_scope": decisao["revision_scope"], "revision_text": decisao.get("revision_text", "")}
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


async def recover_turn(sessao: dict, *, source_message_id: str) -> str | dict | None:
    """A resposta de um turno que RODOU mas não chegou a ser persistida.

    A janela existe: o grafo termina (ou pausa num `interrupt()`) e grava o
    checkpoint, e a persistência HTTP falha logo depois — container reciclado,
    conexão caída. Reexecutar duplicaria escrita; devolver erro esconderia um
    lançamento que já entrou.

    A trava é o `source_message_id`: só reaproveita o checkpoint quando ele é do
    MESMO turno. De outro turno, devolve None e o chamador executa normalmente.
    """
    from app.graph.build import graph

    thread = effective_thread_id(sessao["thread_id"], sessao.get("session_epoch") or 0)
    try:
        instantaneo = await graph().aget_state({"configurable": {"thread_id": thread}})
    except Exception:  # noqa: BLE001
        log.exception("aget_state falhou (thread=%s)", thread)
        return None

    estado = getattr(instantaneo, "values", None) or {}
    if estado.get("source_message_id") != source_message_id:
        return None

    pausa = _interrupt_payload(
        {"__interrupt__": list(getattr(instantaneo, "interrupts", None) or [])}
    )
    if pausa:
        pendente = await db.open_pending(sessao["id"])
        return _pergunta(pausa, pausa.get("options") or [], pendente)

    return await _resposta_do_estado(sessao, estado, thread)


async def load_prompt_history(sessao: dict) -> list[dict]:
    """O histórico do WhatsApp mora no checkpoint, já cortado pela janela do canal.

    No app o histórico vem da tabela e quem corta é a rota — aqui é o caminho do
    canal cujo passado o LangGraph guarda.
    """
    from app.graph.build import graph

    thread = effective_thread_id(sessao["thread_id"], sessao.get("session_epoch") or 0)
    try:
        instantaneo = await graph().aget_state({"configurable": {"thread_id": thread}})
    except Exception:  # noqa: BLE001
        log.exception("aget_state falhou (thread=%s)", thread)
        return []
    anteriores = (getattr(instantaneo, "values", None) or {}).get("messages") or []
    return trim_prompt_history(anteriores, sessao.get("channel") or "whatsapp")
