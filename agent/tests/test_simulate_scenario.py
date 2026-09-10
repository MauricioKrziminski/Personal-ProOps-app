"""O "E se…?" pelo texto — e a prova de que ele responde o MESMO que a tela.

A validação de 10/09/2026 mediu três formas de o agente discordar do app para a hipótese
IDÊNTICA, todas por construção do `_affordability`:

1. **janela** — ele filtra `day <= add_months(current_date, parcelas)`; à vista, um mês só.
   Na produção o pior ponto em 1 mês era −3.547,28 e no horizonte da tela, −3.781,13.
2. **pior ≠ primeiro** — ele devolve o MÍNIMO da série; a tela avisa no PRIMEIRO dia negativo.
3. **só gasto, só a partir de hoje, uma hipótese só.**

Estes testes prendem os três. O que eles NÃO fazem é conferir a aritmética de `draft_effect` —
ela mora no Postgres e quem prova é `supabase/tests/draft_scenario.sql`. Duplicar a conta aqui
seria a segunda cópia, que é justamente o defeito que a migration original saiu matando.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest

from app import db
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.tools import queries
from app.tools.base import ExecContext

WS, USER = uuid4(), uuid4()
HOJE = date.today()


def ctx(siblings=None, indice=0) -> ExecContext:
    c = ExecContext(
        user_id=USER,
        workspace_id=WS,
        phone=None,
        timezone="America/Sao_Paulo",
        texto="",
        source_message_id="app:t1",
        action_index=indice,
    )
    c.siblings = list(enumerate(siblings)) if siblings else []
    return c


def acao(**kw) -> FinanceQuery:
    kw.setdefault("type", FinanceQueryType.SIMULATE_SCENARIO)
    return FinanceQuery(**kw)


def serie(saldos: dict[int, int], dias: int = 400) -> list[dict]:
    """Uma projeção sintética: `{deslocamento em dias: saldo}`, resto em 100000."""
    return [
        {
            "day": HOJE + timedelta(days=i),
            "in_cents": 0,
            "out_cents": 0,
            "balance_cents": saldos.get(i, 100000),
        }
        for i in range(dias)
    ]


@pytest.fixture
def espia(monkeypatch):
    """Captura o SQL e os argumentos, e devolve a série que o teste mandar."""
    capturado: dict = {}

    def responder(linhas):
        async def fetch(sql, *args):
            capturado["sql"] = sql
            capturado["args"] = args
            return linhas

        monkeypatch.setattr(db, "fetch", fetch)
        return capturado

    return responder


class TestCaminho:
    """Qual RPC ele chama. É o guarda da correção inteira."""

    @pytest.mark.asyncio
    async def test_usa_forecast_with_drafts_e_nunca_affordability(self, espia):
        cap = espia(serie({}))
        await queries.simulate_scenario(ctx(), acao(amount_cents=300000, installments=6))
        assert "_forecast_with_drafts" in cap["sql"]
        # `_affordability` continua existindo para APK antigo em campo — mas não é mais
        # por onde o agente responde, senão as três divergências voltam junto.
        assert "_affordability" not in cap["sql"]

    @pytest.mark.asyncio
    async def test_manda_o_rascunho_no_formato_do_motor(self, espia):
        import json

        cap = espia(serie({}))
        await queries.simulate_scenario(
            ctx(), acao(amount_cents=150000, kind="income", mode="monthly")
        )
        rascunhos = json.loads(cap["args"][2])
        assert rascunhos == [
            {
                "kind": "income",
                "amount_cents": 150000,
                "installments": 1,
                "start": HOJE.isoformat(),
                "mode": "monthly",
            }
        ]


class TestVeredito:
    """Primeiro negativo, não o pior — é como a tela avisa (`serie.find`)."""

    @pytest.mark.asyncio
    async def test_avisa_no_primeiro_dia_negativo_nao_no_pior(self, espia):
        # dia 10 fica negativo em -100; o FUNDO do poço é o dia 200, com -5000.
        espia(serie({10: -10000, 11: -9000, 200: -500000}))
        r = await queries.simulate_scenario(ctx(), acao(amount_cents=300000, installments=12))
        primeiro = HOJE + timedelta(days=10)
        pior = HOJE + timedelta(days=200)
        assert primeiro.strftime("%d/%m/%Y") in r.message
        assert pior.strftime("%d/%m/%Y") not in r.message

    @pytest.mark.asyncio
    async def test_sem_negativo_diz_que_cabe(self, espia):
        espia(serie({}))
        r = await queries.simulate_scenario(ctx(), acao(amount_cents=1000, installments=1))
        assert "não fica no vermelho" in r.message

    @pytest.mark.asyncio
    async def test_nunca_escreve(self, espia):
        espia(serie({}))
        r = await queries.simulate_scenario(ctx(), acao(amount_cents=1000))
        assert r.read_only is True
        assert "Nada disso foi salvo" in r.message


class TestJanela:
    """A hipótese tem que CABER na janela, senão ela some da resposta sem avisar."""

    @pytest.mark.asyncio
    async def test_parcelamento_longo_estica_o_horizonte(self, espia):
        cap = espia(serie({}))
        await queries.simulate_scenario(ctx(), acao(amount_cents=1200000, installments=24))
        assert cap["args"][1] > 24 * 30, "24 parcelas não cabem na janela pedida"

    @pytest.mark.asyncio
    async def test_respeita_o_teto_de_tres_anos(self, espia):
        cap = espia(serie({}))
        await queries.simulate_scenario(ctx(), acao(amount_cents=100, installments=72))
        assert cap["args"][1] <= queries.FORECAST_MAX_DIAS

    @pytest.mark.asyncio
    async def test_query_to_nunca_encolhe_abaixo_da_hipotese(self, espia):
        """"e se eu receber 5.000 em dezembro, como fico até novembro?" — a janela pedida
        fecha ANTES do início da suposição. Encolher ali repetiria o defeito que a
        `20260910233000` matou: saldo mexe, "entra/sai" fica zerado, ninguém vê."""
        cap = espia(serie({}))
        await queries.simulate_scenario(
            ctx(),
            acao(
                amount_cents=500000,
                kind="income",
                query_from=(HOJE + timedelta(days=80)).isoformat(),
                query_to=(HOJE + timedelta(days=30)).isoformat(),
            ),
        )
        assert cap["args"][1] > 80, "a janela fechou antes de a hipótese começar"

    @pytest.mark.asyncio
    async def test_query_to_manda_quando_existe(self, espia):
        cap = espia(serie({}))
        alvo = HOJE + timedelta(days=120)
        await queries.simulate_scenario(
            ctx(), acao(amount_cents=1000, query_to=alvo.isoformat())
        )
        assert cap["args"][1] == 120


class TestHipotese:
    """Como o texto vira rascunho. Errar `mode` erra o valor por um fator de N."""

    def test_monthly_repete_o_valor_cheio(self):
        r = queries._rascunho(acao(amount_cents=150000, mode="monthly", installments=6), HOJE)
        assert r["mode"] == "monthly" and r["installments"] == 1

    def test_total_reparte(self):
        r = queries._rascunho(acao(amount_cents=300000, mode="total", installments=6), HOJE)
        assert r["mode"] == "total" and r["installments"] == 6

    def test_kind_desconhecido_cai_em_despesa(self):
        # o lado conservador: supor entrada que ninguém pediu deixa a projeção otimista
        assert queries._rascunho(acao(amount_cents=1, kind="salário"), HOJE)["kind"] == "expense"
        assert queries._rascunho(acao(amount_cents=1), HOJE)["kind"] == "expense"

    def test_nunca_comeca_antes_de_hoje(self):
        passado = (HOJE - timedelta(days=90)).isoformat()
        assert queries._rascunho(acao(amount_cents=1, query_from=passado), HOJE)["start"] == HOJE.isoformat()

    def test_data_invalida_nao_derruba(self):
        assert queries._rascunho(acao(amount_cents=1, query_from="mês que vem"), HOJE)["start"] == HOJE.isoformat()

    def test_parcelas_no_teto_do_motor(self):
        assert queries._rascunho(acao(amount_cents=1, installments=999), HOJE)["installments"] == 72
        assert queries._rascunho(acao(amount_cents=1, installments=0), HOJE)["installments"] == 1


class TestEmpilhar:
    """Duas suposições na mesma frase são UM cenário — como na tela."""

    @pytest.mark.asyncio
    async def test_soma_as_irmas_numa_resposta_so(self, espia):
        import json

        a = acao(amount_cents=150000, kind="income", mode="monthly")
        b = acao(amount_cents=300000, kind="expense", installments=6)
        cap = espia(serie({}))
        r = await queries.simulate_scenario(ctx(siblings=[a, b], indice=0), a)
        rascunhos = json.loads(cap["args"][2])
        assert len(rascunhos) == 2
        assert {x["kind"] for x in rascunhos} == {"income", "expense"}
        assert "receber" in r.message and "gastar" in r.message

    @pytest.mark.asyncio
    async def test_a_segunda_sai_calada(self, espia):
        a = acao(amount_cents=150000, kind="income")
        b = acao(amount_cents=300000, kind="expense")
        espia(serie({}))
        r = await queries.simulate_scenario(ctx(siblings=[a, b], indice=1), b)
        # mensagem vazia não entra na resposta (`if resultado.message` no executor):
        # duas respostas, cada uma ignorando a outra, dariam dois saldos e nenhum deles certo
        assert r.message == ""

    @pytest.mark.asyncio
    async def test_lider_e_eleita_entre_as_que_RODAM(self, espia):
        """A 1ª do plano pode estar bloqueada e não rodar. Se a eleição olhasse o plano
        inteiro, a que sobrou ficaria calada esperando por ela e a resposta sumiria."""
        b = acao(amount_cents=300000, kind="expense")
        c = ctx()
        c.siblings = [(1, b)]  # só a de índice 1 vai rodar
        c.action_index = 1
        espia(serie({}))
        r = await queries.simulate_scenario(c, b)
        assert r.message != "", "ninguém respondeu: a eleita ficou fora da execução"

    @pytest.mark.asyncio
    async def test_sem_irmas_responde_sozinha(self, espia):
        espia(serie({}))
        r = await queries.simulate_scenario(ctx(), acao(amount_cents=1000))
        assert r.message != ""
