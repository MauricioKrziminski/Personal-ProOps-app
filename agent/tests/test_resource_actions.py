from datetime import UTC, datetime

import pytest
from app.graph.schemas import ResourceAction, ResourceActionType, ResourceField
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error
from app.graph.policy import needs_confirmation


def action(resource="cards", kind="resource_create", **values):
    return ResourceAction(
        type=kind,
        resource=resource,
        name="Nubank",
        fields=[
            ResourceField(name=k, value=str(v) if v is not None else None)
            for k, v in values.items()
        ],
    )


def ctx():
    return ExecContext(
        "user", "workspace", None, "America/Sao_Paulo", "cria cartão", "app:1"
    )


@pytest.mark.asyncio
async def test_card_requires_cycle_before_confirmation(monkeypatch):
    async def empty(*a):
        return []

    monkeypatch.setattr(resources.db, "fetch", empty)
    with pytest.raises(Level1Error, match="fechamento"):
        await resources.prepare(ctx(), action())


@pytest.mark.asyncio
async def test_card_validates_explicit_cycle_and_scopes(monkeypatch):
    async def empty(*a):
        return []

    monkeypatch.setattr(resources.db, "fetch", empty)
    prepared = await resources.prepare(
        ctx(), action(closing_day=5, due_day=12, credit_limit_cents=2000000)
    )
    assert prepared["values"]["type"] == "credit_card"
    assert prepared["values"]["closing_day"] == 5
    assert "20.000" in prepared["summary"]
    assert needs_confirmation(action(), 1.0)


@pytest.mark.asyncio
async def test_arbitrary_columns_never_reach_database(monkeypatch):
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), action(workspace_id="foreign"))


@pytest.mark.asyncio
async def test_card_cycle_out_of_range_rejected():
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), action(closing_day=32, due_day=12))


@pytest.mark.asyncio
async def test_resource_enum_all_dispatches():
    from app.tools.registry import _tool

    for kind in ResourceActionType:
        assert _tool(action(kind=kind)) is not None


@pytest.mark.asyncio
async def test_payer_from_other_workspace_is_not_resolved(monkeypatch):
    queries = []

    async def fetch(sql, *args):
        queries.append((sql, args))
        return []

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error):
        await resources.prepare(
            ctx(), action(closing_day=5, due_day=12, payment_account_id="foreign-id")
        )
    assert any("workspace_id" in sql and "workspace" in args for sql, args in queries)


@pytest.mark.asyncio
async def test_create_card_graph_waits_for_final_confirmation(monkeypatch):
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command
    from app.graph import build as graph_module
    from app.graph.schemas import ResourcePlan
    from app.graph import nodes
    import importlib

    async def route(_):
        return {"domains": ["cadastros"], "confidence": 1.0}

    async def fetch(*a):
        return []

    writes = []

    async def one(sql, *args):
        writes.append((sql, args))
        return {"id": "new-id"}

    async def reserve(*a, **k):
        return True

    async def confirmed(*a):
        pass

    class Model:
        async def ainvoke(self, _):
            return ResourcePlan(actions=[action(closing_day=5, due_day=12)])

    monkeypatch.setattr(nodes, "route", route)
    monkeypatch.setattr(nodes.gemini, "structured", lambda *a: Model())
    monkeypatch.setattr(resources.db, "fetch", fetch)
    monkeypatch.setattr(resources.db, "fetch_one", one)
    monkeypatch.setattr(resources.db, "reserve_execution", reserve)
    monkeypatch.setattr(resources.db, "confirm_execution", confirmed)
    importlib.reload(graph_module)
    graph = graph_module.build(InMemorySaver())
    config = {"configurable": {"thread_id": "resource"}}
    first = await graph.ainvoke(
        {
            "workspace_id": "workspace",
            "user_id": "user",
            "phone": None,
            "timezone": "America/Sao_Paulo",
            "text": "cria cartão Nubank fecha 5 vence 12",
            "source_message_id": "app:1",
            "results": [],
        },
        config,
    )
    assert not writes
    assert "fechamento: 5" in first["__interrupt__"][0].value["summary"]
    result = await graph.ainvoke(Command(resume=True), config)
    assert len(writes) == 1
    assert "workspace" in writes[0][1] and "credit_card" in writes[0][1]
    assert "Concluído" in result["reply"]


