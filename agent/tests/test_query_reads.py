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
        assert capturado["args"] == (WS,)

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
        assert capturado["args"] == (WS,)


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
