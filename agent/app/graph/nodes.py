"""Nós do grafo.

Um princípio atravessa todos: o modelo só produz objeto validado. Nenhum nó
deixa texto do modelo virar resposta ao usuário ou argumento de banco — o que
vai para o WhatsApp é template Python sobre números que já lemos.
"""

from __future__ import annotations

import logging

from langgraph.types import interrupt

from app.domain.dates import local_datetime_iso, local_iso_date
from app.graph.policy import (
    describe_for_confirmation,
    dominio_incerto,
    erro_de_correcao,
    abertas_com,
    muda_numero_de_parcelas,
    needs_confirmation,
    par_de_substituicao,
    plano_inteiro,
)
from app.graph.prompts import FINANCE, FINANCE_QUERY, NOTES, ROUTER, user_turn
from app.graph.schemas import (
    RULE_APPLIES,
    Domain,
    FinanceAction,
    FinanceActionType,
    FinancePlan,
    FinanceQuery,
    FinanceQueryPlan,
    NotesAction,
    NotesPlan,
    RouterDecision,
    ResourceAction, ResourceActionType, ResourcePlan,
)
from app.domain.required import faltando
from app.domain.money import cents_to_brl
from app.graph.state import AgentState
from app.tools import guards, resolve
from app.services import gemini
from app.tools.base import ExecContext
from app.tools.finance import apply_rules
from app.tools.registry import AJUDA, execute

log = logging.getLogger(__name__)

# D3 (21/09/2026): apagar/corrigir + criar é UM SIM, atômico. Quando o par para
# antes da pergunta, esta é a frase que diz que nada mudou.
NADA_DO_PAR = "Ainda não apaguei nem criei nada."

AJUDA_GERAL = (
    "👋 Eu organizo suas finanças e suas notas por aqui. Manda coisas como:\n"
    "  • \"gastei 45 no mercado\"\n"
    "  • \"recebi 500 de freela\"\n"
    "  • \"me lembra de pagar o aluguel todo dia 5\"\n"
    "  • \"anota: ligar pro dentista\"\n"
    "  • \"quanto gastei esse mês?\""
)


# ---------------------------------------------------------------------------
# roteamento
# ---------------------------------------------------------------------------


async def route(state: AgentState) -> dict:
    # ações já prontas (rascunho completado): nada a rotear, e reclassificar
    # gastaria uma chamada para chegar a um resultado PIOR — a frase original
    # ("comprei um mac em 12x") sem o valor que só apareceu agora.
    if state.get("preset"):
        return {}

    """Classifica a mensagem em um ou mais domínios.

    Fast-path determinístico ANTES do modelo: mensagem curta de saudação não
    merece uma chamada de LLM. Com a cota gratuita do Flash-Lite em 500/dia e
    duas chamadas por mensagem (router + domínio), cada fast-path é uma mensagem
    a mais que o usuário consegue mandar no dia.
    """
    texto = (state.get("text") or "").strip()
    if not texto and not state.get("media"):
        return {"domains": [Domain.GERAL.value], "confidence": 1.0, "llm_calls": 0}

    curto = texto.lower().strip(" !?.,")
    if curto in {
        "oi",
        "olá",
        "ola",
        "bom dia",
        "boa tarde",
        "boa noite",
        "obrigado",
        "obrigada",
        "vlw",
        "valeu",
    }:
        return {"domains": [Domain.GERAL.value], "confidence": 1.0, "llm_calls": 0}

    # Documento anexo é quase sempre cupom/fatura: vai direto para finanças.
    if state.get("media"):
        return {"domains": [Domain.FINANCAS.value], "confidence": 1.0, "llm_calls": 0}

    historico = state.get("messages")[:-1] if state.get("messages") else None
    # O cadastro incompleto vai FORA do envelope do texto da pessoa, com a pergunta que ficou
    # pendente — a mesma frase que o nó de cadastros já recebe (25/09/2026). Dentro do envelope,
    # e sem dizer que houve pergunta, "nubank" respondendo "Qual conta foi usada para pagar a
    # prestação?" virou "pagar qual?" com nove opções.
    contexto = ""
    if state.get("resource_draft"):
        import json
        from app.security import wrap_untrusted

        contexto = "\nCadastro incompleto (dado de contexto): " + wrap_untrusted(
            "document_content", json.dumps(state["resource_draft"], ensure_ascii=False)
        )
        pendentes = [d.get("_pergunta") for d in state["resource_draft"] if d.get("_pergunta")]
        if pendentes:
            contexto += (
                "\nVocê perguntou ao usuário: " + " | ".join(pendentes)
                + "\nSe a mensagem é a RESPOSTA a isso (um nome, um valor, uma data, sim ou não),"
                " o domínio é cadastros. Só é outro domínio se ela for claramente um pedido novo."
            )
    modelo = gemini.structured(RouterDecision, gemini.GEMINI_ROUTER)
    decisao: RouterDecision = await modelo.ainvoke(
        [
            ("system", ROUTER),
            (
                "human",
                user_turn(
                    texto,
                    local_datetime_iso(state["timezone"]),
                    state["timezone"],
                    history=historico,
                    corrigindo=state.get("corrigindo") or "",
                ) + contexto,
            ),
        ]
    )
    dominios = [d.value for d in decisao.domains] or [Domain.GERAL.value]
    ret = {"domains": dominios, "confidence": decisao.confidence, "llm_calls": 1}
    # ⚠️ **A escolha parcelamento × dívida só existe para ESCRITA** (09/09/2026).
    #
    # Ela pergunta "qual deles você quer alterar?" e REESCREVE `domains` para um domínio de
    # escrita. Rodando numa consulta, as duas metades ficam erradas: "quanto falta do carro?"
    # era respondido com um menu de alteração — sobre uma pergunta que não altera nada — e a
    # resposta do usuário jogava a mensagem num nó de escrita que não tinha ação nenhuma para
    # executar. Aconteceu no número do dono do produto, no corte do WhatsApp, com uma compra
    # parcelada e um financiamento chamados "carro".
    #
    # `financial_entity` continua certo em vir preenchido — a descrição do campo diz
    # "status/payment", e "quanto falta" é status. Quem tem que olhar a intenção é ESTE bloco.
    # Em consulta a ambiguidade se resolve sozinha e melhor: `query_debts` filtra por
    # `search_term` e responde o financiamento, sem perguntar nada.
    # SÓ ler, sem nenhum lado de escrita na mensagem. Este bloco resolve QUAL REGISTRO ESCREVER,
    # então numa leitura pura ele não tem pergunta a fazer nem domínio a corrigir.
    #
    # A primeira tentativa de conserto exigia um domínio de escrita presente, e isso apagou o
    # RESGATE: quando o router erra e devolve "geral" para "marque as 2 primeiras parcelas da TV
    # como pagas", é a busca no banco que acha o parcelamento e corrige o domínio — e o teste
    # `test_unrelated_debt_history_does_not_override_existing_purchase` prendeu a perda na hora.
    # As duas metades são diferentes: o resgate vale para qualquer domínio que o router chute; o
    # MENU ("qual deles você quer alterar?") é que não pode aparecer sobre uma pergunta.
    so_consulta = "financas_consulta" in dominios and not ({"financas", "cadastros"} & set(dominios))
    if (
        decisao.financial_entity
        and state.get("workspace_id")
        and not state.get("resource_draft")
        and not so_consulta
        # Com os DOIS domínios de escrita presentes o router já disse que a mensagem toca os
        # dois lados: não há o que escolher.
        and not {"financas", "cadastros"}.issubset(dominios)
    ):
        # Quem já decidiu "isto é sobre um registro que EXISTE" é o modelo, ao
        # preencher `financial_entity` — a descrição do campo diz literalmente
        # "null for creation or unclear reference". Havia três regex de palavra
        # aqui refazendo esse julgamento em cima do texto cru ("comprei",
        # "financiamento", "pagas"), e refazendo pior: quem escrevesse
        # "quitei as anteriores da moto" não casava nenhuma delas e a pergunta
        # de desambiguação nunca aparecia. A consulta ao banco é barata e é ela
        # que sabe a verdade — se existem os dois registros, pergunta; se existe
        # um, roteia; se não existe nenhum, segue o que o router disse.
        from app import db

        reference = (
            "%"
            + decisao.financial_entity.replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
            + "%"
        )
        plans = await db.fetch(
            "select id from public.installment_plans where workspace_id=%s and description ilike %s",
            state["workspace_id"],
            reference,
        )
        debts = await db.fetch(
            "select id from public.debts where workspace_id=%s and name ilike %s and not archived",
            state["workspace_id"],
            reference,
        )
        if plans and debts:
            ret["domain_options"] = [
                {"id": "financas", "label": "Compra parcelada no cartão"},
                {"id": "cadastros", "label": "Dívida / financiamento"},
            ]
        elif plans or debts:
            financial_domain = "financas" if plans else "cadastros"
            ret["domains"] = [
                financial_domain,
                *[
                    d
                    for d in dominios
                    if d not in {"financas", "cadastros", "geral"}
                ],
            ]
    if decisao.discard_resource_draft:
        ret.update(
            resource_draft=[],
            results=["Cadastro cancelado. Não salvei nada."],
            halted=True,
        )
    return ret


