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
from app.tools.resolve import for_actions as _for_actions_real


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

    async def alvos_falso(workspace_id, acoes, texto_cru, antecedente=None):
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

    async def dois_candidatos(workspace_id, acoes, texto_cru, antecedente=None):
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

    async def dois_candidatos(workspace_id, acoes, texto_cru, antecedente=None):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "gasto de R$ 45"},
                                {"id": "b", "label": "gasto de R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois_candidatos)
    cfg = {"configurable": {"thread_id": "freeze-3"}}

    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    final = await grafo.ainvoke(Command(resume="b"), config=cfg)
    assert '__interrupt__' in final  # seleção não é consentimento final
    assert 'EXECUTOU' not in final.get('results', [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)


    assert "EXECUTOU" in final.get("results", [])
    assert final.get("chosen_id") == "b"
    # o alvo ficou CONGELADO no id escolhido, não em "o mais recente"
    assert final["targets"][0]["candidates"] == [{"id": "b", "label": "gasto de R$ 80"}]


@pytest.mark.asyncio
async def test_id_inventado_no_resume_nao_executa(monkeypatch, grafo):
    from app.graph import nodes

    async def dois_candidatos(workspace_id, acoes, texto_cru, antecedente=None):
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
async def test_par_criar_e_apagar_NAO_grava_nada_antes_do_sim(monkeypatch, grafo):
    """Era `test_lote_misto_grava_o_seguro_e_pergunta_o_sensivel` e MUDOU DE SINAL
    (D3, 21/09/2026). O lote é criar + apagar um registro que EXISTE — um par de
    substituição ("na verdade foi em 2x"). Gravar a criação na hora e perguntar
    só o apagar é o incidente das wardogs ao contrário: um NÃO deixaria a compra
    nova ao lado da antiga. Um SIM para tudo; nada gravado antes dele. Lote sem
    mutação de existente continua gravando na hora (teste dos dois gastos)."""
    from app.graph import nodes

    async def alvos(workspace_id, acoes, texto_cru, antecedente=None):
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

    assert "EXECUTOU" not in estado.get("results", []), estado.get("results")
    valor = getattr(estado["__interrupt__"][0], "value", estado["__interrupt__"][0])
    # a MESMA pergunta lista as duas coisas — inclusive o gasto pequeno
    assert len(valor["items"]) == 2, valor["items"]
    assert any("R$ 45,00" in i for i in valor["items"]), valor["items"]
    assert any("apagar" in i for i in valor["items"]), valor["items"]


@pytest.mark.asyncio
async def test_nao_no_par_nao_grava_nenhuma_das_duas(monkeypatch, grafo):
    """Era `test_nao_no_lote_misto_preserva_o_que_ja_foi_gravado`: no par não há
    o que preservar, porque nada foi gravado antes do SIM (D3)."""
    from app.graph import nodes

    async def alvos(workspace_id, acoes, texto_cru, antecedente=None):
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

    assert "EXECUTOU" not in final.get("results", []), final.get("results")
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

    async def dois(workspace_id, acoes, texto_cru, antecedente=None):
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
    assert '__interrupt__' in final  # seleção não é consentimento final
    assert 'EXECUTOU' not in final.get('results', [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)

    assert "EXECUTOU" in final.get("results", []), final.get("results")
    assert final["targets"][0]["candidates"] == [{"id": "b", "label": "R$ 80"}]


@pytest.mark.asyncio
async def test_numero_digitado_tambem_chega_inteiro_no_gate(monkeypatch, grafo):
    from app.domain import confirm
    from app.graph import nodes
    from app.conversation import _congelado

    async def dois(workspace_id, acoes, texto_cru, antecedente=None):
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
    assert '__interrupt__' in final  # seleção não é consentimento final
    assert 'EXECUTOU' not in final.get('results', [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)


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

    async def plano_e_parcela(workspace_id, acoes, texto_cru, antecedente=None):
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
    assert '__interrupt__' in final  # seleção não é consentimento final
    assert 'EXECUTOU' not in final.get('results', [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)


    assert final["targets"][0]["table"] == "installment_plans"
    assert final["targets"][0]["candidates"][0]["id"] == "p1"


@pytest.mark.asyncio
async def test_escolher_a_parcela_mantem_a_tabela_de_transacoes(monkeypatch, grafo):
    """O outro lado da mesma pergunta: escolher a parcela não pode virar plano."""
    from app.graph import nodes

    async def plano_e_parcela(workspace_id, acoes, texto_cru, antecedente=None):
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
    assert '__interrupt__' in final  # seleção não é consentimento final
    assert 'EXECUTOU' not in final.get('results', [])
    final = await grafo.ainvoke(Command(resume=True), config=cfg)


    assert final["targets"][0]["table"] == "transactions"


PLANO_TV = {"id": "p1", "label": "Tudo (10x) — TV", "table": "installment_plans",
            "plan_installments": 10, "total_cents": 300000, "editaveis": 8,
            "travado_cents": 60000}


def _plano_found(monkeypatch):
    from app.graph import nodes

    async def plano_alvo(workspace_id, acoes, texto_cru, antecedente=None):
        return [{"table": "installment_plans", "status": "found",
                 "candidates": [dict(PLANO_TV)]} for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", plano_alvo)


def _valor(estado):
    pausa = estado["__interrupt__"][0]
    return getattr(pausa, "value", pausa)


@pytest.mark.asyncio
async def test_valor_em_plano_pergunta_a_unidade_e_so_depois_confirma(monkeypatch, grafo):
    """D2: "a TV é 2400" não diz se é o total ou cada parcela — e errar isso é o bug de
    R$ 24.000. A pergunta vem com botões e a escolha congela no ALVO."""
    _plano_found(monkeypatch)
    cfg = {"configurable": {"thread_id": "unidade-found"}}

    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_amount_cents": 240000}]),
        config=cfg,
    )
    pausa = _valor(estado)
    assert pausa["kind"] == "choice" and pausa["purpose"] == "amount_unit"
    assert {o["id"] for o in pausa["options"]} == {"unidade:total", "unidade:parcela"}
    # os dois números no corpo: o total pedido e o total se for por parcela
    assert "R$ 2.400,00" in pausa["summary"] and "R$ 19.800,00" in pausa["summary"]

    estado = await grafo.ainvoke(Command(resume={"approved": True, "candidate_id": "unidade:total"}), config=cfg)
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation"
    assert "total de" in pausa["summary"]
    assert "EXECUTOU" not in estado.get("results", [])

    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert final["approved"] is True
    assert final["targets"][0]["amount_unit"] == "total"
    assert "EXECUTOU" in final["results"]


@pytest.mark.asyncio
async def test_valor_em_plano_no_empate_escolhe_depois_unidade_depois_confirma(monkeypatch, grafo):
    from app.graph import nodes

    async def plano_e_parcela(workspace_id, acoes, texto_cru, antecedente=None):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [dict(PLANO_TV),
                                {"id": "tx1", "label": "TV (3/10)", "table": "transactions"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", plano_e_parcela)
    cfg = {"configurable": {"thread_id": "unidade-empate"}}

    await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_amount_cents": 30000}]),
        config=cfg,
    )
    estado = await grafo.ainvoke(Command(resume="p1"), config=cfg)
    assert _valor(estado)["purpose"] == "amount_unit"
    estado = await grafo.ainvoke(Command(resume="unidade:parcela"), config=cfg)
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation" and "por parcela" in pausa["summary"]
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert final["targets"][0]["table"] == "installment_plans"
    assert final["targets"][0]["amount_unit"] == "parcela"
    assert "EXECUTOU" in final["results"]


@pytest.mark.asyncio
async def test_resposta_fora_das_opcoes_da_unidade_nao_muda_nada(monkeypatch, grafo):
    """Pendência antiga do menu (`change_paid:`/`delete_plan:`, vive 10 min) cai aqui
    depois do deploy: o id não é uma das opções novas, então nada acontece."""
    _plano_found(monkeypatch)
    cfg = {"configurable": {"thread_id": "unidade-velha"}}
    await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_amount_cents": 240000}]),
        config=cfg,
    )
    final = await grafo.ainvoke(
        Command(resume={"approved": True, "candidate_id": "change_paid:p1"}), config=cfg
    )
    assert final["halted"] is True and final["approved"] is False
    assert "EXECUTOU" not in final.get("results", [])
    assert "não mudei nada" in " ".join(final["results"])


@pytest.mark.asyncio
async def test_pendencia_antiga_do_menu_numa_renomeacao_nao_executa(monkeypatch, grafo):
    _plano_found(monkeypatch)
    cfg = {"configurable": {"thread_id": "menu-velho"}}
    await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_description": "TV sala"}]),
        config=cfg,
    )
    final = await grafo.ainvoke(Command(resume="delete_plan:p1"), config=cfg)
    assert "EXECUTOU" not in final.get("results", [])
    assert final["approved"] is False


@pytest.mark.asyncio
async def test_renomear_plano_e_uma_confirmacao_so(monkeypatch, grafo):
    _plano_found(monkeypatch)
    cfg = {"configurable": {"thread_id": "renomear-plano"}}
    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_description": "TV sala"}]),
        config=cfg,
    )
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation" and "TV sala" in pausa["summary"]
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "__interrupt__" not in final
    assert "EXECUTOU" in final["results"]


@pytest.mark.asyncio
async def test_editar_sem_dizer_o_que_pergunta_sem_interrupt(monkeypatch, grafo):
    """"edite a TV" abria um menu de "mudar parcelas pagas / excluir o plano"."""
    _plano_found(monkeypatch)
    cfg = {"configurable": {"thread_id": "edite-a-tv"}}
    final = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv"}]), config=cfg
    )
    assert "__interrupt__" not in final
    assert final["halted"] is True
    assert "O que você quer mudar: o valor, o nome, a categoria ou a data? Ainda não mudei nada." in final["results"]


@pytest.mark.asyncio
async def test_data_de_compra_parcelada_nao_e_prometida(monkeypatch, grafo):
    _plano_found(monkeypatch)
    cfg = {"configurable": {"thread_id": "data-plano"}}
    final = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv",
                  "new_amount_cents": 30000, "new_occurred_at": "2026-10-01"}]),
        config=cfg,
    )
    assert "__interrupt__" not in final
    assert any("Editar a compra no app" in r for r in final["results"])

