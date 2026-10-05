"""Revisão independente do lote D: um teste por achado (os que falhavam antes de cada correção)."""

from __future__ import annotations

import pytest

from app.graph import prompts
from app.graph.schemas import FinanceQuery, ResourceAction, ResourceField
from app.tools import atributos, copias, finance, lote_d, queries, resolve, resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error
from tests.test_copias import CARTAO, MODELO, NUBANK, POUPANCA, Fakes, acao, ctx, prepara_favorito, tx  # noqa: F401
from tests.test_copias import duplicar, mundo  # noqa: F401  (fixtures)
from tests.test_lote_b_movimentos import USER, WS, Banco
from tests.test_lote_d_consultas import estado_plano


def com_forma(forma, conta=NUBANK["id"]):
    return {**MODELO, "fields": {**MODELO["fields"], "payment_method": forma, "account_id": conta}}


# ------------------------------------------------------------------ 1 crédito pede o CARTÃO


@pytest.mark.asyncio
@pytest.mark.parametrize("conta", [NUBANK["id"], None])
async def test_credito_sem_cartao_pergunta_o_cartao_como_o_lote_c(mundo, conta):
    f = Fakes(modelos=[com_forma("credit", conta)])
    mundo(f)
    with pytest.raises(copias.PerguntaDeCartao) as erro:  # não é JaExiste: vira rascunho, a resposta resolve
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true"))
    texto = erro.value.mensagem_usuario
    assert atributos.PERGUNTA_CARTAO.split(".")[0] in texto and "Nubank Cartão" in texto
    assert "Poupança" not in texto  # só cartões
    assert f.escritas == []


@pytest.mark.asyncio
async def test_credito_com_conta_dita_resolve_so_entre_cartoes(mundo, monkeypatch):
    f = Fakes(modelos=[com_forma("credit")])
    mundo(f)
    vistos = []

    async def conta_citada(ws, nome, *, only_cards=False, papel="a conta"):
        from uuid import UUID
        vistos.append(only_cards)
        return UUID(CARTAO["id"])

    monkeypatch.setattr(finance, "conta_citada", conta_citada)
    p = await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true", conta="nubank cartão"))
    assert vistos == [True] and "na conta Nubank Cartão" in p["summary"]
    assert p["copia"]["campos"]["payment_method"] == "credit"  # a forma NÃO é descartada em silêncio


# ------------------------------------------------------------------ 2 duplicar aceita conta/categoria/valor


@pytest.mark.asyncio
async def test_duplicar_com_conta_arquivada_a_resposta_resolve(duplicar, monkeypatch):
    duplicar(tx(account_id="00000000-0000-4000-8000-000000000000"))
    with pytest.raises(resources.JaExiste, match="não existe mais ou foi arquivada"):
        await resources.prepare(ctx(), acao("resource_create", "duplicar", "mercado"))

    async def conta_citada(ws, nome, *, only_cards=False, papel="a conta"):
        from uuid import UUID
        return UUID(POUPANCA["id"])

    monkeypatch.setattr(finance, "conta_citada", conta_citada)
    p = await resources.prepare(ctx(), acao("resource_create", "duplicar", "mercado", conta="poupança",
                                           categoria="Lazer", amount_cents=2000))
    assert "R$ 20,00" in p["summary"] and "na conta Poupança" in p["summary"] and "categoria lazer" in p["summary"]


# ------------------------------------------------------------------ 3 "cabe" só quando tudo foi calculado


def test_cabe_exige_tudo_calculado_e_diz_o_horizonte():
    f = lote_d.frase_do_plano_de_metas(estado_plano(), "2026-10-05")
    assert "Cabe:" in f and "próximos 12 meses" in f
    for ov, fora in [({"incomplete_goal_ids": ["g2"]}, "Notebook"), ({"missed_deadline_goal_ids": ["g1"]}, "Reserva"),
                     ({"unassigned_goals_cents": "209000"}, "R$ 2.090,00")]:
        f = lote_d.frase_do_plano_de_metas(estado_plano(**ov), "2026-10-05")
        assert "Cabe:" not in f and "Pelo que dá para calcular nos próximos 12 meses, não aperta, mas" in f and fora in f


# ------------------------------------------------------------------ 5 espaço congelado


@pytest.mark.asyncio
async def test_copia_congela_o_espaco_e_recusa_outro(mundo):
    f = Fakes()
    p = await prepara_favorito(f, mundo)
    assert p["copia"]["workspace_id"] == WS
    outro = ExecContext(USER, "outro-espaco", None, "America/Sao_Paulo", "", "app:msg-1")
    with pytest.raises(Level1Error, match="mudou"):
        await copias.executar_copia(outro, p["copia"])
    assert not [e for e in f.escritas if e[0].startswith(("insert", "with"))]


# ------------------------------------------------------------------ 6 mensal não fica salvo


@pytest.mark.asyncio
async def test_mensal_diz_que_so_a_conta_e_feita(monkeypatch):
    from tests.test_lote_d_metas import Banco as BancoMeta, instala
    instala(monkeypatch, BancoMeta())
    p = await resources.prepare(ctx(), acao("resource_create", "goals", "Casa", target_cents=1000000, mensal_cents=50000))
    aviso = "só a conta; o plano mensal não fica salvo — isso é no app"
    assert aviso in p["summary"]
    r = await resources.execute(ctx(target={"prepared": await resources.prepare(
        ctx(), acao("resource_list", "goals", "Viagem", mensal_cents=50000))}), acao("resource_list", "goals", "Viagem", mensal_cents=50000))
    assert aviso in r.message