def pick_domains(state: AgentState) -> list[str]:
    """Aresta condicional com fan-out: o grafo roda os nós escolhidos em paralelo.

    Lista, não string: "gastei 45 e me lembra do aluguel" precisa dos dois nós, e
    escolher um só perderia metade da mensagem.
    """
    mapa = {
        Domain.FINANCAS.value: "financas",
        Domain.FINANCAS_CONSULTA.value: "financas_consulta",
        Domain.NOTAS.value: "notas",
        Domain.GERAL.value: "geral",
        Domain.CADASTROS.value: "cadastros",
    }
    escolhidos = [mapa[d] for d in state.get("domains", []) if d in mapa]
    return escolhidos or ["geral"]


# ---------------------------------------------------------------------------
# domínios
# ---------------------------------------------------------------------------


_CARTAO_GENERICO = {"cartão", "cartao", "crédito", "credito"}
_CAMPOS_CORRECAO = ("amount_cents", "account", "category", "description", "occurred_at")


async def finance_node(state: AgentState) -> dict:
    if state.get("preset") or state.get("halted"):
        return {}  # ações semeadas ou turno cancelado: não reextrair

    historico = state.get("messages")[:-1] if state.get("messages") else None
    modelo = gemini.structured(FinancePlan, gemini.GEMINI_PARSE)
    plano: FinancePlan = await modelo.ainvoke(
        [
            ("system", FINANCE),
            (
                "human",
                user_turn(
                    state.get("text", ""),
                    local_datetime_iso(state["timezone"]),
                    state["timezone"],
                    tem_anexo=bool(state.get("media")),
                    history=historico,
                    corrigindo=state.get("corrigindo") or "",
                ),
            ),
        ]
    )
    acoes = [a for a in plano.actions if a.type.value != "unknown"]
    texto_orig = state.get("text", "")
    for a in acoes:
        # "no cartão" sem nome não é conta: vazio deixa o sistema usar o da linha ou perguntar
        if a.new_account and a.new_account.strip().casefold() in _CARTAO_GENERICO:
            a.new_account = None
        if a.type.value.startswith("create_"):
            # Campo de correção numa CRIAÇÃO é só o dado trocado de lugar (bateria de
            # 21/09/2026: "parcelei o notebook em 6 vezes, 4200 no inter" chegava em
            # new_amount_cents/new_account e o sistema perguntava o que já foi dito).
            # Exceções: na transferência `new_account` seria o DESTINO, não a origem; e na
            # parcelada o `new_amount_cents` pode ser a PARCELA — virar total direto erraria
            # por um fator N, então lá quem fala é a rede `parse_installment_total` abaixo.
            for campo in _CAMPOS_CORRECAO:
                novo = getattr(a, f"new_{campo}")
                pula = (
                    (campo == "account" and a.type == FinanceActionType.CREATE_TRANSFER)
                    or (campo == "amount_cents"
                        and a.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE)
                )
                if novo is not None and getattr(a, campo) is None and not pula:
                    setattr(a, campo, novo)
                setattr(a, f"new_{campo}", None)
        if a.type in (
            FinanceActionType.CREATE_EXPENSE,
            FinanceActionType.CREATE_INCOME,
            FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
        ):
            if a.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE:
                if not a.amount_cents:
                    from app.domain.money import parse_installment_total

                    a.amount_cents = parse_installment_total(texto_orig, a.installments)
                if (
                    a.already_paid_count is not None
                    and not a.current_installment
                    and not a.occurred_at
                    and a.installments
                ):
                    a.current_installment = min(
                        a.already_paid_count + 1, a.installments
                    )
            if a.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE and (
                not a.account
                or a.account.strip().casefold() in _CARTAO_GENERICO
            ):
                a.account = guards.extract_account_fallback(texto_orig)
    return {
        "finance_actions": [a.model_dump() for a in acoes],
        "confidence": min(state.get("confidence", 1.0), plano.confidence),
        "llm_calls": 1,
    }


async def finance_query_node(state: AgentState) -> dict:
    if state.get("preset") or state.get("halted"):
        return {}  # ações semeadas ou turno cancelado: não reextrair

    """Consultas. Schema próprio (7 × 9) porque o de escrita não cabia junto —
    ver o orçamento medido em schemas.py."""
    historico = state.get("messages")[:-1] if state.get("messages") else None
    modelo = gemini.structured(FinanceQueryPlan, gemini.GEMINI_PARSE)
    plano: FinanceQueryPlan = await modelo.ainvoke(
        [
            ("system", FINANCE_QUERY),
            (
                "human",
                user_turn(
                    state.get("text", ""),
                    local_datetime_iso(state["timezone"]),
                    state["timezone"],
                    history=historico,
                    corrigindo=state.get("corrigindo") or "",
                ),
            ),
        ]
    )
    acoes = [a for a in plano.actions if a.type.value != "unknown"]
    return {
        "finance_queries": [a.model_dump() for a in acoes],
        "confidence": min(state.get("confidence", 1.0), plano.confidence),
        "llm_calls": 1,
    }


async def _pastas_do_workspace(workspace_id) -> list[str]:
    """Os nomes das pastas que existem, para o modelo REUSAR em vez de inventar.

    Falhar aqui não pode derrubar o turno: sem a lista o comportamento é o
    antigo (o modelo escolhe o nome e `ensure_folder` cria), que é pior, não
    quebrado. Teto de 40 porque isto entra em TODO turno de nota — a lista é
    contexto, não catálogo.
    """
    from app import db

    try:
        linhas = await db.fetch(
            "select name from public.note_folders where workspace_id = %s "
            "and archived_at is null order by pinned desc, name limit 40",
            workspace_id,
        )
    except Exception:  # noqa: BLE001 — contexto opcional nunca derruba o turno
        log.warning("não consegui listar as pastas; o turno segue sem elas")
        return []
    return [linha["name"] for linha in linhas if linha.get("name")]


