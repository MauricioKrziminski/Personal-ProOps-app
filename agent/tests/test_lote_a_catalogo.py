"""Lote A da paridade com o app: transferência recorrente (F18), encerrar/reabrir série (F18) e
detalhe de categoria pelo NOME (F09). Dublês no lugar do banco: o que se prova é o que o agente
ESCREVE na frase do SIM e que chamada ele faz — não o SQL."""

from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import UUID, uuid5

import pytest

from app.graph.schemas import ResourceAction, ResourceField
from app.tools import resources
from app.tools.base import REQUEST_NAMESPACE, ExecContext
from app.tools.guards import Level1Error

SERIE = "11111111-1111-1111-1111-111111111111"
NUBANK = {"id": "aaaaaaaa-0000-0000-0000-000000000001", "name": "Nubank", "type": "checking"}
POUPANCA = {"id": "aaaaaaaa-0000-0000-0000-000000000002", "name": "Poupança", "type": "savings"}
CARTAO = {"id": "aaaaaaaa-0000-0000-0000-000000000003", "name": "Nubank Cartão", "type": "credit_card"}
CONTAS = [NUBANK, POUPANCA, CARTAO]


def acao(resource="recurring", tipo="resource_create", name="Reserva", **campos):
    return ResourceAction(
        type=tipo, resource=resource, name=name,
        fields=[ResourceField(name=k, value=None if v is None else str(v)) for k, v in campos.items()],
    )


def ctx(**extra):
    return ExecContext("user", "workspace", None, "America/Sao_Paulo", "", "app:msg-1", **extra)


def instala_contas(monkeypatch):
    async def fetch(sql, *args):
        if "from public.accounts" in sql:
            dito = args[1]
            return [c for c in CONTAS if c["id"] == dito or c["name"].lower() == str(dito).lower()]
        return []

    monkeypatch.setattr(resources.db, "fetch", fetch)


TRANSFERENCIA = dict(
    kind="transfer", amount_cents=50000, description="Reserva", rrule="FREQ=MONTHLY;BYMONTHDAY=5",
    dtstart="2099-01-05T09:00", account_id="Nubank", counterparty_account_id="Poupança",
)


# ---------------------------------------------------------------- F18: transferência recorrente


@pytest.mark.asyncio
async def test_transferencia_recorrente_diz_o_efeito_nas_duas_contas(monkeypatch):
    instala_contas(monkeypatch)
    p = await resources.prepare(ctx(), acao(**TRANSFERENCIA))
    assert p["summary"].startswith(
        "criar transferência de R$ 500,00 todo dia 5 da conta Nubank para a conta Poupança"
    )
    assert p["values"]["kind"] == "transfer"
    assert p["values"]["counterparty_account_id"] == POUPANCA["id"]
    assert "category" not in p["values"]


@pytest.mark.asyncio
async def test_transferencia_sem_categoria_mesmo_que_o_modelo_mande(monkeypatch):
    instala_contas(monkeypatch)
    p = await resources.prepare(ctx(), acao(**TRANSFERENCIA, category="moradia"))
    assert "category" not in p["values"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mudanca, trecho",
    [
        ({"counterparty_account_id": "Nubank"}, "diferentes"),
        ({"counterparty_account_id": "Nubank Cartão"}, "não pode ser um cartão"),
        ({"counterparty_account_id": None}, "para qual conta vai"),
        ({"account_id": None}, "de qual conta sai"),
    ],
)
async def test_transferencia_recusa_antes_do_sim(monkeypatch, mudanca, trecho):
    instala_contas(monkeypatch)
    campos = {**TRANSFERENCIA, **mudanca}
    with pytest.raises(Level1Error, match=trecho):
        await resources.prepare(ctx(), acao(**campos))


@pytest.mark.asyncio
@pytest.mark.parametrize("rrule", ["FREQ=DAILY;COUNT=1", "FREQ=WEEKLY", "FREQ=DAILY"])
async def test_transferencia_de_uma_vez_nao_vira_serie(monkeypatch, rrule):
    """O modelo encaixou "transferi 500..." como série com uma regra inventada (medido no Gemini)."""
    instala_contas(monkeypatch)
    with pytest.raises(Level1Error, match="transferi"):
        await resources.prepare(ctx(), acao(**{**TRANSFERENCIA, "rrule": rrule}))


@pytest.mark.asyncio
@pytest.mark.parametrize("rrule", ["FREQ=WEEKLY;BYDAY=MO", "FREQ=MONTHLY;BYMONTHDAY=-1",
                                   "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=10",
                                   "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25"])
