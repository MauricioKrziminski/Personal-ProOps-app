"""Nós do grafo.

Um princípio atravessa todos: o modelo só produz objeto validado. Nenhum nó
deixa texto do modelo virar resposta ao usuário ou argumento de banco — o que
vai para o WhatsApp é template Python sobre números que já lemos.
"""

from __future__ import annotations

import logging

from langgraph.types import interrupt

from app.domain.dates import local_datetime_iso
from app.graph.policy import (
    describe_for_confirmation,
    dominio_incerto,
    needs_confirmation,
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
)
from app.domain.required import faltando
from app.domain.money import cents_to_brl
from app.graph.state import AgentState
from app.tools import resolve
from app.services import gemini
from app.tools.base import ExecContext
from app.tools.finance import apply_rules
from app.tools.registry import AJUDA, execute

log = logging.getLogger(__name__)

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
    if curto in {"oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "obrigado", "obrigada", "vlw", "valeu"}:
        return {"domains": [Domain.GERAL.value], "confidence": 1.0, "llm_calls": 0}

    # Documento anexo é quase sempre cupom/fatura: vai direto para finanças.
    if state.get("media"):
        return {"domains": [Domain.FINANCAS.value], "confidence": 1.0, "llm_calls": 0}

    historico = state.get("messages")[:-1] if state.get("messages") else None
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
                ),
            ),
        ]
    )
    dominios = [d.value for d in decisao.domains] or [Domain.GERAL.value]
    return {"domains": dominios, "confidence": decisao.confidence, "llm_calls": 1}


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
    }
    escolhidos = [mapa[d] for d in state.get("domains", []) if d in mapa]
    return escolhidos or ["geral"]


# ---------------------------------------------------------------------------
# domínios
# ---------------------------------------------------------------------------


async def finance_node(state: AgentState) -> dict:
    if state.get("preset"):
        return {}  # ações semeadas: não reextrair

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
                ),
            ),
        ]
    )
    acoes = [a for a in plano.actions if a.type.value != "unknown"]
    texto_orig = state.get("text", "")
    for a in acoes:
        if a.type in (
            FinanceActionType.CREATE_EXPENSE,
            FinanceActionType.CREATE_INCOME,
            FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
        ):
            if not a.description:
                a.description = guards.extract_description_fallback(texto_orig)
            if a.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE and not a.account:
                a.account = guards.extract_account_fallback(texto_orig)
    return {
        "finance_actions": [a.model_dump() for a in acoes],
        "confidence": min(state.get("confidence", 1.0), plano.confidence),
        "llm_calls": 1,
    }


async def finance_query_node(state: AgentState) -> dict:
    if state.get("preset"):
        return {}  # ações semeadas: não reextrair

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


async def notes_node(state: AgentState) -> dict:
    if state.get("preset"):
        return {}  # ações semeadas: não reextrair

    historico = state.get("messages")[:-1] if state.get("messages") else None
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


async def general_node(state: AgentState) -> dict:
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

    if not any(getattr(a, "type", None) in resolve.TARGETS for a in acoes):
        return {"targets": [{} for _ in acoes], "results": esclarecimentos,
            "draft": _rascunho(state, acoes)}

    alvos = await resolve.for_actions(
        state["workspace_id"], acoes, state.get("text", "")
    )
    return {"targets": alvos, "results": esclarecimentos,
            "draft": _rascunho(state, acoes)}


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
        if (faltou := faltando(acao, texto)) is not None
    }


def _esclarecimentos(state: AgentState, acoes: list) -> list[str]:
    return [*state.get("results", []),
            *(pergunta for _, pergunta in _incompletas(state, acoes).values())]


def _rascunho(state: AgentState, acoes: list) -> dict:
    """A extração incompleta que vale guardar, ou {}.

    Só a PRIMEIRA: dois rascunhos abertos tornariam "foi 5000" ambíguo, do mesmo
    jeito que duas perguntas abertas tornariam "sim" ambíguo. O grafo só monta o
    objeto — quem grava é o worker, como já faz com `pending_actions`.
    """
    for i, (slot, pergunta) in _incompletas(state, acoes).items():
        return {
            "action": acoes[i].model_dump(mode="json"),
            "raw_text": state.get("text", ""),
            "missing": pergunta,
            "slot": slot,
        }
    return {}


async def safe_node(state: AgentState) -> dict:
    """Executa AGORA o que não precisa de confirmação. Fase segura do lote."""
    if state.get("halted"):
        return {}
    acoes = _actions(state)
    if not acoes:
        return {}

    confidence = state.get("confidence", 1.0)
    alvos = (list(state.get("targets") or []) + [{}] * len(acoes))[: len(acoes)]
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
    ret = {"results": [*state.get("results", []), *linhas]}
    if spec:
        texto_completo = "\n\n".join(l for l in ret["results"] if l)
        ret["reply"] = {**spec, "body": texto_completo, "text": texto_completo}
    if query_data:
        ret["last_query_data"] = query_data
    return ret