# ------------------------------------------------------------------ 7 INSERT e uso do favorito num statement só


@pytest.mark.asyncio
async def test_inserir_e_contar_o_uso_e_um_statement_so(mundo):
    f = Fakes()
    p = await prepara_favorito(f, mundo)
    f.escritas.clear()
    await copias.executar_copia(ctx(), p["copia"])
    assert len(f.escritas) == 1 and "transaction_templates" in f.escritas[0][0] and "insert into public.transactions" in f.escritas[0][0]


# ------------------------------------------------------------------ 8 marcos


@pytest.mark.parametrize("texto, esperado", [("R$ 2.500", [250000]), ("2500 reais; 50%", [250000, 500000]),
                                             ("5 mil", [500000])])
def test_marcos_aceitam_reais_por_extenso(texto, esperado):
    assert lote_d.ler_marcos(texto, 1000000, []) == esperado


def test_marcos_misturando_mais_e_substituicao_e_recusado():
    with pytest.raises(Level1Error, match="uma coisa só"):
        lote_d.ler_marcos("+90%; 50%", 1000000, [250000])


# ------------------------------------------------------------------ 9 categoria normalizada


@pytest.mark.asyncio
async def test_categoria_dita_passa_por_clean_category(mundo):
    p = await prepara_favorito(Fakes(), mundo, categoria="  ALIMENTAÇÃO  ")
    assert p["copia"]["campos"]["category"] == copias.guards.clean_category("  ALIMENTAÇÃO  ")


# ------------------------------------------------------------------ 10 meta citada que não existe


@pytest.mark.asyncio
async def test_query_goals_termo_que_nao_casa_diz_e_lista(monkeypatch):
    async def fetch(sql, *a):
        return [{"id": "g1", "name": "Viagem", "target_cents": 100000, "saved_cents": 0, "deadline": None}]

    monkeypatch.setattr(queries.db, "fetch", fetch)
    monkeypatch.setattr(lote_d.db, "fetch", fetch)
    r = await queries.query_goals(ctx(), FinanceQuery(type="query_goals", search_term="carro"))
    assert "Não achei meta com *carro*" in r.message and "Viagem" in r.message


# ------------------------------------------------------------------ 11 busca por nome no SQL


@pytest.mark.asyncio
async def test_favorito_e_buscado_pelo_nome_no_sql(mundo):
    f = Fakes()
    sqls = []
    mundo(f)

    async def fetch(sql, *a):
        sqls.append((sql, a))
        return [MODELO]

    copias.db.fetch = fetch  # sobrepõe o dublê do fixture só para registrar a consulta
    await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoço", lancar="true"))
    consulta = [s for s in sqls if "transaction_templates" in s[0]][0]
    assert "unaccent" in consulta[0] and "almo" in str(consulta[1]).lower() and "limit 50" not in consulta[0]


# ------------------------------------------------------------------ 12 a frase e a resposta dizem o que o INSERT grava


@pytest.mark.asyncio
async def test_frase_e_resposta_dizem_conta_detalhe_e_classificacao(mundo):
    com = {**MODELO, "fields": {**MODELO["fields"], "subcategory_id": "33333333-3333-4333-8333-333333333333"}}
    f = Fakes(modelos=[com])
    p = await prepara_favorito(f, mundo)
    assert "no Pix · variável · detalhe " in p["summary"]
    r = await resources.execute(ctx(target={"prepared": p}), acao("resource_update", "favoritos", "almoco", lancar="true"))
    assert "na conta Nubank" in r.message


@pytest.mark.asyncio
async def test_favorito_sem_conta_usa_a_padrao_e_diz(mundo, monkeypatch):
    sem = {**MODELO, "fields": {k: v for k, v in MODELO["fields"].items() if k not in ("account_id", "payment_method")}}
    f = Fakes(modelos=[sem])

    async def padrao(ws):
        from uuid import UUID
        return UUID(NUBANK["id"])

    monkeypatch.setattr(finance, "default_account", padrao)
    p = await prepara_favorito(f, mundo)
    assert "na conta Nubank (a conta padrão)" in p["summary"] and p["copia"]["campos"]["account_id"] == NUBANK["id"]
    async def sem_padrao(ws):
        return None
    monkeypatch.setattr(finance, "default_account", sem_padrao)
    p = await prepara_favorito(Fakes(modelos=[sem]), mundo)
    assert ", sem conta" in p["summary"]


# ------------------------------------------------------------------ 13 reserva sem p_as_of


@pytest.mark.asyncio
async def test_reserva_deixa_a_data_para_o_default_da_funcao(monkeypatch):
    from tests.test_lote_d_consultas import FIXTURES
    estado = {**FIXTURES["manual_3_3"]["state"], "workspace_id": WS}
    banco = Banco(**{"public.emergency_reserve_state(": {"s": estado}})
    monkeypatch.setattr(lote_d.db, "como_usuario", banco)
    await lote_d.ler_reserva(ctx())
    sql, args = banco.chamadas[0]
    assert "::date" not in sql and args == (WS,)


# ------------------------------------------------------------------ 14 roteamento


def test_meta_citada_vai_para_consulta_de_metas_nao_para_a_reserva():
    texto = " ".join(open(prompts.__file__).read().lower().split())
    assert "quanto falta pra minha meta reserva" in texto and "financas_consulta" in texto
    assert "meta reserva" in resources.prompt_catalogue().lower()
