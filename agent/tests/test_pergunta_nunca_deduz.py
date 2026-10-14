"""14/10/2026 — "sempre pergunte e nunca deduza": lembrete sem hora, recorrente com data dita,
parcela atual que não cabe e conversão de dívida sem parcela viram PERGUNTA antes do SIM. Só o banco e o modelo são dublês."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.domain.dates import now_utc, tz
from app.domain.recurrence import primeira_da_recorrencia
from app.graph import nodes, policy
from app.graph.schemas import (
    Domain, FinanceAction, NotesAction, NotesPlan, RouterDecision,
)
from app.tools import finance, notes, resolve
from app.tools.base import ExecContext

SP = "America/Sao_Paulo"


def _dia(n: int) -> str:
    return (datetime.now(tz(SP)) + timedelta(days=n)).date().isoformat()


class _Modelo:
    def __init__(self, saida):
        self.saida, self.vistas = saida, []

    async def ainvoke(self, mensagens):
        self.vistas.append(mensagens)
        return self.saida


@pytest.fixture
def notas(monkeypatch):
    """`notes_node` com o modelo e o banco (pastas, regra) substituídos."""
    async def sem_pastas(_ws):
        return []

    async def sem_regra(_ws, _a):
        return None

    monkeypatch.setattr(nodes, "_pastas_do_workspace", sem_pastas)
    monkeypatch.setattr(nodes, "_congela_pasta_da_regra", sem_regra)

    def com(*acoes):
        modelo = _Modelo(NotesPlan(actions=list(acoes)))
        monkeypatch.setattr(nodes.ia, "structured", lambda *_a, **_k: modelo)
        return modelo

    return com


def lembrete(**kw):
    return NotesAction(type="create_reminder", **{"content": "ligar pro dentista", **kw})


def estado(texto, **kw):
    return {"workspace_id": "w1", "timezone": SP, "text": texto, "messages": None, **kw}


# --- Tarefa A: lembrete ------------------------------------------------------------------------


async def test_so_data_pergunta_a_hora_e_nao_propoe(notas):
    notas(lembrete(remind_at=_dia(1)))
    ret = await nodes.notes_node(estado("me lembra de ligar pro dentista amanhã"))
    assert ret["notes_actions"] == []
    (pendente,) = ret["notes_draft"]
    assert pendente["content"] == "ligar pro dentista" and pendente["remind_at"] == _dia(1)
    assert pendente["_pergunta"].startswith("Que horas eu te lembro de *ligar pro dentista* amanhã (")
    assert ret["results"] == [pendente["_pergunta"]]


async def test_resposta_so_com_a_hora_completa_o_pendente(notas):
    pendente = {"type": "create_reminder", "content": "ligar pro dentista", "remind_at": _dia(1),
                "_pergunta": "Que horas?"}
    modelo = notas(NotesAction(type="create_reminder", remind_at="09:00"))  # o modelo devolveu só a hora
    ret = await nodes.notes_node(estado("às 9", notes_draft=[pendente]))
    (acao,) = ret["notes_actions"]
    assert acao["content"] == "ligar pro dentista" and acao["remind_at"] == f"{_dia(1)}T09:00:00"
    assert ret["notes_draft"] == [] and "results" not in ret
    # o modelo recebeu a pergunta pendente como contexto da RESPOSTA
    humano = modelo.vistas[0][1][1]
    assert "Você perguntou ao usuário" in humano and "Que horas?" in humano
    from app.graph.schemas import NotesAction as NA
    frase = policy.describe_for_confirmation(NA(**acao), None, _dia(0))
    assert frase.endswith("para amanhã às 09:00") and "ligar pro dentista" in frase


async def test_resposta_com_a_data_completa_vence(notas):
    pendente = {"type": "create_reminder", "content": "pagar IPTU", "remind_at": _dia(3), "_pergunta": "?"}
    notas(lembrete(content="pagar IPTU", remind_at=f"{_dia(3)}T14:30:00"))
    ret = await nodes.notes_node(estado("14h30", notes_draft=[pendente]))
    assert ret["notes_actions"][0]["remind_at"] == f"{_dia(3)}T14:30:00"


async def test_passado_sem_repeticao_pergunta(notas):
    notas(lembrete(remind_at="2020-01-01T08:00:00"))
    ret = await nodes.notes_node(estado("me lembra"))
    assert ret["notes_actions"] == [] and "já passou" in ret["results"][0]


async def test_rrule_invalida_pergunta_como_se_repete(notas):
    notas(lembrete(remind_at=f"{_dia(1)}T09:00:00", recurrence="TODO DIA QUE DEUS FAZ"))
    ret = await nodes.notes_node(estado("todo dia"))
    assert ret["notes_actions"] == [] and "se repete" in ret["results"][0]


async def test_recorrente_sem_hora_pergunta_a_hora(notas):
    notas(lembrete(content="aluguel", recurrence="FREQ=MONTHLY;BYMONTHDAY=5"))
    ret = await nodes.notes_node(estado("todo dia 5 me lembra do aluguel"))
    assert ret["notes_actions"] == []
    assert ret["results"][0].startswith("Que horas eu te lembro de *aluguel* todo dia 5")


async def test_recorrente_com_hora_toca_na_primeira_ocorrencia_naquela_hora(notas):
    notas(lembrete(content="aluguel", remind_at=f"{_dia(0)}T09:00:00", recurrence="FREQ=MONTHLY;BYMONTHDAY=5"))
    ret = await nodes.notes_node(estado("todo dia 5 às 9 me lembra do aluguel"))
    (acao,) = ret["notes_actions"]
    quando = datetime.fromisoformat(acao["remind_at"]).replace(tzinfo=tz(SP))
    assert (quando.hour, quando.minute, quando.day) == (9, 0, 5) and quando.astimezone(tz("UTC")) > now_utc()


async def test_pergunta_repetida_oferece_a_saida(notas):
    pendente = {"type": "create_reminder", "content": "ligar pro dentista", "remind_at": _dia(1),
                "_pergunta": f"Que horas eu te lembro de *ligar pro dentista* amanhã ({_dia(1)[8:]}/{_dia(1)[5:7]})?"}
    notas(lembrete(remind_at=_dia(1)))
    ret = await nodes.notes_node(estado("sei lá", notes_draft=[pendente]))
    assert "Não consegui tirar esse dado" in ret["results"][0] and "*cancela*" in ret["results"][0]
    assert len(ret["notes_draft"]) == 1


async def test_desistir_limpa_o_pendente(notas):
    notas()  # actions vazio
    pendente = {"type": "create_reminder", "content": "x", "remind_at": _dia(1), "_pergunta": "?"}
    ret = await nodes.notes_node(estado("cancela", notes_draft=[pendente]))
    assert ret["notes_draft"] == [] and ret["notes_actions"] == []
    assert "cancelado" in ret["results"][0]


async def test_pedido_novo_de_nota_limpa_o_pendente_e_segue(notas):
    pendente = {"type": "create_reminder", "content": "x", "remind_at": _dia(1), "_pergunta": "?"}
    notas(NotesAction(type="create_note", content="comprar leite"))
    ret = await nodes.notes_node(estado("anota comprar leite", notes_draft=[pendente]))
    assert ret["notes_draft"] == [] and ret["notes_actions"][0]["content"] == "comprar leite"


async def test_roteador_recebe_a_pergunta_como_contexto_e_pedido_novo_limpa_o_pendente(monkeypatch):
    pendente = [{"type": "create_reminder", "content": "x", "remind_at": _dia(1), "_pergunta": "Que horas?"}]
    modelo = _Modelo(RouterDecision(domains=[Domain.NOTAS], confidence=0.9))
    monkeypatch.setattr(nodes.ia, "structured", lambda *_a, **_k: modelo)
    ret = await nodes._rotear_texto(estado("às 9 da manhã, por favor", notes_draft=pendente))
    humano = modelo.vistas[0][1][1]
    assert "Você perguntou ao usuário" in humano and "Que horas?" in humano
    assert ret["domains"] == ["notas"] and "notes_draft" not in ret  # continua pendente

    modelo.saida = RouterDecision(domains=[Domain.FINANCAS], confidence=0.9)
    ret = await nodes._rotear_texto(estado("gastei 20 no café", notes_draft=pendente))
    assert ret["domains"] == ["financas"] and ret["notes_draft"] == []


async def test_roteador_cancela_o_lembrete(monkeypatch):
    pendente = [{"type": "create_reminder", "content": "x", "remind_at": _dia(1), "_pergunta": "Que horas?"}]
    modelo = _Modelo(RouterDecision(domains=[Domain.GERAL], confidence=0.9, discard_resource_draft=True))
    monkeypatch.setattr(nodes.ia, "structured", lambda *_a, **_k: modelo)
    ret = await nodes._rotear_texto(estado("deixa pra lá", notes_draft=pendente))
    assert ret["notes_draft"] == [] and ret["halted"] and "Lembrete cancelado" in ret["results"][0]


def test_tool_recusa_sem_hora_com_a_pergunta():
    import asyncio

    ctx = ExecContext("u", "w", None, SP, "t", "m")
    with pytest.raises(notes.Level1Error, match="Que horas"):
        asyncio.run(notes.create_reminder(ctx, lembrete(remind_at=_dia(2))))


def test_confirmacao_diz_dia_e_hora_no_fuso_da_pessoa(monkeypatch):
    """22h em São Paulo já é o dia seguinte em UTC: a resposta tem que dizer o dia LOCAL e a hora."""
    import asyncio

    async def linha(*_a, **_k):
        return {"id": "r1"}

    monkeypatch.setattr(notes.db, "fetch_one", linha)
    ctx = ExecContext("u", "w", None, SP, "t", "m")
    dia = _dia(2)
    res = asyncio.run(notes.create_reminder(ctx, lembrete(remind_at=f"{dia}T22:00:00")))
    d = datetime.fromisoformat(dia)
    assert f"em {d:%d/%m/%Y} às 22:00" in res.message


# --- A.4: cadastro de lembrete pelo catálogo -------------------------------------------------------


async def test_cadastro_de_lembrete_so_com_data_pergunta_a_hora_e_a_frase_diz_o_canal(monkeypatch):
    from app.graph.schemas import ResourceAction, ResourceField
    from app.tools import resources

    async def vazio(*_a):
        return []

    monkeypatch.setattr(resources.db, "fetch", vazio)
    ctx = ExecContext("u", "w", None, SP, "t", "app:1")

    def acao(valor):
        return ResourceAction(type="resource_create", resource="reminders", name="dentista", fields=[
            ResourceField(name="title", value="dentista"), ResourceField(name="next_run_at", value=valor)])

    with pytest.raises(resources.Level1Error, match="Que horas"):
        await resources.prepare(ctx, acao(_dia(1)))
    pronto = await resources.prepare(ctx, acao(f"{_dia(1)}T09:00:00"))
    assert "canal: notificação no app" in pronto["summary"]
    assert "próximo envio: " + f"{(datetime.now(tz(SP)) + timedelta(days=1)).strftime('%d/%m/%Y')} às 09:00" in pronto["summary"]


async def test_conta_nova_mostra_o_saldo_inicial(monkeypatch):
    from app.graph.schemas import ResourceAction, ResourceField
    from app.tools import resources

    async def vazio(*_a):
        return []

    monkeypatch.setattr(resources.db, "fetch", vazio)
    ctx = ExecContext("u", "w", None, SP, "t", "app:1")
    a = ResourceAction(type="resource_create", resource="accounts", name="Carteira",
                       fields=[ResourceField(name="type", value="cash")])
    pronto = await resources.prepare(ctx, a)
    assert "saldo inicial: R$ 0,00" in pronto["summary"]


# --- Tarefa B: recorrente com data dita ------------------------------------------------------------


def test_data_dita_e_o_inicio_e_sem_data_e_a_proxima():
    regra = "FREQ=MONTHLY;BYMONTHDAY=20"
    dita = primeira_da_recorrencia(regra, _dia(60), SP)
    assert dita.astimezone(tz(SP)).date() >= datetime.now(tz(SP)).date() + timedelta(days=60)
    assert dita.astimezone(tz(SP)).day == 20
    sem = primeira_da_recorrencia(regra, None, SP)
    assert sem > now_utc() and sem.astimezone(tz(SP)).day == 20
    # a data dita que casa com a regra É a primeira
    alvo = (datetime.now(tz(SP)) + timedelta(days=40)).date()
    casa = primeira_da_recorrencia(f"FREQ=MONTHLY;BYMONTHDAY={alvo.day}", alvo.isoformat(), SP)
    assert casa.astimezone(tz(SP)).date() == alvo


async def test_primeira_ocorrencia_congelada_na_frase_e_gravada_pela_tool(monkeypatch):
    alvo = (datetime.now(tz(SP)) + timedelta(days=45)).date()
    acao = FinanceAction(type="create_expense", amount_cents=150000, description="aluguel",
                         occurred_at=alvo.isoformat(), recurrence=f"FREQ=MONTHLY;BYMONTHDAY={alvo.day}")
    (alvo_congelado,) = await resolve.primeira_ocorrencia(SP, [acao], [{}])
    assert alvo_congelado["primeira_dia"] == alvo.isoformat()
    frase = policy.describe_for_confirmation(acao, alvo_congelado, _dia(0))
    assert "se repete todo dia" in frase and f"a partir de {alvo.strftime('%d/%m/%Y')}" in frase

    gravado = {}

    async def inserir(tabela, colunas, *a, **k):
        gravado.update(colunas)
        return {"id": "r1"}

    async def nada(*_a, **_k):
        return None

    async def colunas(*_a, **_k):
        return {}

    monkeypatch.setattr(finance, "_inserir", inserir)
    monkeypatch.setattr(finance, "conta_citada", nada)
    monkeypatch.setattr(finance, "_conta_padrao", nada)
    monkeypatch.setattr(finance, "_detalhe_da_regra", nada)
    monkeypatch.setattr(finance.atributos, "colunas", colunas)
    ctx = ExecContext("u", "w", None, SP, "t", "m", target=alvo_congelado) if "target" in ExecContext.__dataclass_fields__ \
        else ExecContext("u", "w", None, SP, "t", "m")
    ctx.target = alvo_congelado
    await finance.create_transaction(ctx, acao)
    assert gravado["next_run_at"].astimezone(tz(SP)).date() == alvo
    assert gravado["dtstart"] == gravado["next_run_at"]


# --- Tarefa C -----------------------------------------------------------------------------------------


def test_parcela_atual_fora_da_faixa_pergunta_quantas_pagas_e_a_resposta_refaz_a_atual():
    from app.domain import draft
    from app.domain.required import faltando

    acao = FinanceAction(type="create_installment_purchase", amount_cents=300000, installments=10,
                         current_installment=12, account="nubank", description="geladeira")
    slot, pergunta = faltando(acao)
    assert slot == "already_paid_count" and "10 parcelas" in pergunta
    juntado = draft.mesclar(acao.model_dump(mode="json"),
                            {"acao": "completar", "slot": "already_paid_count", "already_paid_count": 3})
    assert juntado["already_paid_count"] == 3 and juntado["current_installment"] == 4
    assert faltando(FinanceAction(**juntado)) is None  # sem loop


def test_lancamento_que_repete_sem_data_comeca_hoje():
    """"gastei 30 de uber e repete todo mês": o de hoje é o primeiro, sempre (antes dependia de o
    modelo preencher a data: 14/10 numa rodada, 14/11 na outra)."""
    hoje = datetime.now(tz(SP)).date()
    assert primeira_da_recorrencia("FREQ=MONTHLY", None, SP).astimezone(tz(SP)).date() == hoje
    # com o dia da regra, é o próximo desse dia a partir de hoje (hoje incluído)
    dia = 28 if hoje.day != 28 else 27
    p = primeira_da_recorrencia(f"FREQ=MONTHLY;BYMONTHDAY={dia}", None, SP).astimezone(tz(SP)).date()
    assert p.day == dia and hoje <= p <= hoje + timedelta(days=31)


async def _grava_serie(monkeypatch, alvo, acao):
    gravado = {}

    async def inserir(tabela, colunas, *a, **k):
        gravado.update(colunas)
        return {"id": "r1"}

    async def nada(*_a, **_k):
        return None

    async def colunas(*_a, **_k):
        return {}

    monkeypatch.setattr(finance, "_inserir", inserir)
    monkeypatch.setattr(finance, "conta_citada", nada)
    monkeypatch.setattr(finance, "_conta_padrao", nada)
    monkeypatch.setattr(finance, "_detalhe_da_regra", nada)
    monkeypatch.setattr(finance.atributos, "colunas", colunas)
    ctx = ExecContext("u", "w", None, SP, "t", "m")
    ctx.target = alvo
    await finance.create_transaction(ctx, acao)
    return gravado


@pytest.mark.parametrize("resposta", [True, False])
async def test_serie_comeca_na_data_dita_sem_puxar_para_hoje_e_grava_a_resposta(monkeypatch, resposta):
    inicio = (datetime.now(tz(SP)) - timedelta(days=10)).date()
    regra = f"FREQ=WEEKLY;BYDAY={['MO','TU','WE','TH','FR','SA','SU'][inicio.weekday()]}"
    acao = FinanceAction(type="create_expense", amount_cents=12000, description="academia",
                         occurred_at=inicio.isoformat(), recurrence=regra)
    (alvo,) = await resolve.primeira_ocorrencia(SP, [acao], [{}])
    assert alvo["primeira_dia"] == inicio.isoformat() and len(alvo["passadas"]) == 2
    gravado = await _grava_serie(monkeypatch, {**alvo, "entra_como_pago": resposta}, acao)
    assert gravado["dtstart"].astimezone(tz(SP)).date() == inicio  # as passadas não se perdem
    assert gravado["auto_confirm"] is resposta


async def test_checkpoint_antigo_sem_passadas_nao_pergunta_nem_grava_auto_confirm(monkeypatch):
    from app.graph.nodes import _perguntar_pagas

    futuro = (datetime.now(tz(SP)) + timedelta(days=45)).date()
    acao = FinanceAction(type="create_expense", amount_cents=150000, description="aluguel",
                         occurred_at=futuro.isoformat(), recurrence=f"FREQ=MONTHLY;BYMONTHDAY={futuro.day}")
    antigo = {"primeira_ocorrencia": primeira_da_recorrencia(acao.recurrence, acao.occurred_at, SP).isoformat(),
              "primeira_dia": futuro.isoformat()}
    assert _perguntar_pagas({}, 0, acao, antigo) == (antigo, None)
    assert f"a partir de {futuro.strftime('%d/%m/%Y')}" in policy.describe_for_confirmation(acao, antigo, _dia(0))
    assert "auto_confirm" not in await _grava_serie(monkeypatch, antigo, acao)