async def gate(state: AgentState) -> dict:
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
                    "summary": describe_for_confirmation(acao),
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
                if cand_table == "installment_plans" and acao.type == FinanceActionType.UPDATE_TRANSACTION:
                    p_id = escolhido
                    p_label = escolhidos[0]["label"]
                    mut_escolha = interrupt(
                        {
                            "kind": "choice",
                            "action_index": i,
                            "action_type": acao.type.value,
                            "summary": f"O que você deseja fazer com {p_label}?",
                            "options": [
                                {"id": f"change_paid:{p_id}", "label": "Mudar parcelas pagas"},
                                {"id": f"delete_plan:{p_id}", "label": "Excluir plano completo"},
                            ],
                        }
                    )
                    mut_id = mut_escolha.get("candidate_id") if isinstance(mut_escolha, dict) else mut_escolha
                    if isinstance(mut_id, str):
                        if mut_id.startswith("delete_plan") or mut_id in {"delete_plan", "excluir", "apagar", "2"}:
                            acoes_mutadas = list(state.get("finance_actions") or [])
                            acoes_mutadas[i] = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION).model_dump()
                            return {"approved": True, "targets": congelado, "finance_actions": acoes_mutadas}
                        if mut_id.startswith("change_paid") or mut_id in {"change_paid", "mudar", "pagas", "1"}:
                            if acao.current_installment:
                                acoes_mutadas = list(state.get("finance_actions") or [])
                                acoes_mutadas[i] = FinanceAction(
                                    type=FinanceActionType.MARK_PAID,
                                    current_installment=acao.current_installment,
                                ).model_dump()
                                return {"approved": True, "targets": congelado, "finance_actions": acoes_mutadas}
                            return {
                                "approved": False,
                                "results": [
                                    *state.get("results", []),
                                    f"📝 Quantas parcelas de *{p_label}* você já pagou? (Ex: 'já paguei 3' ou me diz o número)",
                                ],
                                "halted": True,
                            }
                    return {
                        "approved": False,
                        "results": [*state.get("results", []), "👍 Beleza, não mexi em nada."],
                        "halted": True,
                    }

                return {"approved": True, "chosen_id": escolhido, "targets": congelado}
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

    # 1.1) Mutação direta de plano de parcelamento em UPDATE_TRANSACTION
    for i, (acao, alvo) in enumerate(zip(acoes, alvos)):
        if i in _incompletas(state, acoes):
            continue
        if (
            alvo.get("status") == "found"
            and alvo.get("table") == "installment_plans"
            and acao.type == FinanceActionType.UPDATE_TRANSACTION
        ):
            cand = alvo["candidates"][0]
            p_id = cand["id"]
            p_label = cand["label"]
            escolha = interrupt(
                {
                    "kind": "choice",
                    "action_index": i,
                    "action_type": acao.type.value,
                    "summary": f"O que você deseja fazer com {p_label}?",
                    "options": [
                        {"id": f"change_paid:{p_id}", "label": "Mudar parcelas pagas"},
                        {"id": f"delete_plan:{p_id}", "label": "Excluir plano completo"},
                    ],
                }
            )
            escolhido = (
                escolha.get("candidate_id") if isinstance(escolha, dict) else escolha
            )
            if isinstance(escolhido, str):
                if escolhido.startswith("delete_plan") or escolhido in {"delete_plan", "excluir", "apagar", "2"}:
                    congelado = [dict(t) for t in alvos]
                    congelado[i] = {**alvo, "status": "found", "table": "installment_plans"}
                    acoes_mutadas = list(state.get("finance_actions") or [])
                    acoes_mutadas[i] = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION).model_dump()
                    return {"approved": True, "targets": congelado, "finance_actions": acoes_mutadas}
                if escolhido.startswith("change_paid") or escolhido in {"change_paid", "mudar", "pagas", "1"}:
                    congelado = [dict(t) for t in alvos]
                    congelado[i] = {**alvo, "status": "found", "table": "installment_plans"}
                    if acao.current_installment:
                        acoes_mutadas = list(state.get("finance_actions") or [])
                        acoes_mutadas[i] = FinanceAction(
                            type=FinanceActionType.MARK_PAID,
                            current_installment=acao.current_installment,
                        ).model_dump()
                        return {"approved": True, "targets": congelado, "finance_actions": acoes_mutadas}
                    return {
                        "approved": False,
                        "results": [
                            *state.get("results", []),
                            f"📝 Quantas parcelas de *{p_label}* você já pagou? (Ex: 'já paguei 3' ou me diz o número)",
                        ],
                        "halted": True,
                    }
            return {
                "approved": False,
                "results": [*state.get("results", []), "👍 Beleza, não mexi em nada."],
                "halted": True,
            }

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
            acc_id = await resolve_account(state["workspace_id"], acao.account, only_cards=True)
            if acc_id:
                limite_res = await verificar_limite_disponivel(state["workspace_id"], acc_id, acao.amount_cents)
                if limite_res.get("excedeu"):
                    card_name = limite_res.get("card_name") or acao.account
                    limite_str = cents_to_brl(limite_res["limite_centavos"])
                    disp_str = cents_to_brl(limite_res["disponivel_centavos"])
                    novo_disp = cents_to_brl(limite_res["disponivel_centavos"] - acao.amount_cents)
                    aviso = (
                        f"⚠️ *Aviso:* Esta compra excede o limite disponível do seu {card_name} "
                        f"(Limite: {limite_str}, Disponível atual: {disp_str} → ficaria {novo_disp}). "
                        "Deseja registrar mesmo assim ou prefere trocar de cartão?"
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
                    if isinstance(escolhido, str) and (
                        escolhido in {"confirm", "yes", "sim", "1", "ok"}
                        or (isinstance(escolha, dict) and escolha.get("approved"))
                    ):
                        return {"approved": True}
                    if isinstance(escolhido, str) and (escolhido in {"change_card", "trocar", "2"}):
                        return {
                            "approved": False,
                            "results": [
                                *state.get("results", []),
                                f"💳 Qual outro cartão você prefere usar para esta compra de {cents_to_brl(acao.amount_cents)}?",
                            ],
                            "halted": True,
                        }
                    return {
                        "approved": False,
                        "results": [*state.get("results", []), "👍 Beleza, não registrei a compra."],
                        "halted": True,
                    }

    # Ação incompleta não vira pergunta: o usuário já recebeu o pedido do que
    # falta, e confirmar "registrar None" não é uma decisão que dá para tomar.
    bloqueadas = _incompletas(state, acoes)
    motivos = [
        (a, alvo, needs_confirmation(a, confidence, alvo or None))
        for i, (a, alvo) in enumerate(zip(acoes, alvos))
        if i not in bloqueadas
    ]
    pendentes = [(a, t, m) for a, t, m in motivos if m]
    if not pendentes:
        return {"approved": True}

    # 2) UMA pergunta por execução, enumerando TUDO que o SIM vai executar.
    #    Um laço de perguntas cansaria; e o bug antigo era o oposto — perguntava
    #    sobre a primeira ação e o SIM liberava o lote inteiro, calado.
    #    Ação com alvo `none` fica de fora: confirmar "apagar o lançamento" e
    #    receber "não achei" é pior que não ter perguntado.
    itens = [
        describe_for_confirmation(a, t or None)
        for a, t, _ in pendentes
        if (t or {}).get("status") != "none"
    ]
    if not itens:
        return {"approved": True}

    acao, alvo, motivo = pendentes[0]
    resposta = interrupt(
        {
            "kind": "confirmation",
            "reason": motivo,
            "summary": itens[0] if len(itens) == 1 else "; ".join(itens[:5]),
            "items": itens[:5],
            "action_type": acao.type.value,
        }
    )

    if resposta is True or (isinstance(resposta, str) and resposta.lower() in {"sim", "s", "true"}):
        return {"approved": True}
    if isinstance(resposta, dict) and resposta.get("approved"):
        return {"approved": True, "chosen_id": resposta.get("candidate_id") or ""}
    # idem: preserva o que a fase segura executou antes da pergunta
    return {
        "approved": False,
        "results": [*state.get("results", []), "👍 Ok, não fiz nada."],
        "halted": True,
    }


def after_gate(state: AgentState) -> str:
    return "executar" if state.get("approved") else "compor"


# ---------------------------------------------------------------------------
# execução e composição
# ---------------------------------------------------------------------------


async def _executar(
    state: AgentState, indexadas: list[tuple[int, object]]
) -> tuple[list[str], dict | None, dict | None]:
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

    linhas: list[str] = []
    spec_interativo: dict | None = None
    ultimo_data: dict | None = None
    for indice, acao in indexadas:
        ctx.action_index = indice
        ctx.target = alvos[indice] or None
        if isinstance(acao, FinanceAction) and acao.type in RULE_APPLIES:
            acao = await apply_rules(ctx.workspace_id, acao)
        resultado = await execute(ctx, acao)
        if resultado.message:
            linhas.append(resultado.message)
        if resultado.interactive_spec:
            spec_interativo = resultado.interactive_spec
        if resultado.data:
            ultimo_data = resultado.data
    return linhas, spec_interativo, ultimo_data


async def execute_node(state: AgentState) -> dict:
    bloqueadas = _incompletas(state, _actions(state))
    acoes = [(i, a) for i, a in enumerate(_actions(state)) if i not in bloqueadas]
    res = await _executar(state, acoes)
    linhas = res[0] if isinstance(res, tuple) else res
    spec = res[1] if isinstance(res, tuple) and len(res) > 1 else None
    query_data = res[2] if isinstance(res, tuple) and len(res) > 2 else None
    ret = {"results": [*state.get("results", []), *linhas]}
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
            ret["messages"] = [{"role": "assistant", "content": texto}]
        return ret
    linhas = [l for l in state.get("results", []) if l]
    if not linhas:
        linhas = [AJUDA]
    texto_reply = "\n".join(linhas)
    return {
        "reply": texto_reply,
        "messages": [{"role": "assistant", "content": texto_reply}],
    }