@pytest.mark.asyncio
async def test_data_de_plano_escolhido_no_empate_para_antes_do_sim(monkeypatch, grafo):
    from app.graph import nodes

    async def empate(workspace_id, acoes, texto_cru, antecedente=None):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [dict(PLANO_TV),
                                {"id": "tx1", "label": "TV (3/10)", "table": "transactions"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", empate)
    cfg = {"configurable": {"thread_id": "data-empate"}}
    await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv",
                  "new_occurred_at": "2026-10-01"}]),
        config=cfg,
    )
    final = await grafo.ainvoke(Command(resume="p1"), config=cfg)
    assert "__interrupt__" not in final
    assert any("Editar a compra no app" in r for r in final["results"])


def _snapshot(*linhas):
    cand = {**PLANO_TV, "label": "parcela 3 — TV",
            "installment_snapshot": {"version": 2, "rows": list(linhas), "total_cents": 0}}
    return {"table": "installment_plans", "status": "found", "candidates": [cand]}


def _alvo_fixo(monkeypatch, alvo):
    from app.graph import nodes

    async def fixo(workspace_id, acoes, texto_cru, antecedente=None):
        return [dict(alvo) for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", fixo)


@pytest.mark.asyncio
async def test_varias_parcelas_do_snapshot_recusam_antes_do_sim(monkeypatch, grafo):
    _alvo_fixo(monkeypatch, _snapshot({"id": "a", "installment_no": 1, "travada": False},
                                      {"id": "b", "installment_no": 2, "travada": False}))
    final = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_amount_cents": 30000}]),
        config={"configurable": {"thread_id": "snap-varias"}},
    )
    assert "__interrupt__" not in final
    assert "Consigo corrigir a compra inteira (as parcelas em aberto) ou uma parcela por vez." in final["results"]


