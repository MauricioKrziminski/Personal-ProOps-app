"""O que a frase do SIM descreve é o que se grava: regra de categoria/detalhe, pasta nova e hora do lembrete
resolvidas ANTES do portão (14/10/2026). Só o banco é dublê."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import uuid4

import pytest

from app.domain.dates import now_utc, tz
from app.graph import nodes, policy
from app.graph.schemas import FinanceAction, FinanceActionType, NotesAction
from app.tools import atributos, finance, notes, registry
from app.tools.base import ExecContext, ToolResult

SUB = uuid4()


def gasto(**kw):
    base = dict(type="create_expense", amount_cents=5000, description="uber", category="lazer")
    return FinanceAction(**{**base, **kw})


@pytest.fixture
def regra(monkeypatch):
    """Regra "uber" -> transporte / corrida. `casa` desliga a regra; `cai` simula o banco fora."""
    est = {"casa": True, "cai": False}

    async def fetch_one(sql, *a):
        if est["cai"]:
            raise RuntimeError("banco fora")
        if "match_rule_subcategory" in sql:
            return {"category": "transporte", "rule_id": "r1", "subcategory_id": SUB} if est["casa"] else None
        if "from public.subcategories" in sql:
            return {"name": "corrida"}

    monkeypatch.setattr(atributos.db, "fetch_one", fetch_one)
    return est


async def congela(acao, alvo=None):
    acoes = [acao]
    alvos = await atributos.congelar_regras("w1", acoes, [alvo or {}])
    return acoes[0], alvos[0]


# --- 1 e 2: categoria e detalhe da regra, na frase e no efeito ----------------------------------


async def test_regra_troca_a_categoria_e_a_frase_diz(regra):
    a, alvo = await congela(gasto())
    assert a.category == "transporte"
    assert alvo["regra"] == {"rule_id": "r1", "category": "transporte",
                             "subcategory_id": str(SUB), "subcategory_name": "corrida"}
    frase = policy.describe_for_confirmation(a, alvo)
    assert "categoria transporte (sua regra)" in frase and "detalhe corrida (sua regra)" in frase


async def test_categoria_dita_vence_a_regra_e_o_detalhe_dela_nao_vale(regra):
    a, alvo = await congela(gasto(categoria_dita=True))
    assert a.category == "lazer" and alvo["regra"]["rule_id"] is None and alvo["regra"]["subcategory_id"] is None
    frase = policy.describe_for_confirmation(a, alvo)
    assert "(sua regra)" not in frase and "categoria lazer" in frase


async def test_categoria_dita_igual_a_da_regra_mantem_o_detalhe_dela(regra):
    a, alvo = await congela(gasto(category="transporte", categoria_dita=True))
    assert alvo["regra"]["rule_id"] is None and alvo["regra"]["subcategory_name"] == "corrida"
    assert "detalhe corrida (sua regra)" in policy.describe_for_confirmation(a, alvo)


async def test_detalhe_dito_vence_o_da_regra(regra):
    a, alvo = await congela(gasto())
    alvo["atributos"] = {"subcategory_id": "dito", "subcategory_name": "app", "subcategory_parent": "transporte",
                         "frase": "detalhe app"}
    assert atributos.detalhe_da_regra(alvo, alvo["atributos"]) is None
    frase = policy.describe_for_confirmation(a, alvo)
    assert "detalhe app" in frase and "detalhe corrida" not in frase


async def test_parcelada_tambem_mostra_a_regra(regra):
    a, alvo = await congela(gasto(type="create_installment_purchase", installments=3, account="nubank"))
    assert "categoria transporte (sua regra)" in policy.describe_for_confirmation(a, alvo)


async def test_sem_regra_a_frase_e_a_de_antes(regra):
    regra["casa"] = False
    a, alvo = await congela(gasto())
    assert alvo["regra"]["category"] is None and a.category == "lazer"
    assert "(sua regra)" not in policy.describe_for_confirmation(a, alvo)


async def test_banco_fora_nao_congela_e_nao_derruba(regra):
    regra["cai"] = True
    a, alvo = await congela(gasto())
    assert "regra" not in alvo and a.category == "lazer"


# --- executor: grava o que a frase disse, hits uma vez, checkpoint antigo como antes -----------------


@pytest.fixture
def exec_(monkeypatch):
    visto = {"cat": [], "hits": [], "apply": 0}

    async def reserve(*a, **k):
        return True

    async def nada(*a, **k):
        return None

    async def tool(ctx, acao):
        visto["cat"].append(acao.category)
        return ToolResult("ok", result_id="x")

    async def bump(rule_id):
        visto["hits"].append(rule_id)

    async def apply(ws, acao):
        visto["apply"] += 1
        return acao.model_copy(update={"category": "da-regra-na-execucao"})

    for n, f in (("reserve_execution", reserve), ("execution_result_id", nada), ("confirm_execution", nada)):
        monkeypatch.setattr(registry.db, n, f)
    monkeypatch.setattr(registry, "ensure_owned", nada)
    monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.CREATE_EXPENSE, tool)
    monkeypatch.setattr(nodes, "bump_rule_hits", bump)
    monkeypatch.setattr(nodes, "apply_rules", apply)
    return visto


def estado(acao, alvo):
    return {"user_id": "u", "workspace_id": "w1", "phone": "55", "timezone": "America/Sao_Paulo",
            "text": "gastei 50 no uber", "source_message_id": "wamid.r", "results": [],
            "finance_actions": [acao.model_dump(mode="json")], "targets": [alvo]}


async def test_o_que_a_frase_diz_e_o_que_a_tool_recebe(regra, exec_):
    a, alvo = await congela(gasto())
    original = gasto()  # o checkpoint guarda a ação do parse, com a categoria do modelo
    await nodes.execute_node(estado(original, alvo))
    assert exec_["cat"] == ["transporte"] and "transporte" in policy.describe_for_confirmation(a, alvo)
    assert exec_["hits"] == ["r1"] and exec_["apply"] == 0  # uma vez, só da regra congelada


async def test_categoria_dita_nao_aplica_regra_na_execucao(regra, exec_):
    a, alvo = await congela(gasto(categoria_dita=True))
    await nodes.execute_node(estado(gasto(categoria_dita=True), alvo))
    assert exec_["cat"] == ["lazer"] and exec_["hits"] == [] and exec_["apply"] == 0


async def test_checkpoint_antigo_sem_marcador_aplica_a_regra_na_execucao(exec_):
    await nodes.execute_node(estado(gasto(), {}))
    assert exec_["apply"] == 1 and exec_["cat"] == ["da-regra-na-execucao"]


async def test_sem_marcador_mas_categoria_dita_nao_aplica(exec_):
    await nodes.execute_node(estado(gasto(categoria_dita=True), {}))
    assert exec_["apply"] == 0 and exec_["cat"] == ["lazer"]


async def test_detalhe_da_tool_vem_do_alvo_congelado(monkeypatch):
    async def nao(*a, **k):
        raise AssertionError("não consulta de novo")
    monkeypatch.setattr(finance, "_subcategory_from_rule", nao)
    ctx = ExecContext("u", "w1", None, "America/Sao_Paulo", "x", "m")
    ctx.target = {"regra": {"subcategory_id": str(SUB)}}
    assert await finance._detalhe_da_regra(ctx, gasto(), "transporte") == SUB
    ctx.target = {"regra": {"subcategory_id": None}}
    assert await finance._detalhe_da_regra(ctx, gasto(), "transporte") is None


async def test_detalhe_sem_marcador_consulta_como_antes(monkeypatch):
    async def antigo(ws, acao, cat):
        return "legado"
    monkeypatch.setattr(finance, "_subcategory_from_rule", antigo)
    ctx = ExecContext("u", "w1", None, "America/Sao_Paulo", "x", "m")
    assert await finance._detalhe_da_regra(ctx, gasto(), "transporte") == "legado"


def test_checkpoint_antigo_valida_sem_categoria_dita():
    assert FinanceAction.model_validate({"type": "create_expense", "amount_cents": 1}).categoria_dita is False


# --- 3: pasta nova e nome normalizado ---------------------------------------------------------------


def nota(**kw):
    return NotesAction(type="create_note", content="ideia boa", **kw)


def test_frase_diz_pasta_nova():
    a = nota(folder="viagens")
    assert policy.describe_for_confirmation(a, {"pasta_nova": True}).endswith("na pasta viagens (nova)")
    assert policy.describe_for_confirmation(a, {}).endswith("na pasta viagens")


async def test_pasta_vem_normalizada_para_a_frase(monkeypatch):
    async def nenhuma(*a, **k):
        return None
    monkeypatch.setattr(notes.db, "fetch_one", nenhuma)
    a = nota(folder="  Minhas Viagens ")
    await nodes._congela_pasta_da_regra("w1", a)
    assert a.folder == notes.normalize_folder("  Minhas Viagens ") != "  Minhas Viagens "


# --- 4: o lembrete toca na hora que a frase diz -------------------------------------------------------


def lembrete(**kw):
    return NotesAction(type="create_reminder", content="pagar a luz", **kw)


def test_so_data_nao_vira_instante_e_pergunta_a_hora():
    """A hora não se inventa (14/10/2026): só data = falta a hora, e a pergunta cita o dia."""
    amanha = (datetime.now(tz("America/Sao_Paulo")) + timedelta(days=1)).date().isoformat()
    assert notes.instante_do_lembrete(amanha, None, "America/Sao_Paulo") is None
    pergunta = notes.pergunta_do_lembrete("pagar a luz", amanha, None, "America/Sao_Paulo")
    assert pergunta.startswith("Que horas eu te lembro de *pagar a luz* amanhã (")


def test_com_hora_a_frase_diz_amanha_as_09h():
    amanha = (datetime.now(tz("America/Sao_Paulo")) + timedelta(days=1)).date().isoformat()
    a = lembrete(remind_at=f"{amanha}T09:00:00")
    assert notes.pergunta_do_lembrete(a.content, a.remind_at, None, "America/Sao_Paulo") is None
    nodes._congela_lembrete("America/Sao_Paulo", a)
    hoje = datetime.now(tz("America/Sao_Paulo")).date().isoformat()
    assert policy.describe_for_confirmation(a, None, hoje).endswith("para amanhã às 09:00")


def test_passado_com_recorrencia_vira_a_proxima_e_a_frase_mostra():
    a = lembrete(remind_at="2020-01-01T08:00:00", recurrence="FREQ=DAILY")
    nodes._congela_lembrete("America/Sao_Paulo", a)
    quando = notes.instante_do_lembrete(a.remind_at, "FREQ=DAILY", "America/Sao_Paulo")
    assert quando > now_utc() - timedelta(minutes=1) and quando.tzinfo is not None
    assert a.remind_at[:10] != "2020-01-01" and "às " in policy.describe_for_confirmation(a, None)


def test_sem_instante_a_acao_fica_como_veio():  # passado e sem repetição: a tool recusa; a ação não muda
    a = lembrete(remind_at="2020-01-01T08:00:00")
    nodes._congela_lembrete("America/Sao_Paulo", a)
    assert a.remind_at == "2020-01-01T08:00:00"
