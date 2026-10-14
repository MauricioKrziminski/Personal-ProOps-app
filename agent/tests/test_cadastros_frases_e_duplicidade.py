"""14/10/2026 — staging, chat real: série em dobro, lembrete pendente engolindo pedido novo, RRULE e enum
crus na frase do SIM, "às 00:00" em lançamento recorrente."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.graph import nodes
from app.graph.schemas import (
    NotesAction, NotesPlan, ResourceAction, ResourceField, ResourcePlan,
)
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

SP = "America/Sao_Paulo"
HOJE = datetime(2026, 10, 14, 15, 0, tzinfo=UTC)


class _Modelo:
    def __init__(self, saida):
        self.saida = saida

    async def ainvoke(self, _mensagens):
        return self.saida


def acao(resource, op="resource_create", name="x", **campos):
    return ResourceAction(type=op, resource=resource, name=name,
                          fields=[ResourceField(name=k, value=str(v)) for k, v in campos.items()])


@pytest.fixture
def ctx(monkeypatch):
    async def fetch(*_a):
        return []

    monkeypatch.setattr(resources.db, "fetch", fetch)
    monkeypatch.setattr(resources, "now_utc", lambda: HOJE)
    return ExecContext("user", "workspace", None, SP, "x", "app:1")


# --- 1. série em dobro -------------------------------------------------------------------------


async def _cadastros(monkeypatch, plano, domains):
    monkeypatch.setattr(nodes.ia, "structured", lambda *_a, **_k: _Modelo(plano))

    async def prepara(_ctx, a):
        return {"summary": a.name}

    monkeypatch.setattr(resources, "prepare", prepara)
    return await nodes.resource_node({
        "user_id": "u", "workspace_id": "w", "phone": None, "timezone": SP, "text": "x",
        "source_message_id": "app:1", "messages": [], "domains": domains,
    })


async def test_serie_nova_de_gasto_tem_um_dono_so_com_financas(monkeypatch):
    uber = acao("recurring", name="uber", kind="expense", amount_cents=3000, rrule="FREQ=MONTHLY;BYMONTHDAY=14")
    antiga = acao("recurring", "resource_update", name="netflix", amount_cents=5590)
    saida = await _cadastros(monkeypatch, ResourcePlan(actions=[uber, antiga]), ["financas", "cadastros"])
    assert [a["name"] for a in saida["resource_actions"]] == ["netflix"]  # criar sai; editar fica


async def test_transferencia_recorrente_continua_sendo_dos_cadastros(monkeypatch):
    transf = acao("recurring", name="reserva", kind="transfer", amount_cents=50000)
    saida = await _cadastros(monkeypatch, ResourcePlan(actions=[transf]), ["financas", "cadastros"])
    assert [a["name"] for a in saida["resource_actions"]] == ["reserva"]


async def test_cadastros_sozinho_cria_a_serie(monkeypatch):
    netflix = acao("recurring", name="netflix", kind="expense", amount_cents=5590)
    saida = await _cadastros(monkeypatch, ResourcePlan(actions=[netflix]), ["cadastros"])
    assert len(saida["resource_actions"]) == 1


# --- 2. lembrete pendente ----------------------------------------------------------------------


@pytest.fixture
def notas(monkeypatch):
    async def sem_pastas(_ws):
        return []

    async def sem_regra(_ws, _a):
        return None

    monkeypatch.setattr(nodes, "_pastas_do_workspace", sem_pastas)
    monkeypatch.setattr(nodes, "_congela_pasta_da_regra", sem_regra)

    def com(*acoes):
        monkeypatch.setattr(nodes.ia, "structured", lambda *_a, **_k: _Modelo(NotesPlan(actions=list(acoes))))

    return com


PENDENTE = {"type": "create_reminder", "content": "pagar o aluguel", "remind_at": "2026-11-05",
            "recurrence": "FREQ=MONTHLY;BYMONTHDAY=5", "_pergunta": "Que horas?"}


def estado(texto):
    return {"workspace_id": "w1", "timezone": SP, "text": texto, "messages": None, "notes_draft": [PENDENTE]}


async def test_lembrete_novo_nao_herda_data_nem_repeticao_do_pendente(notas):
    notas(NotesAction(type="create_reminder", content="tomar o remédio", remind_at="2026-10-14T08:00:00"))
    ret = await nodes.notes_node(estado("me lembra hoje as 8 da manha de tomar o remedio"))
    ret_acoes = ret["notes_actions"]
    # 08:00 de hoje já passou (hoje real do teste pode variar): o essencial é NUNCA virar 05/11 repetindo
    for a in ret_acoes:
        assert a["recurrence"] is None and "2026-11-05" not in (a["remind_at"] or "")
    for d in ret["notes_draft"]:
        assert d["recurrence"] is None and "2026-11-05" not in (d["remind_at"] or "")
    assert any("Deixei de lado o lembrete de *pagar o aluguel*" in r for r in ret["results"])
    # e em `avisos`: com SIM, `results` não aparece; o aviso vai antes da pergunta
    assert ret["avisos"] == ["Deixei de lado o lembrete de *pagar o aluguel*, que estava sem hora."]


async def test_resposta_so_com_a_hora_completa_o_pendente(notas):
    notas(NotesAction(type="create_reminder", remind_at="09:00"))
    ret = await nodes.notes_node(estado("às 9"))
    (a,) = ret["notes_actions"]
    assert a["content"] == "pagar o aluguel" and a["recurrence"] == PENDENTE["recurrence"]
    assert a["remind_at"].startswith("2026-11-05T09:00")
    assert not any("Deixei de lado" in r for r in ret.get("results", []))


async def test_resposta_com_o_mesmo_texto_normalizado_ainda_completa(notas):
    notas(NotesAction(type="create_reminder", content="Pagar o Aluguel", remind_at="09:00"))
    ret = await nodes.notes_node(estado("às 9"))
    assert ret["notes_actions"][0]["recurrence"] == PENDENTE["recurrence"]


# --- 3. série criada pelo cadastro -------------------------------------------------------------


async def test_serie_futura_diz_frequencia_em_palavras_e_so_a_data(ctx):
    p = await resources.prepare(ctx, acao("recurring", name="Netflix", kind="expense", amount_cents=5590,
                                          description="Netflix", rrule="FREQ=MONTHLY;BYMONTHDAY=5",
                                          dtstart="2026-11-05"))
    s = p["summary"]
    assert "frequência: todo dia 5" in s and "FREQ=" not in s
    assert "primeira ocorrência: 05/11/2026" in s and "às 00:00" not in s
    assert "próximo envio" not in s and "próxima:" not in s  # a próxima é a própria primeira


async def test_serie_com_inicio_passado_pergunta_se_entra_como_paga(ctx):
    a = acao("recurring", name="Academia", kind="expense", amount_cents=12000, description="Academia",
             rrule="FREQ=MONTHLY;BYMONTHDAY=20", dtstart="2026-09-20")
    with pytest.raises(Level1Error) as e:
        await resources.prepare(ctx, a)
    m = e.value.mensagem_usuario
    assert "20/09/2026" in m and "já passou" in m and "entra como paga" in m and "Ainda não salvei" in m


async def test_varias_passadas_perguntam_uma_vez_com_a_contagem(ctx):
    a = acao("recurring", name="Academia", kind="expense", amount_cents=12000, description="Academia",
             rrule="FREQ=MONTHLY;BYMONTHDAY=20", dtstart="2026-07-20")
    with pytest.raises(Level1Error) as e:
        await resources.prepare(ctx, a)
    assert "3 ocorrências" in e.value.mensagem_usuario  # 20/07, 20/08, 20/09


async def test_resposta_da_pergunta_fecha_a_frase_com_a_proxima_futura(ctx):
    p = await resources.prepare(ctx, acao(
        "recurring", name="Academia", kind="expense", amount_cents=12000, description="Academia",
        rrule="FREQ=MONTHLY;BYMONTHDAY=20", dtstart="2026-09-20", auto_confirm="true"))
    s = p["summary"]
    assert "primeira ocorrência: 20/09/2026" in s and "próxima: 20/10/2026" in s
    assert "entra como pago na data: sim" in s and "às 00:00" not in s and "próximo envio" not in s


async def test_inicio_hoje_nao_pergunta(ctx):
    await resources.prepare(ctx, acao("recurring", name="Aluguel", kind="expense", amount_cents=100000,
                                      description="Aluguel", rrule="FREQ=MONTHLY;BYMONTHDAY=14",
                                      dtstart="2026-10-14"))


# --- 4. enum cru -------------------------------------------------------------------------------


async def test_dividas_dizem_o_modo_com_as_palavras_do_app(ctx):
    p = await resources.prepare(ctx, acao("debts", name="Carro", kind="financing", calculation_mode="amortized",
                                          principal_cents=5000000, remaining_cents=4000000,
                                          interest_rate_monthly="1,99", installments=48, installments_paid=0, due_day=10))
    assert "modo de cálculo: com juros ao mês" in p["summary"] and "amortized" not in p["summary"]


def test_todo_valor_de_enum_tem_rotulo_em_portugues():
    for (recurso, campo), valores in resources.ENUMS.items():
        sem = [v for v in valores if v not in resources.ROTULO_DE_ENUM and campo != "color"]
        assert not sem, (recurso, campo, sem)


def test_aviso_vai_antes_da_pergunta_do_sim():
    from app.conversation import _com_avisos

    botoes = {"body": "Confirma X?", "text": "Confirma X?\nResponde SIM", "buttons": [1]}
    com = _com_avisos(botoes, ["Deixei de lado Y."])
    assert com["body"].startswith("Deixei de lado Y.\n\nConfirma X?") and com["buttons"] == [1]
    assert com["text"].startswith("Deixei de lado Y.")
    assert _com_avisos("Confirma X?", ["A."]) == "A.\n\nConfirma X?"
    assert _com_avisos(botoes, []) is botoes