@pytest.mark.asyncio
async def test_parcela_travada_nao_muda_valor_antes_do_sim(monkeypatch, grafo):
    _alvo_fixo(monkeypatch, _snapshot({"id": "a", "installment_no": 3, "travada": True}))
    final = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_amount_cents": 30000}]),
        config={"configurable": {"thread_id": "snap-travada"}},
    )
    assert "__interrupt__" not in final
    assert any("não mudam mais" in r for r in final["results"])


@pytest.mark.asyncio
async def test_parcela_travada_ainda_muda_de_nome(monkeypatch, grafo):
    _alvo_fixo(monkeypatch, _snapshot({"id": "a", "installment_no": 3, "travada": True}))
    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_description": "TV sala"}]),
        config={"configurable": {"thread_id": "snap-travada-nome"}},
    )
    assert _valor(estado)["kind"] == "confirmation"


@pytest.mark.asyncio
async def test_conta_de_plano_inteiro_recusa_antes_do_sim(monkeypatch, grafo):
    _plano_found(monkeypatch)
    final = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv", "new_account": "Inter"}]),
        config={"configurable": {"thread_id": "conta-plano"}},
    )
    assert "__interrupt__" not in final
    assert any("A conta de uma compra parcelada muda em Editar a compra no app" in r
               for r in final["results"])