@pytest.mark.asyncio
async def test_snapshot_change_blocks_update(monkeypatch):
    async def fetch(*a):
        return [{"id": "x", "row_version": "12", "name": "Nubank", "type": "checking"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    a = action("accounts", "resource_update", initial_balance_cents=500)
    context = ctx()
    context.target = {"prepared": await resources.prepare(context, a)}
    queries = []

    async def one(sql, *args):
        queries.append(sql)
        return None

    monkeypatch.setattr(resources.db, "fetch_one", one)
    with pytest.raises(Level1Error, match="mudou"):
        await resources.execute(context, a)
    assert "xmin::text = %s" in queries[0] and "workspace_id = %s" in queries[0]


@pytest.mark.asyncio
async def test_invalid_schedule_is_not_replaced_by_now():
    a = action("reminders", title="teste", next_run_at="not-a-date")
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), a)


def test_resource_schema_budget_and_draft_lifecycle():
    from app.graph.state import _resource_draft

    assert len(ResourceAction.model_fields) * len(ResourceActionType) <= 198
    assert _resource_draft([{"inert": True}], None) == [{"inert": True}]
    assert _resource_draft([{"inert": True}], []) == []


def test_nested_schema_preserves_server_bound_without_gemini_maxitems_product():
    from pydantic import ValidationError
    from app.graph.schemas import ResourcePlan

    schema = ResourcePlan.model_json_schema()
    assert "maxItems" not in schema["$defs"]["ResourceAction"]["properties"]["fields"]
    with pytest.raises(ValidationError, match="20 campos"):
        ResourceAction(
            type="resource_create",
            resource="cards",
            fields=[ResourceField(name="name", value="Nubank")] * 21,
        )
    with pytest.raises(ValidationError):
        ResourcePlan(actions=[action()] * 11)


