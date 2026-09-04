"""O ciclo completo do HITL: o grafo PARA, guarda o estado, e retoma no
`Command(resume=...)` — que é o que faz uma confirmação sobreviver ao container
morrer entre a pergunta e o "sim". Num canal assíncrono como WhatsApp esse
intervalo é o caso normal, não a exceção.

Sem rede e sem banco: os nós que falam com o mundo são substituídos.
"""

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.config import get_settings
from app.graph import build as build_mod
from app.graph.schemas import FinanceActionType


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("HITL_AMOUNT_THRESHOLD_CENTS", "100000")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def grafo(monkeypatch):
    """Grafo real, com router/domínio/execução substituídos por dublês.

    Só estes três falam com o mundo (Gemini e Postgres). Gate, arestas,
    checkpointer e interrupt são os DE VERDADE — é isso que o teste verifica.
    """
    from app.graph import nodes

    async def router_falso(state):
        return {"domains": ["financas"], "confidence": state.get("confidence", 1.0)}

    async def financas_falso(state):
        # o plano já vem pronto no estado inicial: o dublê só não chama o modelo
        return {}

    async def _executar_falso(state, indexadas):
        """Dublê no ponto onde as DUAS fases passam (segura e pós-SIM).

        Dublar só `execute_node` deixava a fase segura chamando o banco de
        verdade — que é justamente o caminho novo que precisa de cobertura.
        """
        return ["EXECUTOU" for _ in indexadas]

    monkeypatch.setattr(nodes, "_executar", _executar_falso)

    async def alvos_falso(workspace_id, acoes, texto_cru):
        """Dublê da Fase Cognitiva: alvo único e resolvido, salvo se o teste
        tiver pré-carregado `targets` no estado inicial."""
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-1", "label": "gasto de R$ 45,00 em *mercado*"}]}
            if getattr(a, "type", None) in _r.TARGETS else {}
            for a in acoes
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos_falso)
    monkeypatch.setattr(nodes, "route", router_falso)
    async def notas_falso(state):
        return {}

    monkeypatch.setattr(nodes, "finance_node", financas_falso)
    monkeypatch.setattr(nodes, "notes_node", notas_falso)
    # o build resolve os nós no momento da montagem
    import importlib

    importlib.reload(build_mod)
    return build_mod.build(InMemorySaver())


def _estado(acoes):
    return {
        "thread_id": "t1", "phone": "5551999999999", "user_id": "u1",
        "workspace_id": "w1", "timezone": "America/Sao_Paulo",
        "source_message_id": "wamid.1", "text": "teste", "media": None,
        "results": [], "domains": [], "finance_actions": [], "finance_queries": [],
        "notes_actions": [],
        "confidence": 1.0, "approved": False, "halted": False,
    } | {"finance_actions": acoes}


@pytest.mark.asyncio
async def test_gasto_comum_executa_sem_perguntar(grafo):
    config = {"configurable": {"thread_id": "sem-pergunta"}}
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"}]),
        config=config,
    )
    assert "__interrupt__" not in estado
    assert "EXECUTOU" in estado["reply"]


@pytest.mark.asyncio
async def test_destrutiva_para_e_so_executa_depois_do_sim(grafo):
    config = {"configurable": {"thread_id": "com-pergunta"}}
    acao = [{"type": FinanceActionType.UNDO_LAST.value}]

    estado = await grafo.ainvoke(_estado(acao), config=config)
    # parou ANTES de executar
    pausa = estado["__interrupt__"][0]
    valor = getattr(pausa, "value", pausa)
    assert valor["reason"] == "destrutiva"
    assert "apagar" in valor["summary"]

    # o "sim" retoma na MESMA thread e aí sim executa
    retomado = await grafo.ainvoke(Command(resume=True), config=config)
    assert "EXECUTOU" in retomado["reply"]


@pytest.mark.asyncio
async def test_nao_cancela_sem_executar(grafo):
    config = {"configurable": {"thread_id": "recusa"}}
    await grafo.ainvoke(_estado([{"type": FinanceActionType.UNDO_LAST.value}]), config=config)

    recusado = await grafo.ainvoke(Command(resume=False), config=config)
    assert "EXECUTOU" not in recusado["reply"]
    assert "não fiz nada" in recusado["reply"]