@pytest.mark.asyncio
@pytest.mark.parametrize("campos", [
    {"installment_scope": "range:3:3"},
    {"current_installment": 3},
])
async def test_muda_a_3a_parcela_corrige_so_aquela_linha(monkeypatch, grafo, campos):
    """Pelo resolvedor DE VERDADE: `for_actions → _bounded_plan_target → gate`."""
    from app import db
    from app.graph import nodes

    monkeypatch.setattr(nodes.resolve, "for_actions", _for_actions_real)
    consultas = []

    async def fetch(query, *args):
        consultas.append(query)
        if "from public.installment_plans p" in query:
            return [{"id": "p1", "description": "TV", "merchant": None, "total_cents": 300000,
                     "installments": 10, "first_occurred_at": "2026-05-15",
                     "editaveis": 8, "travado_cents": 60000}]
        if "installment_plan_id = %s" in query:
            return [{"id": f"tx{n}", "installment_no": n, "amount_cents": 30000,
                     "occurred_at": f"2026-{n + 4:02d}-15", "status": "pending",
                     "paid_at": None, "account_id": None, "invoice_id": None,
                     "account_name": None, "travada": False} for n in range(1, 11)]
        return []

    monkeypatch.setattr(db, "fetch", fetch)
    cfg = {"configurable": {"thread_id": f"terceira-{sorted(campos)[0]}"}}
    estado = await grafo.ainvoke(
        _estado([{"type": "update_transaction", "description": "tv",
                  "new_amount_cents": 30000, **campos}])
        | {"text": "muda a 3ª parcela da TV para 300"},
        config=cfg,
    )
    pausa = _valor(estado)
    assert pausa["kind"] == "confirmation"
    assert "parcela 3" in pausa["summary"] and "R$ 300,00" in pausa["summary"]
    assert "total da compra" not in pausa["summary"]
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    linhas = final["targets"][0]["candidates"][0]["installment_snapshot"]["rows"]
    assert [r["id"] for r in linhas] == ["tx3"]
    assert "EXECUTOU" in final["results"]
    assert any("parcela_travada" in q for q in consultas)


@pytest.mark.asyncio
async def test_o_antecedente_atravessa_DOIS_turnos_no_grafo_de_verdade(monkeypatch, grafo):
    """O que a conversa escreveu no turno 1 chega ao resolvedor no turno 2.

    Este é o teste que sustenta o desenho inteiro do `last_write_id`: testar o
    reducer isolado prova que a FUNÇÃO preserva, não que o LangGraph a APLICA
    entre dois `ainvoke` no mesmo thread. Se o checkpoint não mesclasse o estado,
    "apague esse lançamento" voltaria a listar os nove mais recentes e nenhum
    outro teste perceberia.

    O worker manda `last_write_id: ""` a cada turno (é o que `test_state_reset`
    exige de toda chave); `""` significa "não escrevi neste turno" e o reducer
    preserva o que já havia.
    """
    from app.graph import nodes

    CAFE = "11111111-1111-4111-8111-111111111111"

    async def executar_falso(state, indexadas):
        # devolve a 4ª posição: os ids escritos no turno
        return ["💸 Gasto de R$ 20,00."], None, None, [CAFE]

    monkeypatch.setattr(nodes, "_executar", executar_falso)

    vistos: list[str | None] = []

    async def alvos_espiao(workspace_id, acoes, texto_cru, antecedente=None):
        vistos.append(antecedente)
        return [{"table": "transactions", "status": "found",
                 "candidates": [{"id": CAFE, "label": "gasto de R$ 20,00 (café)"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos_espiao)

    cfg = {"configurable": {"thread_id": "antecedente-2-turnos"}}

    # turno 1: "gastei 20 no café" — cria, e deixa o rastro
    await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value,
                  "amount_cents": 2000, "category": "café"}]) | {"last_write_id": ""},
        config=cfg,
    )
    # `create_expense` não mira registro existente, então `alvos` nem consulta:
    # o rastro do turno 1 é o que o executor gravou, não uma resolução.
    assert vistos == [], "criar um gasto não devia resolver alvo nenhum"

    # turno 2, MESMO thread: "apague esse lançamento"
    await grafo.ainvoke(
        _estado([{"type": FinanceActionType.DELETE_TRANSACTION.value,
                  "description": "esse lançamento"}]) | {"last_write_id": ""},
        config=cfg,
    )
    assert vistos == [CAFE], (
        f"o antecedente não sobreviveu ao turno: {vistos!r}. "
        "Sem isso, 'apague esse lançamento' volta a listar os 9 mais recentes."
    )