async def notes_node(state: AgentState) -> dict:
    if state.get("preset") or state.get("halted"):
        return {}  # ações semeadas ou turno cancelado: não reextrair

    historico = state.get("messages")[:-1] if state.get("messages") else None
    pastas = await _pastas_do_workspace(state["workspace_id"])
    modelo = gemini.structured(NotesPlan, gemini.GEMINI_PARSE)
    plano: NotesPlan = await modelo.ainvoke(
        [
            ("system", NOTES),
            (
                "human",
                user_turn(
                    state.get("text", ""),
                    local_datetime_iso(state["timezone"]),
                    state["timezone"],
                    history=historico,
                    corrigindo=state.get("corrigindo") or "",
                    pastas=pastas,
                ),
            ),
        ]
    )
    acoes = [a for a in plano.actions if a.type.value != "unknown"]
    return {
        "notes_actions": [a.model_dump() for a in acoes],
        "confidence": min(state.get("confidence", 1.0), plano.confidence),
        "llm_calls": 1,
    }


async def resource_node(state: AgentState) -> dict:
    if state.get("halted"):
        return {}
    from app.tools import resources
    from app.graph.prompts import _ANTI_INJECTION
    from app.security import wrap_untrusted
    from app.tools.guards import Level1Error
    import json

    # ⚠️ `resource_roll` estava SÓ no catálogo, não nesta linha — e esta é a que
    # o modelo lê como "os tipos que existem". "adia a fatura" caía em
    # `resource_list` e o usuário recebia a lista dos cartões dele, sem frase
    # nenhuma, achando que nada tinha acontecido. Tipo novo entra AQUI também.
    prompt = """Extraia cadastros do app. Tipos resource_create, resource_update,
resource_delete, resource_list, resource_pay, resource_roll. resource é uma chave do catálogo; name identifica o item.
⚠️ NÃO SABER QUAL ITEM NUNCA MUDA A AÇÃO. "adia a fatura" é resource_roll com name
vazio; "liga o rotativo" é resource_update com name vazio; "apaga a meta" é
resource_delete com name vazio. O sistema pergunta qual — trocar por resource_list
responde outra pergunta e a pessoa acha que nada aconteceu. resource_list é só para
quem PEDIU para ver ("quais meus cartões?", "lista minhas metas").
fields contém pares name/value; valores são strings (booleanos true/false, dinheiro
em centavos inteiros, datas ISO, taxa mensal fração decimal). Nunca invente dados,
IDs, fechamento/vencimento de cartão ou taxa de financiamento. Campos ausentes serão
perguntados. Em edição inclua somente os campos que o usuário quer mudar. O nome em
name é o atual; um novo nome vai no campo name em fields. account_id/payment_account_id
recebem o NOME da conta citada, não um ID inventado. Parcelas totais incluem as pagas.
Não confunda compra parcelada NO CARTÃO com financiamento. Uma compra em 48x sem
menção de cartão pode ser financiamento: peça os dados do contrato, não crie cartão.
Rascunho anterior só deve ser completado se a mensagem responde à pergunta; se mudar
assunto não reaproveite dados. Cancelar um cadastro incompleto retorna actions vazio.
Para atualizar valor de bem use o domínio financeiro específico, não este cadastro.
Catálogo:
""" + resources.prompt_catalogue() + "\n" + _ANTI_INJECTION
    user = user_turn(state.get('text',''), local_datetime_iso(state['timezone']),
                     state['timezone'], history=(state.get('messages') or [])[:-1],
                     corrigindo=state.get('corrigindo') or '')
    if state.get('resource_draft'):
        user += "\n" + wrap_untrusted('document_content', json.dumps(state['resource_draft'],ensure_ascii=False))
        # A PERGUNTA que ficou pendente, fora do envelope porque é texto NOSSO.
        # Sem ela o modelo re-extrai a mensagem inteira do zero e um "8" solto
        # não é instrução de cadastro nenhuma — era assim que a resposta certa
        # à pergunta certa não preenchia campo nenhum.
        pendentes = [d.get('_pergunta') for d in state['resource_draft'] if d.get('_pergunta')]
        if pendentes:
            user += ("\n\nVocê perguntou ao usuário: " + " | ".join(pendentes)
                     + "\nA mensagem dele é a RESPOSTA a isso: preencha o campo correspondente"
                     " do cadastro pendente em vez de tratá-la como pedido novo.")
    if state.get('preset') and state.get('resource_actions'):
        # Ação já montada fora do grafo (a compra parcelada que virou
        # financiamento). Reextrair gastaria uma chamada para chegar a um
        # resultado PIOR: o texto do turno é "É financiamento", que não descreve
        # contrato nenhum.
        #
        # ⚠️ `preset` sozinho NÃO basta: o caminho do cadastro incompleto também
        # o liga, e só para fixar o domínio — lá a mensagem ("fecha dia 7") ainda
        # precisa do modelo. Quem autoriza pular a extração é haver AÇÃO pronta.
        planned = [ResourceAction.model_validate(a) for a in state.get('resource_actions') or []]
        calls = 0
    else:
        plan = await gemini.structured(ResourcePlan, gemini.GEMINI_PARSE).ainvoke([('system',prompt),('human',user)])
        planned, calls = plan.actions, 1
    if Domain.NOTAS.value in (state.get('domains') or []):
        # ⚠️ **Nota e lembrete NOVOS têm um dono só: o nó de notas** (23/09/2026). Os dois
        # extratores rodam em paralelo sobre a MESMA frase, e "crie a pasta App e ponha a
        # nota X" voltava daqui com a pasta E a nota — que o nó de notas também criava. Era a
        # nota em dobro (a daqui sem pasta) e, do lado da pasta, o unique estourando. Com
        # notas no lote, criar nota/lembrete aqui é sempre eco; editar continua sendo daqui.
        planned = [a for a in planned
                   if not (a.type == ResourceActionType.CREATE and a.resource in {'notes', 'reminders'})]
    context=ExecContext(state['user_id'],state['workspace_id'],state.get('phone'),state['timezone'],state.get('text',''),state['source_message_id'])
    actions, prepared, incomplete, questions = [], [], [], []
    for action in planned:
        try:
            proposal=await resources.prepare(context,action)
        except resources.JaExiste as aviso:
            # Não falta dado nenhum: vira frase, nunca rascunho (rascunho envenenaria o
            # próximo turno com um "cadastro incompleto" que não existe).
            questions.append(aviso.mensagem_usuario)
            continue
        except Level1Error as err:
            # A pergunta viaja junto do cadastro pendente: é o que deixa o
            # próximo turno saber o que foi perguntado e, se a MESMA pergunta
            # voltar, saber que a resposta não entrou.
            incomplete.append({**action.model_dump(mode='json'), '_pergunta': err.mensagem_usuario})
            ja_perguntada = any(
                d.get('_pergunta') == err.mensagem_usuario
                for d in (state.get('resource_draft') or [])
            )
            questions.append(
                # Repetir a frase idêntica é o que faz o agente parecer surdo:
                # o usuário respondeu, não entrou, e nada na tela diz isso nem
                # como sair. Vale para qualquer recurso e qualquer campo.
                f"Não consegui tirar esse dado do que você escreveu. {err.mensagem_usuario}"
                "\nSe preferir, responde *cancela* que eu descarto este cadastro."
                if ja_perguntada and (state.get('text') or '').strip()
                else err.mensagem_usuario
            )
            continue
        actions.append(action.model_dump(mode='json'))
        prepared.append(proposal)
    return {'resource_actions':actions,'resource_prepared':prepared,'resource_draft':incomplete,
            'results':[*state.get('results',[]),*questions], 'llm_calls':calls}


