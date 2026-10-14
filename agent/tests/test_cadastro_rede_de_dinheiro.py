"""15/10/2026 — cadastros: nome só em `fields` e saldo/limite/alvo omitidos pelo modelo.

O modelo interpreta; o código lê QUANTO é o dinheiro (UM valor claro) e o que não é claro vira pergunta."""

from __future__ import annotations

import pytest

from app.graph.schemas import ResourceAction, ResourceField
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

SP = "America/Sao_Paulo"


def acao(resource, name=None, op="resource_create", **campos):
    return ResourceAction(type=op, resource=resource, name=name,
                          fields=[ResourceField(name=k, value=str(v)) for k, v in campos.items()])


def contexto(texto):
    return ExecContext("user", "workspace", None, SP, texto, "app:1")


@pytest.fixture(autouse=True)
def banco(monkeypatch):
    async def fetch(*_a):
        return []

    monkeypatch.setattr(resources.db, "fetch", fetch)


# --- nome só em `fields` ----------------------------------------------------------------------


async def test_nome_so_em_fields_vira_o_nome_da_acao_e_da_frase():
    a = ResourceAction(type="resource_create", resource="cards", name=None, fields=[
        ResourceField(name="name", value="Inter"), ResourceField(name="closing_day", value="5"),
        ResourceField(name="due_day", value="12")])
    p = await resources.prepare(contexto("crie o cartão Inter"), a)
    assert a.name == "Inter"
    assert p["summary"].startswith("criar cartão Inter")
    assert "nome:" not in p["summary"]  # nada de "criar cartão — nome: Inter"


async def test_nome_da_acao_continua_valendo_quando_existe():
    a = ResourceAction(type="resource_create", resource="accounts", name="Reserva", fields=[
        ResourceField(name="type", value="savings")])
    p = await resources.prepare(contexto("conta Reserva poupança"), a)
    assert a.name == "Reserva" and p["summary"].startswith("criar conta Reserva")


# --- saldo / limite / alvo omitidos ---------------------------------------------------------


async def test_saldo_por_extenso_entra_na_frase_da_conta():
    a = acao("accounts", "Reserva", type="savings")
    p = await resources.prepare(contexto("É poupança, começa com trezentos reais"), a)
    assert p["values"]["initial_balance_cents"] == 30_000
    assert "R$ 300,00" in p["summary"]


async def test_saldo_que_o_modelo_disse_nao_e_trocado_pelo_texto():
    a = acao("accounts", "Reserva", type="savings", initial_balance_cents=50_000)
    p = await resources.prepare(contexto("começa com trezentos reais"), a)
    assert p["values"]["initial_balance_cents"] == 50_000


async def test_sem_dinheiro_na_frase_o_saldo_continua_zero_e_aparece():
    a = acao("accounts", "Reserva", type="savings")
    p = await resources.prepare(contexto("crie uma conta Reserva poupança"), a)
    assert p["values"]["initial_balance_cents"] == 0 and "R$ 0,00" in p["summary"]


@pytest.mark.parametrize("texto", [
    "começa com 300 e depois entram 500",   # dois valores
    "começa com uns trezentos",             # vago
    "começa com 2026",                      # parece ano, sem R$/reais
])
async def test_saldo_ambiguo_pergunta_e_nao_salva(texto):
    a = acao("accounts", "Reserva", type="savings")
    with pytest.raises(Level1Error) as erro:
        await resources.prepare(contexto(texto), a)
    assert "saldo inicial" in erro.value.mensagem_usuario and "Reserva" in erro.value.mensagem_usuario
    assert not any(f.name == "initial_balance_cents" for f in a.fields)


async def test_numero_no_nome_nao_e_saldo():
    a = acao("accounts", "Inter 2", type="checking")
    p = await resources.prepare(contexto("crie a conta Inter 2"), a)
    assert p["values"]["initial_balance_cents"] == 0


async def test_ano_com_reais_e_saldo():
    a = acao("accounts", "Caixa", type="cash")
    p = await resources.prepare(contexto("começa com 2000 reais"), a)
    assert p["values"]["initial_balance_cents"] == 200_000


async def test_limite_do_cartao_ignora_os_dias_e_le_um_valor():
    a = acao("cards", "Inter", closing_day=5, due_day=12)
    p = await resources.prepare(contexto("cartão Inter fecha 5 vence 12 limite de 3 mil"), a)
    assert p["values"]["credit_limit_cents"] == 300_000


async def test_cartao_sem_valor_nao_inventa_limite():
    a = acao("cards", "Inter", closing_day=5, due_day=12)
    p = await resources.prepare(contexto("cartão Inter fecha 5 vence 12"), a)
    assert "credit_limit_cents" not in p["values"]


async def test_meta_sem_alvo_usa_o_valor_dito_por_extenso():
    a = acao("goals", "Viagem")
    p = await resources.prepare(contexto("meta Viagem de cinco mil reais"), a)
    assert p["values"]["target_cents"] == 500_000


async def test_meta_com_dois_valores_cai_na_pergunta_de_campo_faltante():
    a = acao("goals", "Viagem")
    with pytest.raises(Level1Error) as erro:
        await resources.prepare(contexto("meta Viagem de 5000 com 300 por mês"), a)
    assert "meta" in erro.value.mensagem_usuario and "Ainda não salvei" in erro.value.mensagem_usuario


async def test_conta_que_existe_nao_ganha_saldo_do_texto():
    # a rede é só de CRIAR: editar o saldo tem o fluxo próprio (saldo atual)
    a = ResourceAction(type="resource_update", resource="accounts", name="Reserva", fields=[
        ResourceField(name="type", value="savings")])
    antes = list(a.fields)
    resources._completar_valor_dito(contexto("com 300 reais"), a)
    assert a.fields == antes


async def test_rascunho_de_duas_voltas_conserva_o_saldo_da_resposta(monkeypatch):
    # volta 1: sem tipo -> pergunta; volta 2 ("poupança, 300 reais") o modelo devolve só o tipo
    primeira = acao("accounts", "Reserva")
    with pytest.raises(Level1Error):
        await resources.prepare(contexto("Crie uma conta Reserva"), primeira)
    from app.graph.nodes import _com_campos_do_rascunho
    rascunho = [{**primeira.model_dump(mode="json"), "_pergunta": "tipo?"}]
    segunda = _com_campos_do_rascunho([acao("accounts", "Reserva", type="savings")], rascunho)[0]
    p = await resources.prepare(contexto("É poupança, começa com trezentos reais"), segunda)
    assert p["values"]["initial_balance_cents"] == 30_000 and "R$ 300,00" in p["summary"]
