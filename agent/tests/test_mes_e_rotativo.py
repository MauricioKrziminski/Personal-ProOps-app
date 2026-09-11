"""Mudar o mês financeiro e ligar o rotativo pelo agente.

Duas lacunas de paridade que não estavam declaradas: `useSetCycleCloseDay` e os
campos de rotativo do cartão. Nenhuma das duas custou schema — `resource` é
string validada contra o `CATALOG`, então recurso e coluna novos são de graça.
"""

import pytest

from app.graph.schemas import ResourceAction, ResourceActionType as Op, ResourceField
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

WS = "22222222-2222-2222-2222-222222222222"
DONO = "11111111-1111-1111-1111-111111111111"
OUTRO = "99999999-9999-9999-9999-999999999999"


def _ctx(user_id=DONO):
    return ExecContext(user_id, WS, None, "America/Sao_Paulo", "meu mes fecha dia 10", "app:1")


def _acao(dia="10"):
    return ResourceAction(
        type=Op.UPDATE, resource="mes",
        fields=[ResourceField(name="cycle_close_day", value=dia)],
    )


def _banco(monkeypatch, *, owner=DONO, atualiza=True):
    escritas = []

    async def fetch_one(sql, *args):
        if "select owner_id" in sql:
            return {"owner_id": owner, "cycle_close_day": None, "row_version": "42"}
        if sql.strip().startswith("update public.workspaces"):
            escritas.append(args)
            return {"cycle_close_day": args[0]} if atualiza else None
        return None

    async def cycle(ws, dia):
        from datetime import date
        return {"ini": date(2026, 8, 11), "fim": date(2026, 9, 10),
                "close_day": 10, "rotulo": "setembro", "dias_ate_o_fim": 1}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resources.db, "cycle", cycle)
    return escritas


# --- o mês -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_dono_muda_o_dia_e_ve_as_bordas_novas(monkeypatch):
    escritas = _banco(monkeypatch)
    prep = await resources.prepare(_ctx(), _acao("10"))
    assert "dia 10" in prep["summary"]

    ctx = _ctx()
    ctx.target = {"prepared": prep}
    r = await resources.execute(ctx, _acao("10"))
    assert "fecha todo dia 10" in r.message
    assert "11/08/2026" in r.message and "10/09/2026" in r.message, "diz as bordas novas"
    assert escritas and escritas[0][0] == 10


@pytest.mark.asyncio
async def test_vazio_volta_para_o_ultimo_dia_do_mes(monkeypatch):
    _banco(monkeypatch)
    acao = ResourceAction(type=Op.UPDATE, resource="mes",
                          fields=[ResourceField(name="cycle_close_day", value=None)])
    prep = await resources.prepare(_ctx(), acao)
    assert "último dia" in prep["summary"]


@pytest.mark.asyncio
async def test_quem_nao_e_dono_nao_muda_o_mes_de_todo_mundo(monkeypatch):
    """O agente IGNORA RLS: sem esta checagem, um membro move a régua de todos."""
    escritas = _banco(monkeypatch, owner=OUTRO)
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(user_id=DONO), _acao("10"))
    assert "dono" in str(err.value).lower()
    assert not escritas


@pytest.mark.asyncio
async def test_o_update_repete_o_dono_no_where(monkeypatch):
    """A checagem do prepare vale para o instante da proposta, não o da escrita."""
    escritas = _banco(monkeypatch)
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, _acao("10"))}
    await resources.execute(ctx, _acao("10"))
    assert DONO in [str(a) for a in escritas[0]], "owner_id tem que estar no WHERE"
    assert "42" in [str(a) for a in escritas[0]], "e a versão da linha também"


@pytest.mark.asyncio
async def test_proposta_velha_nao_escreve(monkeypatch):
    _banco(monkeypatch, atualiza=False)
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, _acao("10"))}
    r = await resources.execute(ctx, _acao("10"))
    assert r.read_only and "de novo" in r.message


@pytest.mark.asyncio
async def test_o_mes_nao_se_cria_nem_se_apaga(monkeypatch):
    _banco(monkeypatch)
    for op in (Op.CREATE, Op.DELETE):
        with pytest.raises(Level1Error):
            await resources.prepare(_ctx(), ResourceAction(
                type=op, resource="mes",
                fields=[ResourceField(name="cycle_close_day", value="10")]))


@pytest.mark.parametrize("dia", ["0", "29", "31", "banana"])
def test_dia_fora_de_1_a_28_e_recusado(dia):
    """29, 30 e 31 não existem em fevereiro — o ciclo mudaria de tamanho."""
    with pytest.raises(Level1Error):
        resources.validate_fields(_acao(dia))


@pytest.mark.parametrize("dia,esperado", [("1", 1), ("28", 28), ("10", 10)])
def test_dias_validos_passam(dia, esperado):
    assert resources.validate_fields(_acao(dia))["cycle_close_day"] == esperado


# --- o rotativo ------------------------------------------------------------

def _cartao(campo, valor):
    return ResourceAction(type=Op.UPDATE, resource="cards", name="nubank",
                          fields=[ResourceField(name=campo, value=valor)])


def test_rotativo_auto_e_booleano():
    assert resources.validate_fields(_cartao("rotativo_auto", "true"))["rotativo_auto"] is True
    assert resources.validate_fields(_cartao("rotativo_auto", "false"))["rotativo_auto"] is False


@pytest.mark.parametrize("entrada,esperado", [
    ("15,5", "0.155"), ("12,876", "0.12876"), ("15.5%", "0.155"), ("0.155", "0.155"),
])
def test_taxa_do_rotativo_aceita_porcento(entrada, esperado):
    assert resources.validate_fields(_cartao("rotativo_rate_monthly", entrada))["rotativo_rate_monthly"] == esperado


def test_taxa_do_rotativo_pode_ficar_vazia():
    """`null` = não estimar juros, e a tela diz isso. Apagar é operação legítima."""
    assert resources.validate_fields(_cartao("rotativo_rate_monthly", None))["rotativo_rate_monthly"] is None