# ---------------------------------------------------------------------------
# Par de substituição (apagar/corrigir + criar) é ATÔMICO — D3, 21/09/2026
# ---------------------------------------------------------------------------
# O incidente (staging, 21/09): "Comprei wardogs por 104,99" e depois "Na verdade
# eu comprei em 2x no cartao". O modelo devolveu [apagar wardogs, criar 2x sem
# valor]; a criação ficou incompleta, o gate perguntou SÓ o apagar, o usuário
# disse sim, a compra sumiu e a nova nunca nasceu.

_WARDOGS = [
    {"type": FinanceActionType.DELETE_TRANSACTION.value, "description": "wardogs"},
    {"type": FinanceActionType.CREATE_INSTALLMENT_PURCHASE.value, "installments": 2,
     "amount_cents": None, "account": "cartao", "description": "wardogs"},
]


def _alvo_wardogs(monkeypatch, contas=None):
    from app.graph import nodes

    async def alvos(workspace_id, acoes, texto_cru, antecedente=None):
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-w", "label": "gasto de R$ 104,99 em *wardogs*"}]}
            if a.type in _r.TARGETS else {}
            for a in acoes
        ]

    async def sem_banco(workspace_id, acoes, alvos, pular=None):
        return alvos

    async def sem_cartao(*a, **k):
        return None  # sem cartão resolvido, o aviso de limite não consulta o banco

    from app.tools import finance

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos)
    monkeypatch.setattr(nodes.resolve, "contas_citadas", contas or sem_banco)
    monkeypatch.setattr(finance, "resolve_account", sem_cartao)


@pytest.mark.asyncio
async def test_replay_do_incidente_wardogs_nao_apaga_nem_guarda_rascunho(monkeypatch, grafo):
    _alvo_wardogs(monkeypatch)
    estado = await grafo.ainvoke(
        _estado(_WARDOGS) | {"text": "Na verdade eu comprei em 2x no cartao"},
        config={"configurable": {"thread_id": "wardogs-1"}},
    )

    assert "__interrupt__" not in estado
    assert estado["draft"] == {}
    assert "EXECUTOU" not in estado.get("results", [])
    assert "Me manda de novo com o valor. Ainda não apaguei nem criei nada." in estado["reply"]
    # a pergunta do valor aparece UMA vez (já vinha do `alvos`)
    assert estado["reply"].count("faltou o valor") == 1, estado["reply"]

    # e o worker não grava rascunho: é o rascunho que transformava a compra
    # num beco depois do apagar ter acontecido
    from app import conversation

    async def nao_pode(**kwargs):
        raise AssertionError("save_draft chamado num par de substituição")

    async def nada(*a, **k):
        return None

    monkeypatch.setattr(conversation.db, "save_draft", nao_pode)
    monkeypatch.setattr(conversation.db, "delete_draft", nada)
    sessao = {"id": "s1", "phone": "5551999999999", "user_id": "u1", "workspace_id": "w1"}
    await conversation._resposta_do_estado(sessao, estado, "wardogs-1")


@pytest.mark.asyncio
async def test_par_com_cartao_que_nao_existe_tambem_nao_guarda_rascunho(monkeypatch, grafo):
    async def cartao_inexistente(workspace_id, acoes, alvos, pular=None):
        erro = "💳 Não achei o cartão *itau*. Qual deles?"
        return [a if i != 1 else {"correction_error": erro, "account_error": erro}
                for i, a in enumerate(alvos)]

    _alvo_wardogs(monkeypatch, cartao_inexistente)
    acoes = [dict(_WARDOGS[0]), {**_WARDOGS[1], "amount_cents": 10499, "account": "itau"}]
    estado = await grafo.ainvoke(
        _estado(acoes), config={"configurable": {"thread_id": "wardogs-2"}},
    )

    assert "__interrupt__" not in estado
    assert estado["draft"] == {}
    assert "EXECUTOU" not in estado.get("results", [])
    assert "Não achei o cartão *itau*" in estado["reply"]
    # M1: sem rascunho a pergunta "qual deles?" não tem resposta — diz como seguir
    assert "Me manda de novo dizendo o cartão. Ainda não apaguei nem criei nada." in estado["reply"]