@pytest.mark.asyncio
async def test_debt_payment_freezes_contract_and_uses_amortization_rpc(monkeypatch):
    async def fetch(sql, *args):
        if "public.debts" in sql:
            return [
                {
                    "id": "debt",
                    "row_version": "3",
                    "name": "Carro",
                    "account_id": "bank",
                    "principal_cents": 6000000,
                    "remaining_cents": 5000000,
                    "archived": False,
                }
            ]
        return [{"id": "bank", "name": "Conta corrente", "type": "checking"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    a = action("debts", "resource_pay", amount_cents=147000, paid_at="2026-09-08")
    context = ctx()
    proposal = await resources.prepare(context, a)
    assert "Conta corrente" in proposal["summary"] and "1.470" in proposal["summary"]
    assert needs_confirmation(a, 1.0)
    context.target = {"prepared": proposal}
    queries = []

    async def one(sql, *args):
        queries.append((sql, args))
        return {"remaining_cents": 4903000}

    monkeypatch.setattr(resources.db, "fetch_one", one)
    result = await resources.execute(context, a)
    assert "49.030" in result.message
    sql, args = queries[0]
    assert (
        "materialized" in sql and "for update" in sql and "pay_debt_installment" in sql
    )
    assert "workspace" in args and "3" in args
    assert "linked.type" in sql and "not linked.archived" in sql


@pytest.mark.asyncio
async def test_debt_payment_requires_amount_and_account(monkeypatch):
    async def fetch(*args):
        return [{"id": "debt", "row_version": "3", "name": "Carro", "account_id": None}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error, match="valor da prestação"):
        await resources.prepare(ctx(), action("debts", "resource_pay"))
    with pytest.raises(Level1Error, match="Qual conta"):
        await resources.prepare(
            ctx(), action("debts", "resource_pay", amount_cents=147000)
        )


# --- a pergunta pendente: o que o usuário responde tem que ENTRAR -----------


def _no_state(text, resource_draft=None):
    return {
        "user_id": "user", "workspace_id": "workspace", "phone": None,
        "timezone": "America/Sao_Paulo", "text": text, "source_message_id": "app:1",
        "messages": [], "results": [], "resource_draft": resource_draft or [],
    }


def _stub_incomplete(monkeypatch, capturado=None):
    """Modelo que devolve sempre um cartão sem ciclo — a Level1Error é o alvo."""
    from app.graph import nodes
    from app.graph.schemas import ResourcePlan

    async def sem_banco(sql, *a, **kw):
        return []

    monkeypatch.setattr(resources.db, "fetch", sem_banco)

    class Modelo:
        async def ainvoke(self, mensagens):
            if capturado is not None:
                capturado.append(mensagens)
            return ResourcePlan(actions=[action()])

    monkeypatch.setattr(nodes.gemini, "structured", lambda *a, **kw: Modelo())
    return nodes


@pytest.mark.asyncio
async def test_pergunta_pendente_viaja_com_o_cadastro(monkeypatch):
    """Sem a pergunta junto, o turno seguinte não sabe o que foi perguntado.

    O modelo re-extraía a mensagem inteira do zero, e um "8" solto não é
    instrução de cadastro nenhuma — a resposta certa à pergunta certa não
    preenchia campo nenhum.
    """
    nodes = _stub_incomplete(monkeypatch)
    saida = await nodes.resource_node(_no_state("cadastra o cartão Nubank"))
    assert saida["resource_draft"][0]["_pergunta"] == saida["results"][0]


@pytest.mark.asyncio
async def test_a_pergunta_chega_ao_modelo_no_turno_seguinte(monkeypatch):
    capturado = []
    nodes = _stub_incomplete(monkeypatch, capturado)
    pendente = [{"type": "resource_create", "resource": "cards", "name": "Nubank",
                 "fields": [], "_pergunta": "Informe dia de fechamento."}]
    await nodes.resource_node(_no_state("dia 7", pendente))
    humano = capturado[0][-1][1]
    assert "Você perguntou ao usuário: Informe dia de fechamento." in humano
    assert "RESPOSTA" in humano


@pytest.mark.asyncio
async def test_mesma_pergunta_duas_vezes_nao_repete_a_frase_identica(monkeypatch):
    """Repetir a frase igual é o que faz o agente parecer surdo.

    O usuário respondeu, não entrou, e nada na tela dizia isso nem como sair.
    """
    nodes = _stub_incomplete(monkeypatch)
    primeiro = await nodes.resource_node(_no_state("cadastra o cartão Nubank"))
    pergunta = primeiro["results"][0]

    segundo = await nodes.resource_node(_no_state("sei lá", primeiro["resource_draft"]))
    assert segundo["results"][0] != pergunta
    assert "Não consegui tirar esse dado" in segundo["results"][0]
    assert "cancela" in segundo["results"][0]
    assert pergunta in segundo["results"][0]  # a pergunta continua lá


@pytest.mark.asyncio
async def test_turno_sem_texto_nao_conta_como_resposta_ignorada(monkeypatch):
    """Anexo ou clique sem texto não é o usuário falhando em responder."""
    nodes = _stub_incomplete(monkeypatch)
    primeiro = await nodes.resource_node(_no_state("cadastra o cartão Nubank"))
    segundo = await nodes.resource_node(_no_state("   ", primeiro["resource_draft"]))
    assert segundo["results"][0] == primeiro["results"][0]


# --- paridade com o app: conta padrão e lixeira de notas --------------------
#
# As três são o que o usuário faz com o dedo (`useSetDefaultAccount`,
# `useRestoreNote`, `usePurgeNote`) e o agente não alcançava. Nenhuma custou
# schema: `is_default` e `trashed` são campos VIRTUAIS validados pelo catálogo,
# e `ResourceAction` continua em 5×5.


def _linha(**extra):
    return {"id": "11111111-1111-1111-1111-111111111111", "row_version": "42", **extra}


@pytest.mark.asyncio
async def test_conta_padrao_sai_de_values_e_escreve_no_workspace(monkeypatch):
    async def fetch(*a):
        return [_linha(name="Nubank", type="checking", archived=False)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    acao = action(resource="accounts", kind="resource_update", is_default="true")
    prepared = await resources.prepare(ctx(), acao)

    # `is_default` não é coluna de `accounts`: se sobrasse aqui, o UPDATE de
    # `execute` viraria `set is_default = ...` numa coluna inexistente.
    assert "is_default" not in prepared["values"]
    assert prepared["set_default"] is True
    assert needs_confirmation(acao, 1.0)

    escritas = []

    async def fetch_one(sql, *args):
        escritas.append((sql, args))
        return {"id": prepared["id"]}

    async def execute(sql, *args):
        escritas.append((sql, args))

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resources.db, "execute", execute)
    await resources.execute(
        ExecContext(
            "user", "workspace", None, "America/Sao_Paulo", "", "app:1",
            target={"prepared": prepared},
        ),
        acao,
    )
    # sem coluna a mexer, o SELECT existe só pelo xmin; a escrita é em workspaces
    assert "select id from public.accounts" in escritas[0][0]
    assert "workspaces set default_account_id" in escritas[1][0]


@pytest.mark.asyncio
async def test_restaurar_nota_procura_na_lixeira_e_zera_deleted_at(monkeypatch):
    consultas = []

    async def fetch(sql, *a):
        consultas.append(sql)
        return [_linha(content="lista de compras", deleted_at="2026-09-01T00:00:00Z")]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(
        ctx(), action(resource="notes", kind="resource_update", trashed="false")
    )
    # sem inverter o filtro, a nota apagada era inalcançável e o erro dizia
    # "não encontrei" sobre uma nota que existe
    assert "deleted_at is not null" in consultas[0]
    assert prepared["values"] == {"deleted_at": None}


@pytest.mark.asyncio
async def test_apagar_de_vez_so_vale_para_nota_ja_na_lixeira(monkeypatch):
    async def na_lixeira(*a):
        return [_linha(content="rascunho", deleted_at="2026-09-01T00:00:00Z")]

    monkeypatch.setattr(resources.db, "fetch", na_lixeira)
    prepared = await resources.prepare(
        ctx(), action(resource="notes", kind="resource_delete", trashed="true")
    )
    # values vazio é o que faz `execute` apagar a linha em vez de regravar deleted_at
    assert prepared["values"] == {}
    assert "DE VEZ" in prepared["summary"]

    async def viva(*a):
        return [_linha(content="rascunho", deleted_at=None)]

    monkeypatch.setattr(resources.db, "fetch", viva)
    prepared = await resources.prepare(ctx(), action(resource="notes", kind="resource_delete"))
    assert prepared["values"] == {"deleted_at": prepared["values"]["deleted_at"]}
    assert "lixeira" in prepared["summary"]


@pytest.mark.asyncio
async def test_editar_recorrencia_propaga_pelas_futuras(monkeypatch):
    """Mudar o valor da série tem que alcançar o que já foi materializado.

    O UPDATE genérico mexeria só na regra, e o `finance-scheduler` não reescreve o que já
    existe (unique `recurring_id, occurred_at`): os próximos três meses ficariam no valor
    velho e o quarto no novo. Cai na MESMA RPC do botão do app.
    """
    async def fetch(*a):
        return [_linha(kind="expense", amount_cents=150000, description="Aluguel",
                       category="moradia", account_id=None, rrule="FREQ=MONTHLY;BYMONTHDAY=5",
                       dtstart="2026-01-05T09:00:00Z", auto_confirm=True, active=True)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    acao = action(resource="recurring", kind="resource_update", amount_cents=160000)
    prepared = await resources.prepare(ctx(), acao)

    sqls = []

    async def fetch_one(sql, *args):
        sqls.append(sql)
        return {"futuras": 2}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    await resources.execute(
        ExecContext("user", "workspace", None, "America/Sao_Paulo", "", "app:1",
                    target={"prepared": prepared}),
        acao,
    )
    assert any("update_recurring_series" in s for s in sqls), sqls
    assert not any(s.startswith("update public.recurring_transactions set") for s in sqls)


@pytest.mark.asyncio
async def test_mudar_o_dia_da_serie_vai_pela_rpc_com_o_proximo_vencimento(monkeypatch):
    """Regra nova pelo UPDATE cru deixava o calendário velho materializado por um ano.

    Pela RPC (`20260926120000`) ela vai com o PRÓXIMO vencimento, e a RPC refaz as futuras.
    """
    import json

    async def fetch(*a):
        return [_linha(kind="expense", amount_cents=150000, description="Aluguel",
                       category="moradia", account_id=None, rrule="FREQ=MONTHLY;BYMONTHDAY=5",
                       dtstart="2026-01-05T09:00:00Z", auto_confirm=True, active=True)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    acao = action(resource="recurring", kind="resource_update", rrule="FREQ=MONTHLY;BYMONTHDAY=-1")
    prepared = await resources.prepare(ctx(), acao)

    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((sql, args))
        if sql.startswith("select rrule, dtstart"):
            return {"rrule": "FREQ=MONTHLY;BYMONTHDAY=5",
                    "dtstart": datetime(2026, 1, 5, 12, 0, tzinfo=UTC)}
        return {"futuras": 0}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    await resources.execute(
        ExecContext("user", "workspace", None, "America/Sao_Paulo", "", "app:1",
                    target={"prepared": prepared}),
        acao,
    )
    rpc = [args for sql, args in chamadas if "update_recurring_series" in sql]
    assert rpc, chamadas
    patch = json.loads(rpc[0][1])
    assert patch["rrule"] == "FREQ=MONTHLY;BYMONTHDAY=-1"
    assert datetime.fromisoformat(patch["next_run_at"]) > datetime.now(UTC)
    assert not any(sql.startswith("update public.recurring_transactions set") for sql, _ in chamadas)


@pytest.mark.asyncio
async def test_pausar_serie_nao_passa_pela_rpc(monkeypatch):
    """`active` não é campo propagável: pausar não reescreve ocorrência nenhuma."""
    async def fetch(*a):
        return [_linha(kind="expense", amount_cents=150000, description="Aluguel",
                       category="moradia", account_id=None, rrule="FREQ=MONTHLY;BYMONTHDAY=5",
                       dtstart="2026-01-05T09:00:00Z", auto_confirm=True, active=True)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    acao = action(resource="recurring", kind="resource_update", active="false")
    prepared = await resources.prepare(ctx(), acao)

    sqls = []

    async def fetch_one(sql, *args):
        sqls.append(sql)
        return {"id": prepared["id"]}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    await resources.execute(
        ExecContext("user", "workspace", None, "America/Sao_Paulo", "", "app:1",
                    target={"prepared": prepared}),
        acao,
    )
    assert not any("update_recurring_series" in s for s in sqls), sqls


@pytest.mark.asyncio
async def test_apagar_serie_avisa_que_o_futuro_sai_junto(monkeypatch):
    """
    A frase da confirmação é o que a pessoa lê ANTES de aprovar, e ela dizia
    "registros já gerados continuam no histórico".

    Desde o trigger `recurring_drop_future` (`20260909090000`) isso é mentira para série:
    as ocorrências futuras ainda em aberto saem junto. Aprovar uma exclusão com a promessa
    errada na tela é o pior jeito de essa mudança chegar no usuário.
    """
    async def fetch(*a):
        return [_linha(kind="expense", amount_cents=150000, description="Aluguel",
                       category="moradia", account_id=None, rrule="FREQ=MONTHLY;BYMONTHDAY=5",
                       dtstart="2026-01-05T09:00:00Z", auto_confirm=True, active=True)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(
        ctx(), action(resource="recurring", kind="resource_delete")
    )
    resumo = prepared["summary"]
    assert "futuras" in resumo, resumo
    assert "registros já gerados continuam no histórico" not in resumo, resumo


@pytest.mark.asyncio
async def test_apagar_lembrete_nao_herda_o_aviso_da_serie(monkeypatch):
    """Lembrete não materializa lançamento: para ele a frase antiga continua verdadeira."""
    async def fetch(*a):
        return [_linha(title="Pagar aluguel", rrule="FREQ=MONTHLY;BYMONTHDAY=5",
                       due_at="2026-10-05T09:00:00Z", done=False)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(
        ctx(), action(resource="reminders", kind="resource_delete")
    )
    assert "registros já gerados continuam no histórico" in prepared["summary"]


# --- organizar nota e pasta: fixar, cor, arquivar, tag, ícone ---------------
#
# A tela de Notas ganhou pin, cor, arquivar, tag de pasta e ícone
# (`20260914180000`); o agente faz tudo que o dedo faz, então cada um deles é
# campo do catálogo. Nenhum custou schema: `ResourceAction.resource` é `str`, e
# `color`/`icon` entram como valores permitidos no PROMPT, não no schema.


def nota(nome="mercado", kind="resource_update", **values):
    a = action(resource="notes", kind=kind, **values)
    a.name = nome
    return a


def pasta(nome="trabalho", kind="resource_update", **values):
    a = action(resource="folders", kind=kind, **values)
    a.name = nome
    return a


@pytest.mark.asyncio
async def test_fixar_nota_acha_pelo_trecho_e_nao_pelo_texto_inteiro(monkeypatch):
    """A busca exata deixava metade do catálogo inalcançável por voz."""
    consultas = []

    async def fetch(sql, *args):
        consultas.append((sql, args))
        # a primeira é a busca EXATA pelo texto inteiro e não acha nada
        if "ilike" not in sql:
            return []
        return [_linha(content="lista do mercado\nleite, ovos", deleted_at=None)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(ctx(), nota(pinned="true"))
    assert prepared["values"] == {"pinned": True}
    assert "ilike" in consultas[-1][0]
    assert consultas[-1][1][1] == "%mercado%"


@pytest.mark.asyncio
async def test_duas_notas_parecidas_perguntam_qual_com_a_lista(monkeypatch):
    """Empate PERGUNTA — e a pergunta mostra o que existe, senão é adivinhação."""

    async def fetch(sql, *a):
        if "ilike" not in sql:
            return []
        return [
            _linha(content="lista do mercado\nleite"),
            _linha(content="mercado da esquina fecha 22h"),
        ]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error) as erro:
        await resources.prepare(ctx(), nota(pinned="true"))
    mensagem = erro.value.mensagem_usuario
    assert "Achei 2 notas" in mensagem
    assert "lista do mercado" in mensagem and "mercado da esquina" in mensagem
    assert "Nada foi alterado" in mensagem


@pytest.mark.asyncio
async def test_cor_aceita_a_palavra_do_dia_a_dia(monkeypatch):
    async def fetch(*a):
        return [_linha(content="reunião de segunda")]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(ctx(), nota(color="azul"))
    assert prepared["values"] == {"color": "oceano"}

    prepared = await resources.prepare(ctx(), nota(color="sem cor"))
    assert prepared["values"] == {"color": None}

    with pytest.raises(Level1Error, match="Tipo inválido para cor"):
        await resources.prepare(ctx(), nota(color="#ff0000"))


@pytest.mark.asyncio
async def test_arquivar_nota_vira_timestamp_e_meta_continua_booleana(monkeypatch):
    async def fetch(*a):
        return [_linha(content="reunião", name="viagem", archived=False)]

    monkeypatch.setattr(resources.db, "fetch", fetch)

    arquivada = await resources.prepare(ctx(), nota(archived="true"))
    assert set(arquivada["values"]) == {"archived_at"}
    assert arquivada["values"]["archived_at"] is not None
    assert "arquivada: sim" in arquivada["summary"]

    devolvida = await resources.prepare(ctx(), nota(archived="false"))
    assert devolvida["values"] == {"archived_at": None}
    assert "arquivada: não" in devolvida["summary"]

    # ⚠️ a regressão que a tradução podia causar: `archived` É coluna em metas,
    # bens e dívidas. Traduzir sem escopo mandaria `archived_at` para `goals`.
    meta = action(resource="goals", kind="resource_update", archived="true")
    assert (await resources.prepare(ctx(), meta))["values"] == {"archived": True}


@pytest.mark.asyncio
async def test_desarquivar_nota_ainda_encontra_a_nota(monkeypatch):
    """`_where` de notes filtra a LIXEIRA, nunca o arquivo — senão desarquivar
    procura no conjunto que exclui justamente o alvo."""
    consultas = []

    async def fetch(sql, *a):
        consultas.append(sql)
        return [_linha(content="reunião")]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    await resources.prepare(ctx(), nota(archived="false"))
    assert "archived_at" not in consultas[0]
    assert "deleted_at is null" in consultas[0]


@pytest.mark.asyncio
async def test_tag_de_pasta_soma_e_valida_a_forma(monkeypatch):
    async def fetch(*a):
        return [_linha(name="trabalho", tags=["projetos"])]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(ctx(), pasta(tags="urgente, #casa"))
    # soma: gravar só o que veio na frase apagaria "projetos" em silêncio
    assert prepared["values"]["tags"] == ["casa", "projetos", "urgente"]
    assert "tags: casa, projetos, urgente" in prepared["summary"]

    with pytest.raises(Level1Error, match="Tag inválida"):
        await resources.prepare(ctx(), pasta(tags="tag com espaço e muito longa demais"))


@pytest.mark.asyncio
async def test_icone_de_pasta_aceita_a_palavra_em_portugues(monkeypatch):
    async def fetch(*a):
        return [_linha(name="trabalho")]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(ctx(), pasta(icon="maleta"))
    assert prepared["values"] == {"icon": "briefcase"}

    # fora do catálogo o Android desenha o `circle` genérico, sem erro nenhum:
    # a recusa aqui é o que impede uma pasta sem cara.
    with pytest.raises(Level1Error, match="Tipo inválido para ícone"):
        await resources.prepare(ctx(), pasta(icon="foguete"))


@pytest.mark.asyncio
async def test_mandar_para_a_lixeira_nao_escreve_timestamp_na_confirmacao(monkeypatch):
    async def fetch(*a):
        return [_linha(content="rascunho", deleted_at=None)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prepared = await resources.prepare(ctx(), nota(kind="resource_delete"))
    assert "lixeira" in prepared["summary"]
    assert "T" not in prepared["summary"].split("—")[-1]  # sem ISO na cara do usuário