async def general_node(state: AgentState) -> dict:
    if state.get("halted"):
        return {}
    """Conversa geral SEM chamar o modelo.

    Deixar o LLM escrever livremente aqui seria a única porta de texto não
    verificado no produto — e a mais barata de fechar: respostas de saudação e
    ajuda são finitas e conhecidas. De quebra, economiza uma chamada.
    """
    # Só fala quando é o único domínio: "gastei 45 e oi" não pode responder o
    # bloco de ajuda inteiro colado na confirmação do gasto.
    if len(state.get("domains", [])) > 1:
        return {}
    return {"results": [AJUDA_GERAL]}


# ---------------------------------------------------------------------------
# portão: validação + HITL
# ---------------------------------------------------------------------------


def _actions(state: AgentState) -> list[FinanceAction | FinanceQuery | NotesAction]:
    """Revalida o que veio do checkpoint. Schema que mudou entre deploys falha
    aqui, e não como escrita torta no banco."""
    saida: list[FinanceAction | FinanceQuery | NotesAction] = []
    for bruto in state.get("finance_actions", []):
        saida.append(FinanceAction.model_validate(bruto))
    for bruto in state.get("finance_queries", []):
        saida.append(FinanceQuery.model_validate(bruto))
    for bruto in state.get("notes_actions", []):
        saida.append(NotesAction.model_validate(bruto))
    for bruto in state.get("resource_actions", []):
        saida.append(ResourceAction.model_validate(bruto))
    return saida


async def domain_gate(state: AgentState) -> dict:
    """Pergunta QUAL registro quando o roteador não tem certeza — antes de extrair.

    Fica entre o router e o fan-out de domínio de propósito. No gate, depois da
    extração, a escolha não teria efeito: se o usuário respondesse "nota" e quem
    tinha rodado fosse o nó de finanças, não existiria `notes_actions` nenhuma
    para executar. Aqui, a escolha REESCREVE `domains` e o fan-out manda a
    mensagem para o nó certo — que é a única forma de a resposta valer.

    De quebra, economiza a chamada de extração do domínio errado.
    """
    if state.get("halted"):
        return {}
    if state.get("domain_options"):
        choice = interrupt(
            {
                "kind": "domain",
                "action_type": "router",
                "summary": "Encontrei compra parcelada e financiamento com esse nome. Qual deles você quer alterar?",
                "options": state["domain_options"],
            }
        )
        selected = choice.get("candidate_id") if isinstance(choice, dict) else choice
        if selected in {option["id"] for option in state["domain_options"]}:
            other_domains = [
                d
                for d in state.get("domains", [])
                if d not in {"financas", "cadastros"}
            ]
            return {
                "domains": [selected, *other_domains],
                "domain_options": [],
                "confidence": 1.0,
            }
        return {"results": ["Não alterei nenhum dos registros."], "halted": True}
    if not dominio_incerto(state.get("domains") or [], state.get("confidence", 1.0)):
        return {}

    escolha = interrupt(
        {
            "kind": "domain",
            "action_type": "router",
            "summary": "Como você quer registrar isso?",
            "options": [
                {"id": "financas", "label": "Como gasto/receita"},
                {"id": "notas", "label": "Como nota"},
            ],
        }
    )
    escolhido = escolha.get("candidate_id") if isinstance(escolha, dict) else escolha
    if escolhido in {"financas", "notas"}:
        # confiança 1.0: quem decidiu foi o usuário, não o modelo
        return {"domains": [escolhido], "confidence": 1.0}
    return {"results": ["👍 Ok, não registrei nada."], "halted": True}


async def resolve_node(state: AgentState) -> dict:
    """Fase Cognitiva: resolve o ALVO de toda ação que mira registro existente.

    Roda ANTES do gate e só LÊ. É o que permite duas coisas que não dá para ter
    resolvendo depois:

    1. A pergunta cita a LINHA REAL ("apagar o gasto de R$ 45 em mercado, 30/08")
       em vez do eco do modelo ("apagar a nota sobre última mensagem").
    2. O id fica CONGELADO no checkpoint. O `gate` reinicia do zero no resume
       (é o comportamento do interrupt); se a resolução morasse lá, ela rodaria
       duas vezes e o SIM poderia apagar uma linha diferente da que o usuário leu.

    Sai barato no caso comum: nenhuma query quando o turno só cria ou consulta.
    """
    if state.get("halted"):
        return {}
    acoes = _actions(state)
    if not acoes:
        return {}
    # A validação vale para TODO lote, inclusive o que não mira registro
    # existente — o bug do "registrar None em 12x" era exatamente uma criação,
    # que não passa pelo resolver. Sair antes daqui pulava o esclarecimento.
    esclarecimentos = _esclarecimentos(state, acoes)

    resource_targets = [{"prepared": p} for p in state.get("resource_prepared", [])]
    def with_resources(targets):
        if resource_targets:
            targets[-len(resource_targets):] = resource_targets
        return targets

    if not any(getattr(a, "type", None) in resolve.TARGETS for a in acoes):
        alvos = [{} for _ in acoes]
    else:
        alvos = await resolve.for_actions(
            state["workspace_id"], acoes, state.get("text", ""),
            antecedente=state.get("last_write_id"),
        )

    # ⚠️ **Conta citada é validada AQUI, junto com o alvo — não dentro da tool.**
    # A confirmação é montada entre este nó e a execução: com a checagem só na
    # tool, "comprei uma tv em 10x de 300 no santander" perguntava
    # "Confirma registrar R$ 3.000,00 no cartão santander?" para um cartão que
    # não existe, e a pessoa só descobria DEPOIS de dizer sim. Vale para os dois
    # ramos acima: criação pura nem passa por `for_actions`.
    alvos = await resolve.contas_citadas(
        state["workspace_id"], acoes, alvos, pular=set(_incompletas(state, acoes))
    )
    # toda escrita pede SIM (21/09/2026): a frase diz qual conta recebe o que
    # o usuário não disse de onde saiu
    alvos = await resolve.conta_padrao(state["workspace_id"], acoes, alvos)

    return {"targets": with_resources(alvos), "results": esclarecimentos,
            "draft": _rascunho(state, acoes, alvos)}


def _incompletas(state: AgentState, acoes: list) -> dict[int, str]:
    """Índice -> pergunta, para toda ação que não tem o que precisa.

    Determinístico e puro: o modelo pode mudar, "lançamento precisa de valor"
    não muda. Roda ANTES do gate — é o que impede uma ação sem valor de virar
    `pending_actions` e produzir "Confirma registrar None em 12x?".
    """
    texto = state.get("text", "")
    return {
        i: faltou
        for i, acao in enumerate(acoes)
        if (faltou := faltando(acao, texto, state.get("timezone", "America/Sao_Paulo"))) is not None
    }


def _esclarecimentos(state: AgentState, acoes: list) -> list[str]:
    return [*state.get("results", []),
            *(pergunta for _, pergunta in _incompletas(state, acoes).values())]