@pytest.mark.asyncio
async def test_par_completo_pergunta_UMA_vez_e_o_sim_executa_as_duas(monkeypatch, grafo):
    _alvo_wardogs(monkeypatch)
    acoes = [dict(_WARDOGS[0]), {**_WARDOGS[1], "amount_cents": 10499}]
    cfg = {"configurable": {"thread_id": "wardogs-3"}}
    estado = await grafo.ainvoke(_estado(acoes), config=cfg)

    valor = getattr(estado["__interrupt__"][0], "value", estado["__interrupt__"][0])
    assert len(valor["items"]) == 2, valor["items"]
    assert "EXECUTOU" not in estado.get("results", [])

    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "__interrupt__" not in final
    assert final["results"].count("EXECUTOU") == 2, final["results"]


@pytest.mark.asyncio
async def test_par_com_alvo_ambiguo_a_confirmacao_lista_tambem_a_criacao(monkeypatch, grafo):
    """`_confirm_selection` filtrava por `needs_confirmation`: o gasto de R$ 45
    ficaria fora da frase e seria gravado pelo mesmo SIM sem ter sido lido."""
    from app.graph import nodes

    async def dois(workspace_id, acoes, texto_cru, antecedente=None):
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "ambiguous",
             "candidates": [{"id": "a", "label": "R$ 45"}, {"id": "b", "label": "R$ 80"}]}
            if a.type in _r.TARGETS else {}
            for a in acoes
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois)
    cfg = {"configurable": {"thread_id": "wardogs-4"}}
    await grafo.ainvoke(
        _estado([
            {"type": "delete_transaction"},
            {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"},
        ]),
        config=cfg,
    )
    estado = await grafo.ainvoke(Command(resume="b"), config=cfg)
    valor = getattr(estado["__interrupt__"][0], "value", estado["__interrupt__"][0])
    assert len(valor["items"]) == 2, valor["items"]
    assert "EXECUTOU" not in estado.get("results", [])


@pytest.mark.asyncio
async def test_dois_gastos_sem_mutacao_seguem_como_antes(monkeypatch, grafo):
    """Sem registro existente em jogo não há par: o completo grava, o incompleto
    vira rascunho — o comportamento de sempre."""
    _alvo_wardogs(monkeypatch)
    estado = await grafo.ainvoke(
        _estado([
            {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"},
            {"type": FinanceActionType.CREATE_EXPENSE.value, "category": "uber"},
        ]),
        config={"configurable": {"thread_id": "dois-gastos"}},
    )
    assert "__interrupt__" not in estado
    assert "EXECUTOU" in estado.get("results", [])
    assert estado["draft"].get("slot") == "amount"


@pytest.mark.asyncio
async def test_par_trocar_de_cartao_no_aviso_de_limite_nao_monta_rascunho(monkeypatch, grafo):
    _alvo_wardogs(monkeypatch)
    from app.tools import finance

    async def cartao(*a, **k):
        return "acc-1"

    async def estourado(*a, **k):
        return {"excedeu": True, "card_name": "Nubank", "limite_centavos": 10000,
                "disponivel_centavos": 5000}

    monkeypatch.setattr(finance, "resolve_account", cartao)
    monkeypatch.setattr(finance, "verificar_limite_disponivel", estourado)
    acoes = [dict(_WARDOGS[0]), {**_WARDOGS[1], "amount_cents": 10499}]
    cfg = {"configurable": {"thread_id": "wardogs-5"}}
    estado = await grafo.ainvoke(_estado(acoes), config=cfg)
    valor = getattr(estado["__interrupt__"][0], "value", estado["__interrupt__"][0])
    assert valor["kind"] == "soft_warning"

    final = await grafo.ainvoke(Command(resume={"candidate_id": "change_card"}), config=cfg)
    assert "__interrupt__" not in final
    assert final["draft"] == {}
    assert "EXECUTOU" not in final.get("results", [])
    assert "Ainda não apaguei nem criei nada." in final["reply"]