@pytest.mark.asyncio
async def test_valor_alto_tambem_para(grafo):
    config = {"configurable": {"thread_id": "valor-alto"}}
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 480_000,
                  "category": "reforma"}]),
        config=config,
    )
    valor = getattr(estado["__interrupt__"][0], "value", estado["__interrupt__"][0])
    assert valor["reason"] == "valor alto"


@pytest.mark.asyncio
async def test_fast_path_nao_consome_mensagem_da_cota(grafo):
    """`llm_calls` é o que vira linha em `ai_events`, e `ai_events` é o que a cota
    do plano CONTA. Um caminho que não chamou modelo cobrando mensagem do usuário
    é bug de cobrança, não de código."""
    from app.graph import nodes

    config = {"configurable": {"thread_id": "fast-path"}}
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"}]),
        config=config,
    )
    # o dublê de router devolve o fast-path (sem llm_calls); nada a cobrar
    assert estado.get("llm_calls", 0) == 0


def test_chamadas_de_modelo_somam_no_fan_out():
    """Router + dois domínios em paralelo = 3. Reducer errado aqui perderia
    contagem (o `_replace` das outras chaves manteria só a última).

    Assere COMPORTAMENTO, não identidade da função: a versão anterior exigia
    `is operator.add`, e por isso quebrou quando o reducer passou a também zerar
    entre turnos — uma correção de bug, não uma regressão. Teste que prende a
    implementação transforma conserto em falha vermelha.
    """
    import typing

    from app.graph.state import AgentState

    # `from __future__ import annotations` deixa a anotação como string:
    # get_type_hints resolve, include_extras preserva o Annotated
    hints = typing.get_type_hints(AgentState, include_extras=True)
    soma = hints["llm_calls"].__metadata__[0]

    # router (1) e depois os dois domínios do fan-out (1 + 1) = 3
    assert soma(soma(0, 1), 1) == 2
    assert soma(soma(soma(0, 1), 1), 1) == 3


# ---------------------------------------------------------------------------
# Freeze Frame: o alvo é resolvido ANTES da pergunta e congelado no checkpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pergunta_cita_a_linha_real_e_nao_o_eco_do_modelo(grafo):
    """O bug que originou tudo: o usuário lia "apagar a nota sobre última
    mensagem" — o texto que o MODELO escreveu — em vez do registro de verdade."""
    estado = await grafo.ainvoke(
        _estado(
            [{"type": "delete_transaction", "description": "última mensagem"}]
        ),
        config={"configurable": {"thread_id": "freeze-1"}},
    )
    pausa = estado["__interrupt__"][0]
    valor = pausa.value if hasattr(pausa, "value") else pausa

    assert "R$ 45,00" in valor["summary"], valor["summary"]
    assert "última mensagem" not in valor["summary"]