def _rascunho(state: AgentState, acoes: list, alvos: list[dict] | None = None) -> dict:
    """A extração incompleta que vale guardar, ou {}.

    Só a PRIMEIRA: dois rascunhos abertos tornariam "foi 5000" ambíguo, do mesmo
    jeito que duas perguntas abertas tornariam "sim" ambíguo. O grafo só monta o
    objeto — quem grava é o worker, como já faz com `pending_actions`.

    ⚠️ **Conta citada que não bate também vira rascunho.** Ela não é "campo que
    falta" (o modelo extraiu o nome; ele é que não existe), então `faltando` não
    a vê — e sem rascunho a pergunta "qual delas?" não tinha onde encaixar a
    resposta: o turno seguinte era uma mensagem nova, sem a compra. É o mesmo
    formato que `resource_node` já usa para o cadastro incompleto (`_pergunta`
    viajando junto da ação).

    ⚠️ **Rascunho nunca nasce de um par de substituição** (D3). O rascunho guarda
    só a criação; a outra metade (apagar/corrigir) se perderia, e completar o
    rascunho depois criaria a compra nova ao lado da antiga — ou, como no
    incidente das wardogs, o apagar já teria acontecido e a compra nunca nasceria.
    """
    if par_de_substituicao(acoes, alvos or []):
        return {}
    for i, (slot, pergunta) in _incompletas(state, acoes).items():
        return {
            "action": acoes[i].model_dump(mode="json"),
            "raw_text": state.get("text", ""),
            "missing": pergunta,
            "slot": slot,
        }
    for i, alvo in enumerate(alvos or []):
        if i < len(acoes) and alvo.get("account_error"):
            return {
                "action": acoes[i].model_dump(mode="json"),
                "raw_text": state.get("text", ""),
                "missing": alvo["account_error"],
                "slot": "account",
            }
    return {}


async def safe_node(state: AgentState) -> dict:
    """Executa AGORA o que não precisa de confirmação. Fase segura do lote.

    Desde 21/09/2026 toda escrita pede SIM, então aqui só sobram LEITURAS (e
    `unknown`, que vira ajuda): num lote misto a consulta responde antes da
    pergunta, e nada é gravado antes dela.
    """
    if state.get("halted"):
        return {}
    acoes = _actions(state)
    if not acoes:
        return {}

    confidence = state.get("confidence", 1.0)
    alvos = (list(state.get("targets") or []) + [{}] * len(acoes))[: len(acoes)]
    if par_de_substituicao(acoes, alvos):
        # par apagar/corrigir + criar: nada grava antes do SIM que cobre os dois
        return {}
    bloqueadas = _incompletas(state, acoes)
    seguras = [
        (i, a) for i, (a, t) in enumerate(zip(acoes, alvos))
        if i not in bloqueadas and not needs_confirmation(a, confidence, t or None)
    ]
    if not seguras or len(seguras) == len(acoes):
        # nada sensível no lote: deixa tudo para o `executar` de sempre, para
        # não ter duas execuções fazendo a mesma coisa no caminho comum
        return {}

    res = await _executar(state, seguras)
    linhas = res[0] if isinstance(res, tuple) else res
    spec = res[1] if isinstance(res, tuple) and len(res) > 1 else None
    query_data = res[2] if isinstance(res, tuple) and len(res) > 2 else None
    escritos = res[3] if isinstance(res, tuple) and len(res) > 3 else []
    ret = {"results": [*state.get("results", []), *linhas]}
    if escritos:
        # Mesma regra do `execute_node`: quem escreveu deixa o antecedente. Este
        # nó só roda em LOTE MISTO, e é o único jeito de "gastei 20 e apaga o
        # do mercado" deixar rastro do que foi criado na parte segura.
        ret["last_write_id"] = escritos[-1]
    if spec:
        texto_completo = "\n\n".join(l for l in ret["results"] if l)
        ret["reply"] = {**spec, "body": texto_completo, "text": texto_completo}
    if query_data:
        ret["last_query_data"] = query_data
    return ret


def _confirm_selection(state: AgentState, update: dict) -> dict:
    """Selecting a target is not permission to mutate it or the rest of the batch."""
    proposed={**state, **update}
    actions=_actions(proposed)
    targets=proposed.get('targets') or [{}]*len(actions)
    # no par a criação entra na frase mesmo sem motivo próprio: o SIM a grava junto
    par=par_de_substituicao(actions,targets)
    hoje=local_iso_date(proposed.get('timezone','America/Sao_Paulo'))
    descriptions=[describe_for_confirmation(action,target or None,hoje=hoje)
                  for i,(action,target) in enumerate(zip(actions,targets))
                  if i not in _incompletas(proposed,actions)
                  and (i in par or needs_confirmation(action,proposed.get('confidence',1),target or None))
                  and target.get('status')!='none']
    if not descriptions:
        return update
    answer=interrupt({'kind':'confirmation','summary':'; '.join(descriptions),
                      'items':descriptions,'action_type':'selected_actions'})
    if answer is True or (isinstance(answer,dict) and answer.get('approved') is True and not answer.get('candidate_id')):
        return update
    return {**update,'approved':False,'halted':True,
            'results':[*state.get('results',[]),'Ok, não fiz essas alterações.']}


UNIDADE_OPCOES = {"unidade:total": "total", "unidade:parcela": "parcela"}


def _perguntar_unidade(state: AgentState, i: int, acao, alvo: dict) -> tuple[dict, dict | None]:
    """D2: o valor novo de uma compra parcelada é o TOTAL ou CADA parcela?

    Um helper para os dois caminhos (alvo `found` e depois da escolha no empate),
    sempre ANTES da confirmação: a frase do SIM diz o efeito, e o efeito depende disto.
    A escolha congela `amount_unit` no ALVO — é o que a tool lê; sem ela a tool recusa
    ("peça de novo"), nunca assume "parcela". Devolve (alvo, None) ou (alvo, parada).
    """
    # no empate a data do plano só aparece depois da escolha
    if erro := erro_de_correcao(acao, alvo):
        return alvo, {"approved": False, "halted": True,
                      "results": [*state.get("results", []), erro]}
    if (getattr(acao, "type", None) != FinanceActionType.UPDATE_TRANSACTION
            or acao.new_amount_cents is None or not plano_inteiro(alvo)
            or alvo.get("amount_unit")):
        return alvo, None
    cand = alvo["candidates"][0]
    if cand.get("editaveis") is None:
        # candidato de antes do deploy (checkpoint/pendência velha): sem os números
        # congelados a frase do SIM não tem como dizer o efeito
        return alvo, {"approved": False, "halted": True,
                      "results": [*state.get("results", []),
                                  "Ainda não mudei nada. Me pede a correção de novo."]}
    novo = acao.new_amount_cents
    # nº de parcelas novo junto ("a tv foi 3000 em 12x"): "cada parcela" multiplica pelas que
    # ficam em ABERTO com o N novo — as pagas continuam como estão (`20260926130000`)
    n = acao.installments if muda_numero_de_parcelas(acao, cand) else cand["plan_installments"]
    editaveis = abertas_com(cand, n) if muda_numero_de_parcelas(acao, cand) else cand["editaveis"]
    por_parcela = cand["travado_cents"] + novo * editaveis
    escolha = interrupt({
        "kind": "choice",
        "purpose": "amount_unit",
        "action_index": i,
        "action_type": acao.type.value,
        "summary": (
            f"{cents_to_brl(novo)} em {cand['label']} é o total da compra "
            f"(fica {cents_to_brl(novo)} em {n}x) ou o valor de "
            f"cada parcela (o total vira {cents_to_brl(por_parcela)})?"
        ),
        "options": [{"id": "unidade:total", "label": "Total da compra"},
                    {"id": "unidade:parcela", "label": "Cada parcela"}],
    })
    escolhido = escolha.get("candidate_id") if isinstance(escolha, dict) else escolha
    if escolhido in UNIDADE_OPCOES:
        return {**alvo, "amount_unit": UNIDADE_OPCOES[escolhido]}, None
    return alvo, {"approved": False, "halted": True,
                  "results": [*state.get("results", []), "👌 Ok, não mudei nada."]}


