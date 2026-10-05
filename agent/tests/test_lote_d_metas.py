"""Lote D, metas: prazo × mês (F10) e marcos/ícone/cor (F19).

A conta de calendário é do BANCO (`private.goal_contribution_result`); os três retornos canned abaixo
são o que ele devolveu no staging e o que `src/lib/goal-contribution.ts` calcula para as mesmas entradas
(conferido nos dois em 05/10/2026). Aqui se prova o encaixe: o que vai ao banco, o que a frase do SIM diz
e o que é recusado ANTES do SIM."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.graph import policy
from app.graph.schemas import FinanceAction, ResourceAction, ResourceField
from app.tools import lote_d, queries, resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

USER, WS = "user-1", "ws-1"
META = {"id": "6e94e5b2-99bb-4654-99f2-3d23bd4520d8", "name": "Viagem"}
POR_PRAZO = {"status": "ready", "reason": None, "monthly_cents": "66667", "monthly_count": 15, "last_cents": "66662",
             "first_monthly_on": "2026-10-05", "estimated_on": "2027-12-05"}
POR_MES = {"status": "ready", "reason": None, "monthly_cents": "50000", "monthly_count": 20, "last_cents": "50000",
           "first_monthly_on": "2026-10-05", "estimated_on": "2028-05-05"}


def ctx(**extra):
    return ExecContext(USER, WS, None, "America/Sao_Paulo", "", "app:msg-1", action_index=0, **extra)


def acao(tipo="resource_update", name="Viagem", resource="goals", **campos):
    return ResourceAction(type=tipo, resource=resource, name=name,
                          fields=[ResourceField(name=k, value=None if v is None else str(v)) for k, v in campos.items()])


class Banco:
    """`db.fetch/fetch_one/execute` de mentira; registra as escritas."""

    def __init__(self, meta=None, marcos=(), contribuicao=None):
        self.meta = {"id": META["id"], "name": "Viagem", "target_cents": 1000000, "saved_cents": 240000,
                     "deadline": None, "row_version": "77", "workspace_id": WS, **(meta or {})}
        self.marcos = list(marcos)
        self.contribuicao = contribuicao or (lambda entrada: POR_PRAZO if entrada["mode"] == "deadline" else POR_MES)
        self.escritas: list[tuple[str, tuple]] = []
        self.entradas: list[dict] = []

    async def fetch(self, sql, *args):
        if "from public.goal_milestones" in sql:
            return [{"amount_cents": m, "goal_id": self.meta["id"]} for m in self.marcos]
        if "from public.goals" in sql and "select *" in sql:
            return [self.meta]
        if "from public.goals" in sql:  # `_achar` (nome da meta)
            return [{"id": self.meta["id"], "name": self.meta["name"]}]
        return []

    async def fetch_one(self, sql, *args):
        import json
        if "goal_contribution_result" in sql:
            entrada = json.loads(args[0])
            self.entradas.append(entrada)
            return {"r": self.contribuicao(entrada)}
        if "select target_cents, saved_cents, deadline" in sql:
            return self.meta
        if sql.startswith("select id from public.goals"):
            return {"id": self.meta["id"]}
        if sql.lstrip().startswith(("update public.goals", "insert into public.goals")):
            self.escritas.append((sql, args))
            return {"id": self.meta["id"]}
        raise AssertionError(f"SQL sem roteiro: {sql}")

    async def execute(self, sql, *args):
        self.escritas.append((sql, args))


@pytest.fixture
def banco(monkeypatch):
    b = Banco()
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(resources.db, nome, getattr(b, nome))
    return b


def instala(monkeypatch, b):
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(resources.db, nome, getattr(b, nome))


# ------------------------------------------------------------------ F10: prazo × mês


@pytest.mark.asyncio
async def test_meta_por_prazo_diz_quanto_por_mes_e_manda_a_ancora_de_hoje(banco):
    p = await resources.prepare(ctx(), acao("resource_create", "Casa", target_cents=1000000, deadline="2027-12-31"))
    assert "para chegar em 31/12/2027 dá R$ 666,67 por mês, em 15 aportes" in p["summary"]
    assert "o último sai R$ 666,62" in p["summary"]
    e = banco.entradas[0]
    assert e["mode"] == "deadline" and e["deadline_on"] == "2027-12-31" and e["monthly_cents"] is None
    assert e["target_cents"] == 1000000 and e["saved_cents"] == 0 and e["first_on"] == e["as_of"]


@pytest.mark.asyncio
async def test_meta_por_mes_diz_quando_chega_e_nao_grava_a_coluna_virtual(banco):
    p = await resources.prepare(ctx(), acao("resource_create", "Casa", target_cents=1000000, mensal_cents=50000))
    assert "guardando R$ 500,00 por mês, a meta chega em 05/05/2028 (20 aportes)" in p["summary"]
    assert "mensal_cents" not in p["values"] and set(p["values"]) == {"name", "target_cents"} | set(p["values"]) - {"mensal_cents"}
    assert banco.entradas[0]["mode"] == "monthly" and banco.entradas[0]["monthly_cents"] == 50000


@pytest.mark.asyncio
async def test_por_mes_numa_meta_com_prazo_compara_com_o_prazo(banco):
    p = await resources.prepare(ctx(), acao("resource_create", "Casa", target_cents=1000000, mensal_cents=50000,
                                            deadline="2027-12-31"))
    assert "isso passa do prazo de 31/12/2027" in p["summary"]


@pytest.mark.asyncio
async def test_so_dizer_quanto_guarda_por_mes_numa_meta_existente_responde_sem_gravar(banco):
    p = await resources.prepare(ctx(), acao("resource_list", mensal_cents=50000))
    assert p["summary"] == "calcular quando a meta chega"
    r = await resources.execute(ctx(target={"prepared": p}), acao("resource_list", mensal_cents=50000))
    assert r.read_only and "Meta *Viagem*" in r.message and "chega em 05/05/2028" in r.message
    assert banco.entradas[0]["saved_cents"] == 240000 and banco.escritas == []
    # editar com SÓ a conta também só responde: nada muda na meta
    with pytest.raises(resources.JaExiste, match="Não alterei a meta"):
        await resources.prepare(ctx(), acao("resource_update", mensal_cents=50000))
    assert banco.escritas == []


@pytest.mark.asyncio
async def test_mudar_o_prazo_de_meta_existente_recalcula_com_o_guardado(banco):
    p = await resources.prepare(ctx(), acao(deadline="2027-12-31"))
    assert banco.entradas[0]["saved_cents"] == 240000 and "dá R$ 666,67 por mês" in p["summary"]
    # mudar só o nome não calcula nada
    banco.entradas.clear()
    p = await resources.prepare(ctx(), acao(name="Viagem", archived="false"))
    assert banco.entradas == [] and "por mês" not in p["summary"]


@pytest.mark.asyncio
async def test_por_mes_zerado_ou_vazio_pergunta(banco):
    with pytest.raises(resources.JaExiste, match="Quanto você guarda por mês"):
        await resources.prepare(ctx(), acao("resource_create", "Casa", target_cents=1000000, mensal_cents=None))
    with pytest.raises(Level1Error, match="positivo"):
        await resources.prepare(ctx(), acao("resource_create", "Casa", target_cents=1000000, mensal_cents=0))


@pytest.mark.asyncio
async def test_prazo_que_ja_passou_nao_inventa_numero(monkeypatch):
    b = Banco(contribuicao=lambda e: {"status": "unreachable", "reason": "deadline"})
    instala(monkeypatch, b)
    p = await resources.prepare(ctx(), acao("resource_create", "Casa", target_cents=1000000, deadline="2020-01-01"))
    assert "o prazo já passou" in p["summary"] and "R$ 666" not in p["summary"]


def test_frase_do_create_goal_traz_o_calculo_congelado():
    a = FinanceAction(type="create_goal", target_ref="Viagem", amount_cents=1000000, occurred_at="2027-12-31")
    f = policy.describe_for_confirmation(a, {"contribuicao": "para chegar em 31/12/2027 dá R$ 666,67 por mês"}, "2026-10-05")
    assert f == "criar a meta *Viagem* de R$ 10.000,00 até 31/12/2027; para chegar em 31/12/2027 dá R$ 666,67 por mês"
    assert policy.describe_for_confirmation(a, None, "2026-10-05").endswith("até 31/12/2027")


@pytest.mark.asyncio
async def test_congelar_so_calcula_meta_com_prazo_e_valor(monkeypatch):
    b = Banco()
    monkeypatch.setattr(lote_d.db, "fetch_one", b.fetch_one)
    com = FinanceAction(type="create_goal", target_ref="Viagem", amount_cents=1000000, occurred_at="2027-12-31")
    sem = FinanceAction(type="create_goal", target_ref="Viagem", amount_cents=1000000)
    outra = FinanceAction(type="create_expense", amount_cents=1000, description="x")
    alvos = await lote_d.congelar("America/Sao_Paulo", "", [com, sem, outra], [{}, {}, {}])
    assert "dá R$ 666,67 por mês" in alvos[0]["contribuicao"] and "contribuicao" not in alvos[1]
    assert "contribuicao" not in alvos[2] and len(b.entradas) == 1


# ------------------------------------------------------------------ F19: marcos


@pytest.mark.parametrize("texto, alvo, esperado", [
    ("25%, 50%, 75%", 1000000, [250000, 500000, 750000]),
    ("25%; 50%", 1000000, [250000, 500000]),
    ("33,3%", 1000000, [333000]),
    ("250000 e 500000", 1000000, [250000, 500000]),
    ("12,5%", 12345, [1543]),  # 1543,125 -> centavo
    ("nenhum", 1000000, []),
    ("sem marcos", 1000000, []),
])
def test_marcos_percentual_vira_centavos_como_no_app(texto, alvo, esperado):
    assert lote_d.ler_marcos(texto, alvo, []) == esperado


def test_percentual_para_centavos_arredonda_meio_para_cima():
    assert lote_d.percentual_para_centavos(Decimal("0.5"), 100) == 1  # 0,5 centavo sobe
    assert lote_d.percentual_para_centavos(Decimal("33.3"), 1000) == 333


def test_marcos_com_mais_somam_aos_atuais():
    assert lote_d.ler_marcos("+90%", 1000000, [250000, 500000]) == [250000, 500000, 900000]
    assert lote_d.ler_marcos("90%", 1000000, [250000, 500000]) == [900000]  # sem + a lista substitui


@pytest.mark.parametrize("texto, trecho", [
    ("100%", "precisa ficar abaixo do alvo"),
    ("1000000", "precisa ficar abaixo do alvo"),
    ("0%", "Não entendi"),
    ("150%", "Não entendi"),
    ("12,34%", "Não entendi"),
    ("meio", "Não entendi"),
    ("25%, 250000", "repetido"),
])
def test_marco_invalido_e_recusado_antes_do_sim(texto, trecho):
    with pytest.raises(Level1Error, match=trecho):
        lote_d.ler_marcos(texto, 1000000, [])


@pytest.mark.asyncio
async def test_editar_marcos_mostra_antes_e_depois_e_grava_a_diferenca(monkeypatch):
    b = Banco(marcos=[250000, 500000])
    instala(monkeypatch, b)
    p = await resources.prepare(ctx(), acao(marcos="25%, 90%"))
    assert "marcos: 25% = R$ 2.500,00; 90% = R$ 9.000,00 (antes: 25% = R$ 2.500,00; 50% = R$ 5.000,00)" in p["summary"]
    assert p["marcos"] == [250000, 900000] and "marcos" not in p["values"]
    r = await resources.execute(ctx(target={"prepared": p}), acao(marcos="25%, 90%"))
    sqls = [(s.split()[0], a) for s, a in b.escritas]
    assert ("delete", (META["id"], WS, 500000)) in sqls and ("insert", (WS, META["id"], 900000)) in sqls
    assert not any(a[-1] == 250000 for s, a in sqls)  # o que ficou não é tocado
    assert r.message.startswith("Concluído")


@pytest.mark.asyncio
async def test_marcos_usam_o_alvo_novo_da_mesma_frase(monkeypatch):
    instala(monkeypatch, Banco())
    p = await resources.prepare(ctx(), acao(target_cents=2000000, marcos="50%"))
    assert p["marcos"] == [1000000]
    # e o marco que passa do alvo NOVO é recusado, mesmo cabendo no velho
    with pytest.raises(Level1Error, match="abaixo do alvo"):
        await resources.prepare(ctx(), acao(target_cents=100000, marcos="500000"))


@pytest.mark.asyncio
async def test_marcos_ao_criar_a_meta(monkeypatch):
    b = Banco()
    instala(monkeypatch, b)
    p = await resources.prepare(ctx(), acao("resource_create", "Casa", target_cents=1000000, marcos="25%, 50%, 75%"))
    assert "marcos: 25% = R$ 2.500,00; 50% = R$ 5.000,00; 75% = R$ 7.500,00" in p["summary"]
    await resources.execute(ctx(target={"prepared": p}), acao("resource_create", "Casa", target_cents=1000000,
                                                              marcos="25%, 50%, 75%"))
    assert sum(1 for s, a in b.escritas if s.startswith("insert into public.goal_milestones")) == 3


@pytest.mark.asyncio
async def test_prazo_junto_com_aporte_ou_retirada_nao_mistura(banco):
    with pytest.raises(resources.JaExiste, match="uma coisa por vez"):
        await resources.prepare(ctx(), acao(marcos="25%", aporte_do_dia="2026-10-01", novo_valor_do_aporte=100))


# ------------------------------------------------------------------ F19: ícone e cor


@pytest.mark.asyncio
async def test_icone_e_cor_pelo_nome_que_o_app_oferece(banco):
    p = await resources.prepare(ctx(), acao(icone="avião", cor="azul"))
    assert p["values"] == {"icon": "airplane", "color": "oceano"}
    assert "ícone: Avião" in p["summary"] and "cor: oceano" in p["summary"]


@pytest.mark.asyncio
async def test_icone_ou_cor_fora_da_lista_pergunta_com_as_opcoes(banco):
    with pytest.raises(Level1Error, match="Não tenho o ícone \\*foguete\\*.*Carrinho.*Avião"):
        await resources.prepare(ctx(), acao(icone="foguete"))
    with pytest.raises(Level1Error, match="Não tenho a cor \\*fúcsia\\*.*grafite.*turquesa"):
        await resources.prepare(ctx(), acao(cor="fúcsia"))


@pytest.mark.asyncio
async def test_tirar_icone_e_cor_vira_padrao(banco):
    p = await resources.prepare(ctx(), acao(icone="padrão", cor="tira"))
    assert p["values"] == {"icon": None, "color": None} and "ícone: padrão" in p["summary"]


def test_retirada_e_aporte_continuam_com_o_lote_b():
    assert not (lote_d.CAMPOS_META & resources.movimentos.CAMPOS_RETIRAR)


# ------------------------------------------------------------------ F19: "qual o próximo marco?"


@pytest.mark.asyncio
async def test_proximo_marco_da_meta_citada(monkeypatch):
    metas = [{"id": "g1", "name": "Viagem", "target_cents": 1000000, "saved_cents": 300000, "deadline": None},
             {"id": "g2", "name": "Notebook", "target_cents": 900000, "saved_cents": 240000, "deadline": None}]

    async def fetch(sql, *args):
        if "goal_milestones" in sql:
            return [{"goal_id": "g1", "amount_cents": 250000}, {"goal_id": "g1", "amount_cents": 500000},
                    {"goal_id": "g2", "amount_cents": 900000}]  # marco no alvo não conta
        return metas

    monkeypatch.setattr(queries.db, "fetch", fetch)
    monkeypatch.setattr(lote_d.db, "fetch", fetch)
    from app.graph.schemas import FinanceQuery
    r = await queries.query_goals(ctx(), FinanceQuery(type="query_goals", search_term="viagem"))
    assert "Viagem" in r.message and "Notebook" not in r.message
    assert "Próximo marco: R$ 5.000,00 (50%) · faltam R$ 2.000,00" in r.message
    r = await queries.query_goals(ctx(), FinanceQuery(type="query_goals"))
    assert "Notebook" in r.message and r.message.count("Próximo marco") == 1  # sem marco visível, sem linha