@pytest.mark.asyncio
async def test_alvo_ambiguo_vira_escolha_e_so_id_da_lista_aprova(monkeypatch, grafo):
    from app.graph import nodes

    async def dois_candidatos(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "gasto de R$ 45"},
                                {"id": "b", "label": "gasto de R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois_candidatos)
    cfg = {"configurable": {"thread_id": "freeze-2"}}

    estado = await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    pausa = estado["__interrupt__"][0]
    valor = pausa.value if hasattr(pausa, "value") else pausa
    assert valor["kind"] == "choice"
    assert [o["id"] for o in valor["options"]] == ["a", "b"]

    # um "sim" NÃO escolhe nada: aprovar sem escolher é voltar a adivinhar
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "EXECUTOU" not in final.get("results", [])


@pytest.mark.asyncio
async def test_escolha_valida_congela_o_id_e_executa(monkeypatch, grafo):
    from app.graph import nodes

    async def dois_candidatos(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "gasto de R$ 45"},
                                {"id": "b", "label": "gasto de R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois_candidatos)
    cfg = {"configurable": {"thread_id": "freeze-3"}}

    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    final = await grafo.ainvoke(Command(resume="b"), config=cfg)

    assert "EXECUTOU" in final.get("results", [])
    assert final.get("chosen_id") == "b"
    # o alvo ficou CONGELADO no id escolhido, não em "o mais recente"
    assert final["targets"][0]["candidates"] == [{"id": "b", "label": "gasto de R$ 80"}]


@pytest.mark.asyncio
async def test_id_inventado_no_resume_nao_executa(monkeypatch, grafo):
    from app.graph import nodes

    async def dois_candidatos(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "x"}, {"id": "b", "label": "y"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois_candidatos)
    cfg = {"configurable": {"thread_id": "freeze-4"}}

    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    final = await grafo.ainvoke(Command(resume="id-que-nao-existe"), config=cfg)

    assert "EXECUTOU" not in final.get("results", [])


# ---------------------------------------------------------------------------
# Execução dividida: o que é seguro grava NA HORA, o sensível espera confirmação
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lote_misto_grava_o_seguro_e_pergunta_o_sensivel(monkeypatch, grafo):
    """"gastei 45 no mercado e apaga o último" não pode segurar o gasto de 45
    esperando uma decisão sobre OUTRA coisa — e um NÃO não pode desfazê-lo."""
    from app.graph import nodes

    async def alvos(workspace_id, acoes, texto_cru):
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-1", "label": "gasto de R$ 80,00"}]}
            if a.type in _r.TARGETS else {}
            for a in acoes
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos)
    cfg = {"configurable": {"thread_id": "split-1"}}

    estado = await grafo.ainvoke(
        _estado([
            {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"},
            {"type": "delete_transaction"},
        ]),
        config=cfg,
    )

    # a criação JÁ rodou — está no estado ANTES de qualquer pergunta
    assert "EXECUTOU" in estado.get("results", []), estado.get("results")
    # e a deleção está esperando
    assert "__interrupt__" in estado


@pytest.mark.asyncio
async def test_nao_no_lote_misto_preserva_o_que_ja_foi_gravado(monkeypatch, grafo):
    from app.graph import nodes

    async def alvos(workspace_id, acoes, texto_cru):
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-1", "label": "gasto de R$ 80,00"}]}
            if a.type in _r.TARGETS else {}
            for a in acoes
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos)
    cfg = {"configurable": {"thread_id": "split-2"}}

    await grafo.ainvoke(
        _estado([
            {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"},
            {"type": "delete_transaction"},
        ]),
        config=cfg,
    )
    final = await grafo.ainvoke(Command(resume=False), config=cfg)

    # cancelar a deleção não pode apagar o gasto que já foi gravado
    assert "EXECUTOU" in final.get("results", []), final.get("results")
    assert "não fiz nada" in " ".join(final.get("results", []))


@pytest.mark.asyncio
async def test_o_que_o_WORKER_manda_no_resume_o_gate_entende(monkeypatch, grafo):
    """A costura entre worker e gate, que quase passou batido.

    Os outros testes chamam `Command(resume="b")` na mão. O worker NUNCA manda
    isso: ele manda o dict que sai de `_congelado(decide(...))`. O gate aceitava
    só a string, então todo clique e todo "2" digitado caíam no cancelamento —
    o caminho feliz estava morto ponta a ponta e a suíte inteira passava.
    """
    from app.domain import confirm
    from app.graph import nodes
    from app.conversation import _congelado

    async def dois(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "R$ 45"}, {"id": "b", "label": "R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois)
    cfg = {"configurable": {"thread_id": "costura-1"}}
    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)

    pendente = {"id": "11111111-2222-3333-4444-555555555555",
                "action": {"candidates": [{"id": "a"}, {"id": "b"}]}}

    # 1) clique no botão do segundo candidato
    decisao = await confirm.decide({"clicked_id": f"pa:{pendente['id']}:c:b"}, pendente)
    final = await grafo.ainvoke(Command(resume=_congelado(decisao, pendente)), config=cfg)
    assert "EXECUTOU" in final.get("results", []), final.get("results")
    assert final["targets"][0]["candidates"] == [{"id": "b", "label": "R$ 80"}]


@pytest.mark.asyncio
async def test_numero_digitado_tambem_chega_inteiro_no_gate(monkeypatch, grafo):
    from app.domain import confirm
    from app.graph import nodes
    from app.conversation import _congelado

    async def dois(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "R$ 45"}, {"id": "b", "label": "R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois)
    cfg = {"configurable": {"thread_id": "costura-2"}}
    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)

    pendente = {"id": "11111111-2222-3333-4444-555555555555",
                "action": {"candidates": [{"id": "a"}, {"id": "b"}]}}
    decisao = await confirm.decide({"text": "1"}, pendente)   # quem não clica, digita
    final = await grafo.ainvoke(Command(resume=_congelado(decisao, pendente)), config=cfg)

    assert "EXECUTOU" in final.get("results", [])
    assert final["chosen_id"] == "a"


@pytest.mark.asyncio
async def test_acao_sem_valor_pede_o_dado_e_NAO_vira_pergunta(grafo):
    """O bug do "Confirma registrar None em 12x?", no grafo inteiro.

    Duas coisas têm que valer ao mesmo tempo: nenhum `interrupt` (não dá para
    confirmar uma ação sem valor) e uma resposta que PEDE o valor — recusar em
    silêncio seria só outra forma de falhar.
    """
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_INSTALLMENT_PURCHASE.value,
                  "installments": 12}]),
        config={"configurable": {"thread_id": "sem-valor"}},
    )

    assert "__interrupt__" not in estado
    assert "None" not in estado["reply"]
    assert "valor" in estado["reply"].lower()
    assert "12x" in estado["reply"]
    assert "EXECUTOU" not in estado.get("results", [])