async def gate(state: AgentState) -> dict:
    # A revision finishes this node before the next confirmation, so its exact
    # targets are checkpointed and are not re-read on approval replay.
    result = await _gate(state)
    return {"revision_pending": False, **result}


async def _gate(state: AgentState) -> dict:
    """Decide se executa direto ou pausa esperando confirmação.

    O interrupt() do LangGraph guarda o checkpoint e devolve o controle. Quem
    manda a pergunta ao WhatsApp e grava pending_actions é o worker — o grafo não
    fala com o mundo, ele só para.

    Este nó reinicia do zero quando o grafo é retomado (comportamento do
    interrupt), por isso ele é puro: mesma entrada, mesma decisão.
    """
    if state.get("halted"):
        return {}

    acoes = _actions(state)
    if not acoes:
        return {}

    confidence = state.get("confidence", 1.0)

    alvos = state.get("targets") or [{}] * len(acoes)
    # zip defensivo: comprimento diferente = não resolvido = não executa
    alvos = (alvos + [{}] * len(acoes))[: len(acoes)]

    correction_errors = [e for e in (t.get("correction_error") or erro_de_correcao(a, t)
                                     for a, t in zip(acoes, alvos)) if e]
    par = par_de_substituicao(acoes, alvos)
    if par and (correction_errors or _incompletas(state, acoes)):
        # Par com uma metade que não fecha: para ANTES de qualquer interrupt. A
        # pergunta do que falta já está em `results` (veio de `alvos`); aqui só
        # entra o erro de conta e a garantia de que nada mudou. `draft: {}`
        # explícito: rascunho do par perderia a outra metade (ver `_rascunho`).
        falta_valor = any(slot == "amount" for slot, _ in _incompletas(state, acoes).values())
        conta_errada = next((a for a, t in zip(acoes, alvos) if t.get("account_error")), None)
        if falta_valor:
            fim = f"Me manda de novo com o valor. {NADA_DO_PAR}"
        elif conta_errada is not None:
            # sem rascunho no par, "qual delas?" não tem onde encaixar a resposta
            papel = "o cartão" if resolve.conta_e_cartao(conta_errada.type) else "a conta"
            fim = f"Me manda de novo dizendo {papel}. {NADA_DO_PAR}"
        else:
            fim = NADA_DO_PAR
        return {"approved": False, "halted": True, "draft": {},
                "results": [*state.get("results", []), *correction_errors, fim]}
    if correction_errors:
        return {"approved": False, "halted": True,
                "results": [*state.get("results", []), *correction_errors]}

    # 0) Valor numa compra parcelada: "total ou cada parcela?" antes de qualquer SIM.
    #    Posição fixa (antes do empate) para a ordem dos interrupts não mudar no replay.
    alvos = [dict(t) for t in alvos]
    for i, (acao, alvo) in enumerate(zip(acoes, alvos)):
        if i in _incompletas(state, acoes):
            continue
        alvos[i], parada = _perguntar_unidade(state, i, acao, alvo)
        if parada:
            return parada

    # 1) Empate tem precedência: escolher o alvo JÁ É o consentimento explícito,
    #    numa ida e volta só. Perguntar "qual?" e depois "confirma?" seria duas.
    for i, (acao, alvo) in enumerate(zip(acoes, alvos)):
        if i in _incompletas(state, acoes):
            continue
        if alvo.get("status") == "ambiguous":
            escolha = interrupt(
                {
                    "kind": "choice",
                    "action_index": i,
                    "action_type": acao.type.value,
                    "summary": describe_for_confirmation(
                        acao, alvo, hoje=local_iso_date(state.get("timezone", "America/Sao_Paulo"))),
                    "options": alvo["candidates"],
                }
            )
            validos = {c["id"] for c in alvo["candidates"]}
            # O worker manda dict ({"approved", "candidate_id"}); os testes de
            # grafo mandam a string crua. Aceitar só a string deixava o caminho
            # REAL morto: todo clique e todo "2" digitado caíam no cancelamento.
            escolhido = (
                escolha.get("candidate_id") if isinstance(escolha, dict) else escolha
            )
            # Só um id que ESTAVA na lista aprova. "sim" num empate não escolhe
            # nada, e aprovar sem escolher voltaria a ser adivinhação.
            if isinstance(escolhido, str) and escolhido in validos:
                congelado = [dict(t) for t in alvos]
                escolhidos = [c for c in alvo["candidates"] if c["id"] == escolhido]
                # A TABELA vem do candidato, não do alvo. Uma mesma pergunta pode
                # misturar "a compra inteira" (installment_plans) com "a parcela
                # 3/10" (transactions); herdar a do alvo mandaria o id do plano
                # para `ensure_owned("transactions", ...)`, que não acharia nada —
                # depois de o usuário já ter confirmado.
                cand_table = escolhidos[0].get("table", alvo.get("table"))
                congelado[i] = {**alvo, "status": "found", "candidates": escolhidos,
                                "table": cand_table}
                # D1: o cartão (ou a recusa) da conversão é POR candidato no empate
                if escolhidos[0].get("convert_error"):
                    congelado[i]["correction_error"] = escolhidos[0]["convert_error"]
                elif escolhidos[0].get("convert_account"):
                    congelado[i]["convert_account"] = escolhidos[0]["convert_account"]
                congelado[i], parada = _perguntar_unidade(state, i, acao, congelado[i])
                if parada:
                    return parada
                return _confirm_selection(state, {"approved": True, "chosen_id": escolhido, "targets": congelado})
            # SOMA em vez de substituir: `results` tem reducer `_replace`, e
            # sobrescrever aqui apagaria o que a fase segura já gravou — o
            # usuário leria "não mexi em nada" depois de um gasto ter sido
            # criado de verdade.
            return {
                "approved": False,
                "results": [
                    *state.get("results", []),
                    "👌 Beleza, não mexi em nada. Me diz de outro jeito qual era — pelo valor ou pela data.",
                ],
                "halted": True,
            }

    # Consentimento neste aviso vale só para a ação exibida.
    avisos_confirmados: set[int] = set()
    # 1.2) Checagem de limite disponível do cartão (Soft Warning)
    for i, acao in enumerate(acoes):
        if i in _incompletas(state, acoes):
            continue
        if (
            acao.type in {FinanceActionType.CREATE_EXPENSE, FinanceActionType.CREATE_INSTALLMENT_PURCHASE}
            and acao.account
            and acao.amount_cents
        ):
            from app.tools.finance import resolve_account, verificar_limite_disponivel
            # a MESMA régua da tool que grava (`_CONTAS_CITADAS`): num gasto comum,
            # "Nubank" é a conta corrente, e só entre cartões ela casava com
            # "Nubank Cartão" — aviso falso. Conta que não é cartão não tem linha em
            # `_card_summary`, então não avisa.
            acc_id = await resolve_account(state["workspace_id"], acao.account,
                                           only_cards=bool(resolve.conta_e_cartao(acao.type)))
            if acc_id:
                limite_res = await verificar_limite_disponivel(
                    state["workspace_id"], state["user_id"], acc_id, acao.amount_cents
                )
                if limite_res.get("excedeu"):
                    card_name = limite_res.get("card_name") or acao.account
                    limite_str = cents_to_brl(limite_res["limite_centavos"])
                    disp_str = cents_to_brl(limite_res["disponivel_centavos"])
                    novo_disp = cents_to_brl(limite_res["disponivel_centavos"] - acao.amount_cents)
                    # Este aviso É o SIM da compra ("Confirmar mesmo assim" a tira da
                    # pergunta final), então ele diz o efeito inteiro: valor, o quê,
                    # parcelas, cartão, conta — a mesma frase da confirmação comum.
                    efeito = describe_for_confirmation(
                        acao, alvos[i] or None, hoje=local_iso_date(state.get("timezone", "America/Sao_Paulo"))
                    ).removeprefix("registrar ")
                    aviso = (
                        f"⚠️ *Aviso:* Esta compra excede o limite disponível do seu {card_name} "
                        f"(Limite: {limite_str}, Disponível atual: {disp_str} → ficaria {novo_disp}). "
                        f"Registrar {efeito} mesmo assim, ou prefere trocar de cartão?"
                    )
                    escolha = interrupt(
                        {
                            "kind": "soft_warning",
                            "action_index": i,
                            "action_type": acao.type.value,
                            "summary": aviso,
                            "options": [
                                {"id": "confirm", "label": "Confirmar mesmo assim"},
                                {"id": "change_card", "label": "Trocar de Cartão"},
                            ],
                        }
                    )
                    escolhido = (
                        escolha.get("candidate_id") if isinstance(escolha, dict) else escolha
                    )
                    if escolhido == "change_card":
                        new_account = escolha.get("new_account") if isinstance(escolha, dict) else None
                        if new_account and await resolve_account(state["workspace_id"], new_account, only_cards=True):
                            revised = list(state.get("finance_actions") or [])
                            revised[i] = acao.model_copy(update={"account": new_account}).model_dump(mode="json")
                            # Replay the gate with the replacement card. Choosing it is
                            # not permission: its own limit and final summary must run.
                            return {"finance_actions": revised, "targets": alvos,
                                    "approved": False, "revision_pending": True}
                        if par:
                            # sem rascunho no par (ver `_rascunho`): a frase refeita
                            # com o cartão certo recomeça as duas metades juntas
                            return {
                                "approved": False, "halted": True, "draft": {},
                                "results": [*state.get("results", []),
                                            f"💳 Me manda de novo dizendo o cartão. {NADA_DO_PAR}"],
                            }
                        pergunta = f"💳 Qual outro cartão você prefere usar para esta compra de {cents_to_brl(acao.amount_cents)}?"
                        return {
                            "approved": False,
                            "draft": {
                                "action": acao.model_copy(update={"account": None}).model_dump(mode="json"),
                                "raw_text": state.get("text", ""),
                                "missing": pergunta,
                                "slot": "account",
                            },
                            "results": [*state.get("results", []), pergunta],
                            "halted": True,
                        }
                    # Uma escolha válida não significa autorização de escrita.
                    # Texto SIM chega como bool; botão Confirmar carrega id próprio.
                    if escolha is True or escolhido == "confirm" or (
                        isinstance(escolha, dict) and escolha.get("approved") is True
                        and not escolha.get("candidate_id")
                    ):
                        avisos_confirmados.add(i)
                        continue
                    return {
                        "approved": False,
                        "results": [*state.get("results", []), "👍 Beleza, não registrei a compra."],
                        "halted": True,
                    }

    # Ação incompleta não vira pergunta: o usuário já recebeu o pedido do que
    # falta, e confirmar "registrar None" não é uma decisão que dá para tomar.
    bloqueadas = _incompletas(state, acoes)
    # Toda escrita tem motivo desde 21/09/2026 (`needs_confirmation`), então a
    # pergunta ENUMERA tudo o que o SIM vai gravar. No par, o aviso de limite já
    # aceito não tira a criação da frase: um SIM, tudo nele. Fora do par, aceitar
    # o aviso de limite ("Confirmar mesmo assim", que cita valor e cartão) É o SIM
    # daquele item — perguntar de novo seria dois SIMs para a mesma compra.
    motivos = [
        (a, alvo, needs_confirmation(a, confidence, alvo or None))
        for i, (a, alvo) in enumerate(zip(acoes, alvos))
        if i not in bloqueadas and (i not in avisos_confirmados or i in par)
    ]
    pendentes = [(a, t, m) for a, t, m in motivos if m]
    # `amount_unit` mora nos alvos: sem devolvê-los ele não chega ao checkpoint e a
    # execução, logo depois do SIM, responderia "peça de novo".
    if not pendentes:
        return {"approved": True, "targets": alvos}

    # 2) UMA pergunta por execução, enumerando TUDO que o SIM vai executar.
    #    Um laço de perguntas cansaria; e o bug antigo era o oposto — perguntava
    #    sobre a primeira ação e o SIM liberava o lote inteiro, calado.
    #    Ação com alvo `none` fica de fora: confirmar "apagar o lançamento" e
    #    receber "não achei" é pior que não ter perguntado.
    hoje = local_iso_date(state.get("timezone", "America/Sao_Paulo"))
    itens = [
        describe_for_confirmation(a, t or None, hoje=hoje)
        # na ordem em que o SIM executa (`_executar`): a pasta antes da nota que mora nela
        for a, t, _ in sorted(pendentes, key=lambda p: not _cria_pasta(p[0]))
        if (t or {}).get("status") != "none"
    ]
    if not itens:
        return {"approved": True, "targets": alvos}

    acao, alvo, motivo = pendentes[0]
    resposta = interrupt(
        {
            "kind": "confirmation",
            "reason": motivo,
            "summary": itens[0] if len(itens) == 1 else "; ".join(itens),
            "items": itens,
            "action_type": acao.type.value,
        }
    )

    if isinstance(resposta, dict) and resposta.get("revision_scope"):
        if len(acoes) == 1 and acao.type == FinanceActionType.MARK_PAID and alvo.get("table") == "installment_plans" and len(alvo.get("candidates", [])) == 1:
            from app.domain.installment_scope import scope_from_text
            from app.graph.schemas import InstallmentScope
            scope = scope_from_text(resposta.get("revision_text", ""), InstallmentScope.model_validate(resposta["revision_scope"]))
            revised_action = acao.model_copy(update={"installment_scope": scope})
            revised_target = await resolve._bounded_plan_target(state["workspace_id"], alvo["candidates"], scope)
            revised = [revised_action.model_dump(mode="json")]
            return {"finance_actions": revised, "targets": [revised_target], "approved": False, "revision_pending": True}
        return {"approved": False, "halted": True, "results": [*state.get("results", []), "Diga uma compra e o intervalo de parcelas para revisar a baixa. Nada foi alterado."]}

    if resposta is True or (isinstance(resposta, str) and resposta.lower() in {"sim", "s", "true"}):
        return {"approved": True, "targets": alvos}
    if isinstance(resposta, dict) and resposta.get("approved") and not resposta.get("candidate_id"):
        return {"approved": True, "chosen_id": resposta.get("candidate_id") or "", "targets": alvos}
    # idem: preserva o que a fase segura executou antes da pergunta
    return {
        "approved": False,
        "results": [*state.get("results", []), "👍 Ok, não fiz nada."],
        "halted": True,
    }