async def test_calendarios_da_serie_passam(monkeypatch, rrule):
    instala_contas(monkeypatch)
    p = await resources.prepare(ctx(), acao(**{**TRANSFERENCIA, "rrule": rrule}))
    assert p["summary"].startswith("criar transferência de R$ 500,00")


@pytest.mark.asyncio
async def test_destino_so_existe_em_transferencia(monkeypatch):
    instala_contas(monkeypatch)
    campos = {**TRANSFERENCIA, "kind": "expense"}
    with pytest.raises(Level1Error, match="Só a transferência"):
        await resources.prepare(ctx(), acao(**campos))


@pytest.mark.asyncio
async def test_serie_nao_vira_transferencia_por_edicao(monkeypatch):
    async def fetch(sql, *args):
        return [{"id": SERIE, "row_version": "1", "kind": "expense", "description": "Aluguel"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    # a forma real: o campo `kind` do catálogo, não o tipo da ação
    a = ResourceAction(type="resource_update", resource="recurring", name="Aluguel",
                       fields=[ResourceField(name="kind", value="transfer")])
    with pytest.raises(Level1Error, match="converta o registro"):
        await resources.prepare(ctx(), a)


# ---------------------------------------------------------------- F18: encerrar e reabrir


PREVIA = {
    "removed_count": 2, "removed_cents": 7980, "kept_locked_count": 0, "kept_paid_count": 1,
    "kept_overdue_count": 0, "kept_upcoming_count": 0, "end_date": "2026-10-05",
}


class FakeTx:
    def __init__(self, log, resposta):
        self.log, self.resposta = log, resposta

    async def fetch_one(self, sql, *args):
        self.log.append((sql, args))
        return {"p": self.resposta, "r": self.resposta}


def instala_serie(monkeypatch, log, end_date=None, resposta=PREVIA):
    async def fetch(sql, *args):
        return [{"id": SERIE, "description": "Netflix", "kind": "expense", "active": True,
                 "end_date": end_date, "row_version": "7"}]

    async def fetch_one(sql, *args):
        return {"d": "2026-10-05"}  # a última cobrança que já venceu

    @asynccontextmanager
    async def como_usuario(uid):
        log.append(("como_usuario", (uid,)))
        yield FakeTx(log, resposta)

    monkeypatch.setattr(resources.db, "fetch", fetch)
    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resources.db, "como_usuario", como_usuario)


@pytest.mark.asyncio
async def test_cancelar_assinatura_diz_o_que_fica_e_o_que_sai(monkeypatch):
    log: list = []
    instala_serie(monkeypatch, log)
    p = await resources.prepare(ctx(), acao(tipo="resource_update", name="netflix", encerrar_em=None))
    assert "Ficam 1 paga e 0 atrasadas." in p["summary"]
    assert "Saem 2 cobranças futuras (R$ 79,80)." in p["summary"]
    assert "05/10/2026" in p["summary"]
    assert p["encerrar"] == {"id": SERIE, "last_date": "2026-10-05"}
    assert ("como_usuario", ("user",)) in log
    assert any("end_recurring_series_preview" in sql for sql, _ in log if isinstance(sql, str))


@pytest.mark.asyncio
async def test_encerrar_em_data_dita_usa_a_data_dita(monkeypatch):
    log: list = []
    instala_serie(monkeypatch, log)
    p = await resources.prepare(ctx(), acao(tipo="resource_update", name="netflix", encerrar_em="2026-12-05"))
    assert p["encerrar"]["last_date"] == "2026-12-05"
    previa = [a for sql, a in log if isinstance(sql, str) and "preview" in sql][0]
    assert str(previa[1]) == "2026-12-05"


@pytest.mark.asyncio
async def test_executar_encerramento_usa_chave_da_mensagem_e_o_resultado_do_banco(monkeypatch):
    log: list = []
    instala_serie(monkeypatch, log)
    a = acao(tipo="resource_update", name="netflix", encerrar_em=None)
    p = await resources.prepare(ctx(), a)

    async def dono(*_):
        return None

    monkeypatch.setattr(resources, "ensure_owned", dono)
    log.clear()
    real = {**PREVIA, "removed_count": 1, "removed_cents": 3990}
    instala_serie(monkeypatch, log, resposta=real)
    out = await resources.execute(ctx(target={"prepared": p}), a)
    chamada = [(sql, args) for sql, args in log if isinstance(sql, str) and "end_recurring_series(" in sql]
    assert len(chamada) == 1
    _, args = chamada[0]
    assert args[2] == uuid5(REQUEST_NAMESPACE, "app:msg-1:0")
    assert isinstance(args[2], UUID)
    # a resposta usa os números que o BANCO devolveu ao executar, não os da prévia
    assert "Saem 1 cobrança futura (R$ 39,90)." in out.message


@pytest.mark.asyncio
async def test_reabrir_tira_o_fim(monkeypatch):
    log: list = []
    instala_serie(monkeypatch, log, end_date="2026-10-05")
    a = acao(tipo="resource_update", name="netflix", reabrir="true")
    p = await resources.prepare(ctx(), a)
    assert "reabrir a série *Netflix*" in p["summary"]
    assert "05/10/2026" in p["summary"]

    async def dono(*_):
        return None

    monkeypatch.setattr(resources, "ensure_owned", dono)
    await resources.execute(ctx(target={"prepared": p}), a)
    rpc = [(sql, args) for sql, args in log if isinstance(sql, str) and "update_recurring_series" in sql]
    assert len(rpc) == 1
    assert '"end_date": null' in rpc[0][0] and rpc[0][1] == (SERIE,)


@pytest.mark.asyncio
async def test_reabrir_serie_que_nao_esta_encerrada_nao_faz_nada(monkeypatch):
    instala_serie(monkeypatch, [])
    with pytest.raises(Level1Error, match="não está encerrada"):
        await resources.prepare(ctx(), acao(tipo="resource_update", name="netflix", reabrir="true"))


@pytest.mark.asyncio
async def test_encerrar_nao_mistura_com_outra_edicao_nem_cria():
    with pytest.raises(Level1Error, match="uma coisa por vez"):
        resources.validate_fields(acao(tipo="resource_update", name="netflix",
                                       encerrar_em="2026-12-05", amount_cents=100))
    with pytest.raises(Level1Error, match="que já existe"):
        resources.validate_fields(acao(tipo="resource_create", name="netflix", encerrar_em="2026-12-05"))
    with pytest.raises(Level1Error, match="diga até quando"):
        resources.validate_fields(acao(tipo="resource_update", name="netflix", reabrir="false"))


# ---------------------------------------------------------------- F09: detalhe pelo nome

PAI = "alimentação"
FILHAS = [
    {"id": "bbbbbbbb-0000-0000-0000-000000000001", "name": "feira"},
    {"id": "bbbbbbbb-0000-0000-0000-000000000002", "name": "supermercado"},
    {"id": "bbbbbbbb-0000-0000-0000-000000000003", "name": "supermercado online"},
]


def instala_regra(monkeypatch, filhas=FILHAS):
    async def fetch(sql, *args):
        if "from public.subcategories" in sql and "parent_key = private.fold" in sql:
            return list(filhas)
        if "from public.subcategories where id" in sql:
            return [f for f in filhas if f["id"] == args[0]]
        return [{"id": "cccccccc-0000-0000-0000-000000000001", "row_version": "3", "category": PAI,
                 "pattern": "mercado"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)


def regra(valor):
    return ResourceAction(type="resource_update", resource="rules", name="mercado",
                          fields=[ResourceField(name="subcategory_id", value=valor)])


@pytest.mark.asyncio
async def test_detalhe_pelo_nome_sem_acento_e_sem_caixa(monkeypatch):
    instala_regra(monkeypatch)
    p = await resources.prepare(ctx(), regra("FEIRA"))
    assert p["values"]["subcategory_id"] == FILHAS[0]["id"]
    assert "detalhe: feira" in p["summary"]


@pytest.mark.asyncio
async def test_nome_exato_vence_o_que_so_contem(monkeypatch):
    instala_regra(monkeypatch)
    p = await resources.prepare(ctx(), regra("supermercado"))
    assert p["values"]["subcategory_id"] == FILHAS[1]["id"]


@pytest.mark.asyncio
async def test_detalhe_que_casa_com_duas_pergunta(monkeypatch):
    instala_regra(monkeypatch)
    with pytest.raises(Level1Error, match="mais de um detalhe"):
        await resources.prepare(ctx(), regra("super"))


@pytest.mark.asyncio
async def test_detalhe_que_nao_existe_lista_o_que_existe(monkeypatch):
    instala_regra(monkeypatch)
    with pytest.raises(Level1Error, match="Tenho: feira, supermercado"):
        await resources.prepare(ctx(), regra("padaria"))


@pytest.mark.asyncio
async def test_categoria_sem_detalhes_cadastrados(monkeypatch):
    instala_regra(monkeypatch, filhas=[])
    with pytest.raises(Level1Error, match="ainda não tem detalhes"):
        await resources.prepare(ctx(), regra("feira"))


@pytest.mark.asyncio
async def test_sem_detalhe_remove(monkeypatch):
    instala_regra(monkeypatch)
    p = await resources.prepare(ctx(), regra("sem detalhe"))
    assert p["values"]["subcategory_id"] is None
    assert "Sem detalhe" in p["summary"]