@pytest.mark.asyncio
async def test_roteador_inseguro_pergunta_o_dominio_antes_de_gravar(grafo):
    """Confiança 0,7: o agente não escolhe entre gasto e nota — ele pergunta."""
    estado = await grafo.ainvoke(
        {**_estado([{"type": FinanceActionType.CREATE_EXPENSE.value,
                     "amount_cents": 4500, "category": "dentista"}]),
         "confidence": 0.7},
        config={"configurable": {"thread_id": "dominio-1"}},
    )
    pausa = estado["__interrupt__"][0]
    valor = getattr(pausa, "value", pausa)

    assert valor["kind"] == "domain"
    assert [o["id"] for o in valor["options"]] == ["financas", "notas"]
    assert "EXECUTOU" not in estado.get("results", [])


@pytest.mark.asyncio
async def test_escolher_o_dominio_REESCREVE_a_rota(grafo):
    """A prova de que a pergunta está no lugar certo.

    Se ela morasse no gate (depois da extração), responder "nota" não teria
    efeito: não existiria `notes_actions` para executar, porque quem rodou foi o
    nó de finanças. Aqui a escolha reescreve `domains` ANTES do fan-out.
    """
    cfg = {"configurable": {"thread_id": "dominio-2"}}
    await grafo.ainvoke(
        {**_estado([{"type": FinanceActionType.CREATE_EXPENSE.value,
                     "amount_cents": 4500, "category": "dentista"}]),
         "confidence": 0.7},
        config=cfg,
    )
    final = await grafo.ainvoke(Command(resume="notas"), config=cfg)

    assert final["domains"] == ["notas"]
    assert final["confidence"] == 1.0     # quem decidiu foi o usuário


@pytest.mark.asyncio
async def test_rascunho_completado_NAO_passa_pelo_roteador():
    """Ações semeadas atravessam o grafo intactas.

    O grafo sempre entra pelo START → router. Sem a marca `preset`, o roteador
    reclassificava a frase ANTIGA (sem o valor, que só apareceu no turno
    seguinte) e o nó de domínio sobrescrevia as ações — no staging isso virou
    uma pergunta "Como você quer registrar isso?" em cima de um rascunho que já
    estava completo.

    Testa as funções REAIS: dublar o roteador aqui testaria o dublê, que é o
    erro que a primeira versão deste teste cometeu.
    """
    from app.graph import nodes

    semeado = {**_estado([{"type": FinanceActionType.CREATE_EXPENSE.value,
                           "amount_cents": 4500, "category": "mercado"}]),
               "preset": True, "domains": ["financas"]}

    # nenhum dos dois toca no estado quando as ações já vieram prontas
    assert await nodes.route(semeado) == {}
    assert await nodes.finance_node(semeado) == {}
    assert await nodes.notes_node(semeado) == {}


