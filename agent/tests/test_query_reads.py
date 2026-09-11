"""As consultas de LEITURA que faltavam: recorrências, dívidas e lembretes.

A auditoria de 09/09/2026 cobriu MUTAÇÃO. Estas três são o lado da leitura, e existem porque
"não achei" era a resposta errada: a série do salário existe em `recurring_transactions`, mas a
ocorrência do mês que vem só nasce quando o `finance-scheduler` materializa — então procurar em
`transactions` devolvia vazio sobre um cadastro correto.

⚠️ **O que este arquivo mais protege é FUSO.** Todo instante vem do Postgres em UTC e o usuário
lê em America/Sao_Paulo. Um lembrete das 23h30 de Brasília é 02h30 do DIA SEGUINTE em UTC:
formatar o instante cru diria "amanhã" para algo que toca hoje à noite. Não dá para ver isso
lendo o código — só medindo com um instante que cruza a meia-noite.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app import db
from app.domain.recurrence import descreve_rrule
from app.graph.schemas import FinanceQuery, FinanceQueryType, NotesAction, NotesActionType
from app.tools import notes, queries
from app.tools.base import ExecContext

WS = uuid4()
USER = uuid4()


def ctx() -> ExecContext:
    return ExecContext(
        user_id=USER,
        workspace_id=WS,
        phone=None,
        timezone="America/Sao_Paulo",
        texto="",
        source_message_id="app:t1",
    )


class TestDescreveRRule:
    """Mesma redação de `src/lib/rrule-text.ts`. Duas grafias para a mesma regra é o usuário
    tendo que reconciliar o card do app com a resposta do WhatsApp."""

    @pytest.mark.parametrize(
        "rrule,esperado",
        [
            ("FREQ=MONTHLY;BYMONTHDAY=5", "todo dia 5"),
            ("RRULE:FREQ=MONTHLY;BYMONTHDAY=5", "todo dia 5"),
            ("FREQ=MONTHLY;BYMONTHDAY=5,20", "todo dia 5 e 20"),
            ("FREQ=DAILY", "todo dia"),
            ("FREQ=WEEKLY;BYDAY=MO", "toda segunda"),
            ("FREQ=WEEKLY;BYDAY=SA", "todo sábado"),
            ("FREQ=WEEKLY;BYDAY=MO,WE,FR", "toda segunda, quarta e sexta"),
            ("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=5", "a cada 2 meses, no dia 5"),
            ("", "sem recorrência"),
            (None, "sem recorrência"),
        ],
    )
    def test_redacao(self, rrule, esperado):
        assert descreve_rrule(rrule) == esperado

    def test_regra_desconhecida_volta_como_veio(self):
        """Mentir sobre quando o lançamento cai é pior que mostrar o RRULE cru — é dinheiro."""
        assert descreve_rrule("FREQ=HOURLY;X=1") == "FREQ=HOURLY;X=1"


class TestQueryRecurring:
    @pytest.mark.asyncio
    async def test_data_sai_no_fuso_do_usuario_nao_em_utc(self, monkeypatch):
        """`next_run_at` 05/10 02:00Z é **04/10 às 23:00** em Brasília.

        Formatar o instante cru mostraria 05/10 — um dia a mais, justamente na madrugada em que
        o materializador roda.
        """
        capturado: dict = {}

        async def fetch(query, *args):
            capturado["sql"] = query
            capturado["args"] = args
            return [
                {
                    "kind": "income",
                    "amount_cents": 263200,
                    "description": "Salário CLT",
                    "category": "salário",
                    "rrule": "FREQ=MONTHLY;BYMONTHDAY=5",
                    "next_run_at": datetime(2026, 10, 5, 2, 0, tzinfo=UTC),
                    "end_date": None,
                    "active": True,
                }
            ]

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_recurring(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_RECURRING))

        assert "04/10/2026" in r.message
        assert "05/10/2026" not in r.message
        assert "todo dia 5" in r.message
        assert "R$ 2.632,00" in r.message
        assert r.read_only is True

    @pytest.mark.asyncio
    async def test_escopo_por_workspace(self, monkeypatch):
        """O serviço conecta com papel que IGNORA RLS: o filtro é esta linha ou nada."""
        capturado: dict = {}

        async def fetch(query, *args):
            capturado["sql"] = query
            capturado["args"] = args
            return []

        monkeypatch.setattr(db, "fetch", fetch)
        await queries.query_recurring(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_RECURRING))
        assert "workspace_id = %s" in capturado["sql"]
        assert capturado["args"][0] == WS

    @pytest.mark.asyncio
    async def test_separa_entra_de_sai_e_lista_pausadas(self, monkeypatch):
        async def fetch(query, *args):
            base = {
                "category": None,
                "rrule": "FREQ=MONTHLY;BYMONTHDAY=5",
                "next_run_at": datetime(2026, 10, 5, 15, 0, tzinfo=UTC),
                "end_date": None,
            }
            return [
                {**base, "kind": "income", "amount_cents": 100, "description": "Salário", "active": True},
                {**base, "kind": "expense", "amount_cents": 200, "description": "Aluguel", "active": True},
                {**base, "kind": "expense", "amount_cents": 300, "description": "Academia", "active": False},
            ]

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_recurring(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_RECURRING))
        assert "*Entra*" in r.message and "Salário" in r.message
        assert "*Sai*" in r.message and "Aluguel" in r.message
        assert "Pausadas" in r.message and "Academia" in r.message

    @pytest.mark.asyncio
    async def test_a_janela_anunciada_SAI_do_materializador(self, monkeypatch):
        """A frase não pode cravar o número da janela.

        Ela dizia "próximos 90 dias" com um comentário logo acima avisando que a janela vem de
        `HORIZON_DAYS` — e quando o horizonte virou um ano (10/09/2026) a mensagem teria
        continuado prometendo 90 dias. Anúncio ao usuário que repete uma constante de cabeça é
        a constante com duas cópias: uma delas envelhece calada.
        """
        from app.jobs.scheduler import HORIZON_DAYS

        async def fetch(query, *args):
            return [
                {
                    "category": None,
                    "rrule": "FREQ=MONTHLY;BYMONTHDAY=5",
                    "next_run_at": datetime(2026, 10, 5, 15, 0, tzinfo=UTC),
                    "end_date": None,
                    "kind": "income",
                    "amount_cents": 100,
                    "description": "Salário",
                    "active": True,
                }
            ]

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_recurring(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_RECURRING))
        assert f"{HORIZON_DAYS // 30} meses" in r.message
        # O horizonte precisa cobrir um ano inteiro: é o que faz "outubro de 2027" ter
        # salário e conta fixa em vez de um mês vazio com só as parcelas.
        assert HORIZON_DAYS >= 365

    @pytest.mark.asyncio
    async def test_sem_series_ensina_a_frase(self, monkeypatch):
        async def fetch(query, *args):
            return []

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_recurring(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_RECURRING))
        assert "aluguel" in r.message.lower()


class TestQueryDebts:
    @pytest.mark.asyncio
    async def test_taxa_em_porcentagem_com_virgula(self, monkeypatch):
        """`interest_rate_monthly` é FRAÇÃO: 0.0199 é 1,99% a.m., não 0,02%."""

        async def fetch(query, *args):
            return [
                {
                    "name": "Empréstimo Nubank",
                    "kind": "loan",
                    "remaining_cents": 1248000,
                    "principal_cents": 2000000,
                    "installment_cents": 78164,
                    "interest_rate_monthly": 0.0199,
                    "installments": 32,
                    "installments_paid": 16,
                    "due_day": 4,
                }
            ]

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_debts(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_DEBTS))
        assert "1,99% a.m." in r.message
        assert "R$ 12.480,00" in r.message
        assert "16 de 32 pagas" in r.message
        assert "vence dia 4" in r.message
        assert r.read_only is True

    @pytest.mark.asyncio
    async def test_escopo_e_arquivadas_fora(self, monkeypatch):
        capturado: dict = {}

        async def fetch(query, *args):
            capturado["sql"] = query
            capturado["args"] = args
            return []

        monkeypatch.setattr(db, "fetch", fetch)
        await queries.query_debts(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_DEBTS))
        assert "workspace_id = %s" in capturado["sql"]
        assert "archived = false" in capturado["sql"]
        assert capturado["args"][0] == WS


class TestQueryReminders:
    @pytest.mark.asyncio
    async def test_23h30_de_brasilia_e_HOJE_nao_amanha(self, monkeypatch):
        """O caso que motivou o teste: 09/09 23h30 em Brasília é 10/09 02h30 em UTC."""

        async def fetch(query, *args):
            return [
                {
                    "title": "Tomar remédio",
                    "next_run_at": datetime(2026, 9, 10, 2, 30, tzinfo=UTC),
                    "recurrence": None,
                    "channel": "push",
                }
            ]

        agora = datetime(2026, 9, 10, 1, 0, tzinfo=UTC)  # 09/09 22h em Brasília
        monkeypatch.setattr(db, "fetch", fetch)
        monkeypatch.setattr(notes, "now_utc", lambda: agora)
        monkeypatch.setattr("app.domain.dates.now_utc", lambda: agora)

        r = await notes.query_reminders(ctx(), NotesAction(type=NotesActionType.QUERY_REMINDERS))
        assert "hoje às 23:30" in r.message
        assert "amanhã" not in r.message

    @pytest.mark.asyncio
    async def test_filtra_por_termo_e_periodo_com_escopo(self, monkeypatch):
        capturado: dict = {}

        async def fetch(query, *args):
            capturado["sql"] = query
            capturado["args"] = args
            return []

        monkeypatch.setattr(db, "fetch", fetch)
        await notes.query_reminders(
            ctx(),
            NotesAction(
                type=NotesActionType.QUERY_REMINDERS,
                search_term="dentista",
                query_from="2026-09-01",
                query_to="2026-09-30",
            ),
        )
        assert "workspace_id = %s" in capturado["sql"]
        assert "active = true" in capturado["sql"]
        assert capturado["args"][0] == WS
        assert "%dentista%" in capturado["args"]

    @pytest.mark.asyncio
    async def test_sem_lembrete_com_termo_repete_o_termo(self, monkeypatch):
        async def fetch(query, *args):
            return []

        monkeypatch.setattr(db, "fetch", fetch)
        r = await notes.query_reminders(
            ctx(), NotesAction(type=NotesActionType.QUERY_REMINDERS, search_term="dentista")
        )
        assert "dentista" in r.message


class TestBuscaPorNome:
    """`search_term` — pergunta específica, resposta específica (09/09/2026).

    Sem isto, "quando cai meu salário?" era respondido com as 16 séries do usuário, quatro
    delas salário. A lista estava certa; a RESPOSTA não estava. Foi o teste 3 do corte do
    WhatsApp, no número do dono do produto.
    """

    @pytest.mark.asyncio
    async def test_termo_vai_parametrizado_e_nao_concatenado(self, monkeypatch):
        """SQL injection não é hipótese aqui: o termo vem do modelo, que lê o texto do usuário."""
        # Guarda TODAS as chamadas: o filtro sem resultado dispara a segunda (a lista inteira),
        # e olhar só a última esconderia justamente a query que carrega o termo.
        chamadas: list[tuple[str, tuple]] = []

        async def fetch(query, *args):
            chamadas.append((query, args))
            return []

        monkeypatch.setattr(db, "fetch", fetch)
        await queries.query_recurring(
            ctx(),
            FinanceQuery(type=FinanceQueryType.QUERY_RECURRING, search_term="'; drop table x --"),
        )
        sql, args = chamadas[0]
        assert "drop table" not in sql
        assert "%'; drop table x --%" in args
        assert "ilike %s" in sql

    @pytest.mark.asyncio
    async def test_filtra_e_ordena_pela_proxima_data(self, monkeypatch):
        """A primeira linha É o 'quando' — por isso a ordem é a do banco, não a de kind."""
        base = {
            "category": None,
            "rrule": "FREQ=MONTHLY;BYMONTHDAY=20",
            "end_date": None,
            "active": True,
            "kind": "income",
        }

        async def fetch(query, *args):
            return [
                {
                    **base,
                    "amount_cents": 114800,
                    "description": "Salário CLT (2ª parte)",
                    "next_run_at": datetime(2026, 9, 20, 15, 0, tzinfo=UTC),
                },
                {
                    **base,
                    "amount_cents": 400000,
                    "description": "Salário PJ",
                    "next_run_at": datetime(2026, 10, 4, 15, 0, tzinfo=UTC),
                },
            ]

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_recurring(
            ctx(), FinanceQuery(type=FinanceQueryType.QUERY_RECURRING, search_term="salário")
        )
        assert "*Salário*" in r.message
        # sem filtro o texto traz os cabeçalhos de bloco; filtrado, eles são ruído
        assert "*Entra*" not in r.message
        assert r.message.index("20/09/2026") < r.message.index("04/10/2026")

    @pytest.mark.asyncio
    async def test_filtro_sem_resultado_cai_na_lista_inteira(self, monkeypatch):
        """"Não achei" sobre algo que existe foi o defeito que criou este tool."""
        chamadas: list[tuple] = []

        async def fetch(query, *args):
            chamadas.append(args)
            if len(chamadas) == 1:
                return []  # o filtro não achou
            return [
                {
                    "kind": "income",
                    "amount_cents": 400000,
                    "description": "Salário PJ",
                    "category": None,
                    "rrule": "FREQ=MONTHLY;BYMONTHDAY=4",
                    "next_run_at": datetime(2026, 10, 4, 15, 0, tzinfo=UTC),
                    "end_date": None,
                    "active": True,
                }
            ]

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_recurring(
            ctx(), FinanceQuery(type=FinanceQueryType.QUERY_RECURRING, search_term="ordenado")
        )
        assert "ordenado" in r.message
        assert "Salário PJ" in r.message
        assert len(chamadas) == 2

    @pytest.mark.asyncio
    async def test_divida_filtrada_nao_mostra_total_de_um_item(self, monkeypatch):
        """Soma de um item é eco, não resumo — mesma régua do card de Cartões."""

        async def fetch(query, *args):
            return [
                {
                    "name": "Carro",
                    "kind": "financing",
                    "remaining_cents": 6088500,
                    "principal_cents": 7128000,
                    "installment_cents": 148500,
                    "interest_rate_monthly": 0,
                    "installments": 48,
                    "installments_paid": 7,
                    "due_day": 23,
                }
            ]

        monkeypatch.setattr(db, "fetch", fetch)
        r = await queries.query_debts(
            ctx(), FinanceQuery(type=FinanceQueryType.QUERY_DEBTS, search_term="carro")
        )
        assert "*Carro*" in r.message
        assert "Total em aberto" not in r.message


def test_resposta_de_consulta_nao_chama_modelo():
    """⚠️ **Consulta responde por template Python — nunca por uma segunda chamada de LLM.**

    `ai-gemini.md` proíbe desde sempre, e mesmo assim `query_transactions` mandava os números já
    lidos do banco de volta para o Gemini só para redigir o texto. O defeito é invisível em
    teste de comportamento (a resposta continua "bonita") e caro de duas formas: gasta cota e
    põe descrição de lançamento — texto de TERCEIRO, vindo da importação de extrato — dentro de
    um prompt.

    A trava é estrutural porque o sintoma não aparece em asserção de conteúdo: se
    `app/tools/queries.py` voltar a importar o cliente do modelo, isto quebra.
    """
    import inspect
    from pathlib import Path

    from app.domain.query_text import format_query_response

    fonte = Path(__file__).resolve().parents[1] / "app" / "tools" / "queries.py"
    assert "services.gemini" not in fonte.read_text(), (
        "queries.py voltou a importar o cliente do Gemini"
    )
    assert not inspect.iscoroutinefunction(format_query_response), (
        "o formatador virou async — sinal de que alguém pôs um await de modelo dentro dele"
    )