def after_gate(state: AgentState) -> str:
    if state.get("revision_pending"):
        return "gate"
    return "executar" if state.get("approved") else "compor"


# ---------------------------------------------------------------------------
# execução e composição
# ---------------------------------------------------------------------------


async def _executar(
    state: AgentState, indexadas: list[tuple[int, object]]
) -> tuple[list[str], dict | None, dict | None, list[str]]:
    """Roda as ações dadas, preservando o `action_index` ORIGINAL."""
    ctx = ExecContext(
        user_id=state["user_id"],
        workspace_id=state["workspace_id"],
        phone=state["phone"],
        timezone=state["timezone"],
        texto=state.get("text", ""),
        source_message_id=state["source_message_id"],
        last_query_data=state.get("last_query_data"),
        clicked_id=state.get("clicked_id"),
    )
    acoes = _actions(state)
    alvos = (list(state.get("targets") or []) + [{}] * len(acoes))[: len(acoes)]
    ctx.siblings = list(indexadas)

    # ⚠️ **Par de substituição é atômico** (D3): as criações rodam PRIMEIRO, e o
    # apagar/corrigir só roda se todas escreveram. Ordem estável e índice
    # ORIGINAL (é a chave de `executed_actions`). Lote comum: ordem e "falha
    # isolada não derruba as outras" de sempre.
    par = par_de_substituicao(acoes, alvos)
    # Pasta nova do lote vem antes de tudo: "crie a pasta App e ponha a nota X" tem a nota
    # (nó de notas) na frente da pasta (nó de cadastros) em `_actions`, e a nota criava a
    # pasta antes — o cadastro da pasta batia no unique logo depois.
    indexadas = sorted(
        indexadas, key=lambda ia: (not _cria_pasta(ia[1]), bool(par) and not _cria(ia[1]))
    )
    criacao_falhou = None
    # I3: no par o antecedente do próximo turno é a CRIAÇÃO, não o apagado (que roda
    # por último e seria `escritos[-1]`). `ctx.created[:marca]` corta o que veio depois.
    marca = None

    linhas: list[str] = []
    spec_interativo: dict | None = None
    ultimo_data: dict | None = None
    for indice, acao in indexadas:
        if criacao_falhou is not None:
            # nada parcial: nem o apagar, nem as criações seguintes do par
            linhas.append(_nao_fiz(acao, alvos[indice], criacao_falhou,
                                   hoje=local_iso_date(ctx.timezone)))
            continue
        ctx.action_index = indice
        ctx.target = alvos[indice] or None
        if isinstance(acao, FinanceAction) and acao.type in RULE_APPLIES:
            acao = await apply_rules(ctx.workspace_id, acao)
        resultado = await execute(ctx, acao)
        if (par and _cria(acao) and criacao_falhou is None
                and resultado.read_only and not resultado.ja_executada):
            criacao_falhou = acao
        if par and _cria(acao) and (not resultado.read_only or resultado.ja_executada):
            # retentativa (`ja_executada`): a criação é de outra tentativa; sem o id
            # dela aqui, `[:marca]` fica vazio e o antecedente anterior é preservado
            marca = len(ctx.created)
        if resultado.message:
            linhas.append(resultado.message)
        if resultado.interactive_spec:
            spec_interativo = resultado.interactive_spec
        if resultado.data:
            ultimo_data = resultado.data
    escritos = ctx.created[:marca] if marca is not None else ctx.created
    return linhas, spec_interativo, ultimo_data, escritos