@pytest.mark.asyncio
async def test_escolher_a_compra_inteira_troca_a_TABELA_do_alvo(monkeypatch, grafo):
    """A mesma pergunta mistura a compra inteira e uma parcela.

    O alvo nasce com `table = transactions` (a fonte que resolveu), mas o
    candidato "Tudo (10x)" é uma linha de `installment_plans`. Se o congelamento
    herdasse a tabela do ALVO, `registry.execute` chamaria
    `ensure_owned("transactions", <id de plano>)`, não acharia nada, e a ação
    morreria — depois de o usuário já ter confirmado a exclusão.
    """
    from app.graph import nodes

    async def plano_e_parcela(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [
                     {"id": "p1", "label": "Tudo (10x) — TV",
                      "table": "installment_plans"},
                     {"id": "tx1", "label": "TV (3/10)", "table": "transactions"},
                 ]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", plano_e_parcela)
    cfg = {"configurable": {"thread_id": "plano-1"}}

    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    final = await grafo.ainvoke(Command(resume="p1"), config=cfg)

    assert final["targets"][0]["table"] == "installment_plans"
    assert final["targets"][0]["candidates"][0]["id"] == "p1"


@pytest.mark.asyncio
async def test_escolher_a_parcela_mantem_a_tabela_de_transacoes(monkeypatch, grafo):
    """O outro lado da mesma pergunta: escolher a parcela não pode virar plano."""
    from app.graph import nodes

    async def plano_e_parcela(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [
                     {"id": "p1", "label": "Tudo (10x) — TV",
                      "table": "installment_plans"},
                     {"id": "tx1", "label": "TV (3/10)", "table": "transactions"},
                 ]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", plano_e_parcela)
    cfg = {"configurable": {"thread_id": "plano-2"}}

    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    final = await grafo.ainvoke(Command(resume="tx1"), config=cfg)

    assert final["targets"][0]["table"] == "transactions"


@pytest.mark.asyncio
async def test_update_em_plano_mostra_menu_interativo_e_exclui_se_selecionado(monkeypatch, grafo):
    from app.graph import nodes

    async def plano_alvo(workspace_id, acoes, texto_cru):
        return [
            {
                "table": "installment_plans",
                "status": "found",
                "candidates": [
                    {"id": "p1", "label": "Tudo (12x) — Macbook", "table": "installment_plans"}
                ],
            }
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", plano_alvo)
    cfg = {"configurable": {"thread_id": "mut-plano-1"}}

    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.UPDATE_TRANSACTION.value, "description": "mac"}]),
        config=cfg,
    )
    assert "__interrupt__" in estado
    interrupt_val = estado["__interrupt__"][0].value
    assert interrupt_val["kind"] == "choice"
    assert "Macbook" in interrupt_val["summary"]
    assert any("Excluir plano" in opt["label"] for opt in interrupt_val["options"])
    assert any("Mudar parcelas" in opt["label"] for opt in interrupt_val["options"])

    # Usuário seleciona excluir plano
    final = await grafo.ainvoke(Command(resume="delete_plan:p1"), config=cfg)
    assert final["approved"] is True
    assert final["finance_actions"][0]["type"] == FinanceActionType.DELETE_TRANSACTION.value
    assert final["targets"][0]["table"] == "installment_plans"


@pytest.mark.asyncio
async def test_update_em_plano_mudar_parcelas_com_current_installment_atualiza_para_mark_paid(
    monkeypatch, grafo
):
    from app.graph import nodes

    async def plano_alvo(workspace_id, acoes, texto_cru):
        return [
            {
                "table": "installment_plans",
                "status": "found",
                "candidates": [
                    {"id": "p1", "label": "Tudo (12x) — Macbook", "table": "installment_plans"}
                ],
            }
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", plano_alvo)
    cfg = {"configurable": {"thread_id": "mut-plano-2"}}

    estado = await grafo.ainvoke(
        _estado(
            [
                {
                    "type": FinanceActionType.UPDATE_TRANSACTION.value,
                    "description": "mac",
                    "current_installment": 3,
                }
            ]
        ),
        config=cfg,
    )
    assert "__interrupt__" in estado

    final = await grafo.ainvoke(Command(resume="change_paid:p1"), config=cfg)
    assert final["approved"] is True
    assert final["finance_actions"][0]["type"] == FinanceActionType.MARK_PAID.value
    assert final["finance_actions"][0]["current_installment"] == 3


@pytest.mark.asyncio
async def test_update_em_plano_mudar_parcelas_sem_numero_pede_quantidade(monkeypatch, grafo):
    from app.graph import nodes

    async def plano_alvo(workspace_id, acoes, texto_cru):
        return [
            {
                "table": "installment_plans",
                "status": "found",
                "candidates": [
                    {"id": "p1", "label": "Tudo (12x) — Macbook", "table": "installment_plans"}
                ],
            }
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", plano_alvo)
    cfg = {"configurable": {"thread_id": "mut-plano-3"}}

    await grafo.ainvoke(
        _estado([{"type": FinanceActionType.UPDATE_TRANSACTION.value, "description": "mac"}]),
        config=cfg,
    )

    final = await grafo.ainvoke(Command(resume="change_paid:p1"), config=cfg)
    assert final["approved"] is False
    assert final["halted"] is True
    assert "Quantas parcelas" in " ".join(final.get("results", []))