def _cria(acao) -> bool:
    """A mesma régua de `par_de_substituicao`: `create_*` de finanças."""
    return isinstance(acao, FinanceAction) and acao.type.value.startswith("create_")


def _cria_pasta(acao) -> bool:
    return (isinstance(acao, ResourceAction) and acao.type == ResourceActionType.CREATE
            and acao.resource == "folders")


def _rotulo_novo(criacao: FinanceAction) -> str:
    """Nome + valor: "wardogs" sozinho não distingue a compra nova da velha."""
    nome = criacao.description or criacao.category or "o lançamento novo"
    return f"{nome} ({cents_to_brl(criacao.amount_cents)})" if criacao.amount_cents else nome


def _nao_fiz(acao, alvo: dict, criacao: FinanceAction, hoje: str | None = None) -> str:
    novo = _rotulo_novo(criacao)
    if _cria(acao):
        return f"⚠️ Não registrei {_rotulo_novo(acao)} porque não consegui registrar {novo}."
    verbo = {"delete_transaction": "apaguei", "undo_last": "apaguei",
             "update_transaction": "corrigi"}.get(acao.type.value, "mexi em")
    candidatos = (alvo or {}).get("candidates") or []
    if not candidatos:
        # a frase de confirmação já começa com verbo ("apagar o seu…")
        return f"⚠️ Não fiz: {describe_for_confirmation(acao, alvo or None, hoje=hoje)} — porque não consegui registrar {novo}."
    return f"⚠️ Não {verbo} {candidatos[0]['label']} porque não consegui registrar {novo}."


async def execute_node(state: AgentState) -> dict:
    bloqueadas = _incompletas(state, _actions(state))
    acoes = [(i, a) for i, a in enumerate(_actions(state)) if i not in bloqueadas]
    res = await _executar(state, acoes)
    linhas = res[0] if isinstance(res, tuple) else res
    spec = res[1] if isinstance(res, tuple) and len(res) > 1 else None
    query_data = res[2] if isinstance(res, tuple) and len(res) > 2 else None
    escritos = res[3] if isinstance(res, tuple) and len(res) > 3 else []
    ret = {"results": [*state.get("results", []), *linhas]}
    if escritos:
        # O último id escrito no turno é o antecedente de "esse"/"isso" no turno
        # seguinte — é o que faz "apague esse lançamento" logo depois de
        # "gastei 20 no café" apontar para o café, e não para os nove mais
        # recentes do workspace (que incluem o que o cron materializou de
        # madrugada). Um DELETE também grava aqui, e isso está certo: quem lê
        # revalida a existência, e antecedente morto vira pergunta.
        ret["last_write_id"] = escritos[-1]
    if spec:
        texto_completo = "\n\n".join(l for l in ret["results"] if l)
        ret["reply"] = {**spec, "body": texto_completo, "text": texto_completo}
    if query_data:
        ret["last_query_data"] = query_data
    return ret


async def compose(state: AgentState) -> dict:
    """Uma mensagem consolidada. Template puro, zero LLM."""
    if isinstance(state.get("reply"), dict):
        spec = state["reply"]
        texto = spec.get("text") or spec.get("body") or ""
        ret = {}
        if texto:
            # o vetor inteiro, porque `messages` substitui em vez de acumular
            ret["messages"] = [
                *state.get("messages", []),
                {"role": "assistant", "content": texto},
            ]
        return ret
    linhas = [l for l in state.get("results", []) if l]
    if not linhas:
        linhas = [AJUDA]
    texto_reply = "\n".join(linhas)
    return {
        "reply": texto_reply,
        "messages": [
            *state.get("messages", []),
            {"role": "assistant", "content": texto_reply},
        ],
    }
