"""As três coisas que o app fazia e o agente não (26/09/2026, "tudo que se cria se edita").

1. "Parcelas já pagas" numa compra que existe — `update_transaction` com `already_paid_count`
   vai pela MESMA `update_installment_plan` do app (9º argumento), para mais ou para menos.
2. Corrigir um APORTE de meta — `resource_update` na meta com os campos virtuais do aporte,
   gravado por `edit_goal_contribution`.
3. Desmarcar a fatura como paga / desfazer o adiamento — `resource_update` no cartão com
   `fatura_paga=false` / `fatura_adiada=false`, pelas RPCs `unsettle_invoice`/`unroll_invoice`.

O banco é dublê; o que se prende é a RPC chamada, os argumentos e a frase do SIM.
"""

from datetime import date
from uuid import UUID

import pytest

from app.graph import policy
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    ResourceAction,
    ResourceActionType,
    ResourceField,
)
from app.tools import finance, resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

WS = UUID("22222222-2222-2222-2222-222222222222")


def _ctx(target=None) -> ExecContext:
    return ExecContext(UUID("11111111-1111-1111-1111-111111111111"), WS, None,
                       "America/Sao_Paulo", "", "w1", target=target)


# ── 1. parcelas já pagas ─────────────────────────────────────────────────────────────────────

def _alvo_plano(**cand):
    base = {"id": "plano-1", "label": "Tudo (10x) — TV", "table": "installment_plans",
            "plan_installments": 10, "total_cents": 300000, "editaveis": 5, "travado_cents": 150000,
            "travadas": 5, "travadas_fatura": 0, "ultima_travada": 5, "pagas": 5, "piso_pagas": 0,
            "account_id": "acc-1"}
    return {"table": "installment_plans", "status": "found", "candidates": [{**base, **cand}]}


def _paga(n):
    return FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, description="tv",
                         already_paid_count=n)


def test_menos_parcelas_pagas_diz_quais_voltam_a_previstas():
    alvo = _alvo_plano()
    assert policy.erro_de_correcao(_paga(2), alvo) is None
    frase = policy.describe_for_confirmation(_paga(2), alvo)
    assert "parcelas pagas 5 → 2" in frase and "as parcelas 3 a 5 voltam a previstas" in frase


def test_mais_parcelas_pagas_diz_quais_recebem_baixa():
    frase = policy.describe_for_confirmation(_paga(6), _alvo_plano())
    assert "parcelas pagas 5 → 6" in frase and "a 6ª recebe baixa" in frase


def test_pagas_abaixo_da_fatura_paga_e_recusado_antes_do_sim():
    erro = policy.erro_de_correcao(_paga(1), _alvo_plano(piso_pagas=3))
    assert erro and "até a 3ª foram pagas junto com a fatura" in erro


def test_pagas_fora_da_faixa_e_recusado():
    erro = policy.erro_de_correcao(_paga(11), _alvo_plano())
    assert erro and "entre 0 e 10" in erro


@pytest.mark.asyncio
async def test_pagas_vao_no_9o_argumento_da_rpc(monkeypatch):
    rpc = []

    async def fetch_one(sql, *args):
        if "update_installment_plan" in sql:
            rpc.append(args)
            return {"mexidas": 3}
        return {"id": "plano-1", "total_cents": 300000, "installments": 10,
                "first_occurred_at": "2026-05-15", "description": "TV", "category": "casa",
                "merchant": None, "account_id": "acc-1", "editaveis": 5,
                "travado_cents": 150000, "travadas": 5, "travadas_fatura": 0,
                "ultima_travada": 5, "pagas": 5, "piso_pagas": 0, "primeira": None}

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    r = await finance.update_transaction(_ctx(_alvo_plano()), _paga(2))
    assert not r.read_only, r.message
    (args,) = rpc
    assert args[0] == "plano-1" and args[2] == 10 and args[8] == 2
    assert "parcelas pagas 5 → 2" in r.message


# ── 2. aporte da meta ────────────────────────────────────────────────────────────────────────
# Mora no cadastro da meta: `update_transaction` com `target_ref` voltava SEM os valores no
# Gemini real, em todas as redações medidas (26/09/2026).

def _aporte(**campos):
    return ResourceAction(type=ResourceActionType.UPDATE, resource="goals", name="viagem",
                          fields=[ResourceField(name=k, value=v) for k, v in campos.items()])


def _banco_da_meta(monkeypatch, aportes, saved=10000):
    async def fetch(sql, *args):
        if "from public.goals" in sql:
            return [{"id": "g1", "name": "Viagem", "saved_cents": saved}]
        return aportes

    monkeypatch.setattr(resources.db, "fetch", fetch)


@pytest.mark.asyncio
async def test_aporte_de_movimentacao_e_recusado_antes_do_sim(monkeypatch):
    _banco_da_meta(monkeypatch, [{"id": "c1", "amount_cents": 10000, "occurred_at": date(2026, 9, 25),
                                  "note": None, "de_movimentacao": True}])
    with pytest.raises(resources.JaExiste, match="veio de uma movimentação"):
        await resources.prepare(_ctx(), _aporte(aporte_do_dia="2026-09-25", novo_valor_do_aporte="20000"))


@pytest.mark.asyncio
async def test_aporte_do_dia_vira_a_correcao_com_a_frase_do_efeito(monkeypatch):
    _banco_da_meta(monkeypatch, [{"id": "c1", "amount_cents": 10000,
                                  "occurred_at": date(2026, 9, 25), "note": None}])
    prep = await resources.prepare(_ctx(), _aporte(aporte_do_dia="2026-09-25",
                                                   novo_valor_do_aporte="20000"))
    assert prep["aporte"] == {"id": "c1", "valor": 20000, "data": "2026-09-25", "nota": None}
    assert prep["summary"] == ("corrigir o aporte de R$ 100,00 de 25/09/2026 na meta Viagem: "
                               "valor R$ 100,00 → R$ 200,00")

    rpc = []

    async def fetch_one(sql, *args):
        rpc.append((sql, args))
        return {"guardado": 20000}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resources, "ensure_owned", lambda *a: _nada())
    r = await resources.execute(_ctx({"prepared": prep}), _aporte(aporte_do_dia="2026-09-25",
                                                                  novo_valor_do_aporte="20000"))
    assert "public.edit_goal_contribution" in rpc[0][0]
    assert rpc[0][1] == ("c1", 20000, "2026-09-25", None)
    assert "Corrigi o aporte da meta *Viagem*" in r.message


@pytest.mark.asyncio
async def test_retirada_continua_retirada(monkeypatch):
    _banco_da_meta(monkeypatch, [{"id": "c2", "amount_cents": -4000,
                                  "occurred_at": date(2026, 9, 20), "note": "passagem"}])
    prep = await resources.prepare(_ctx(), _aporte(aporte_do_dia="ultimo",
                                                   novo_valor_do_aporte="5000"))
    assert prep["aporte"]["valor"] == -5000 and "a retirada de R$ 40,00" in prep["summary"]


@pytest.mark.asyncio
async def test_dois_aportes_sem_dia_pergunta_qual(monkeypatch):
    _banco_da_meta(monkeypatch, [
        {"id": "c1", "amount_cents": 10000, "occurred_at": date(2026, 9, 25), "note": None},
        {"id": "c0", "amount_cents": 5000, "occurred_at": date(2026, 9, 1), "note": None},
    ])
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), _aporte(novo_valor_do_aporte="20000"))
    assert "Qual aporte da meta Viagem?" in err.value.mensagem_usuario
    assert "25/09/2026 R$ 100,00" in err.value.mensagem_usuario


@pytest.mark.asyncio
async def test_aporte_que_deixaria_a_meta_negativa_e_recusado(monkeypatch):
    _banco_da_meta(monkeypatch, [{"id": "c2", "amount_cents": -4000,
                                  "occurred_at": date(2026, 9, 20), "note": None}], saved=6000)
    with pytest.raises(resources.JaExiste) as err:
        await resources.prepare(_ctx(), _aporte(aporte_do_dia="ultimo",
                                                novo_valor_do_aporte="20000"))
    assert "Não dá para retirar mais do que está guardado" in err.value.mensagem_usuario


# ── 3. desmarcar paga / desfazer adiamento ───────────────────────────────────────────────────

def _desfazer(campo, mes=None):
    return ResourceAction(type=ResourceActionType.UPDATE, resource="cards", name="nubank",
                          target_month=mes, fields=[ResourceField(name=campo, value="false")])


def _fatura(**kw):
    return {"id": "f1", "reference_month": date(2026, 8, 1), "due_date": date(2026, 8, 10),
            "settled_manually": True, "card_name": "Nubank Cartão", "rotativo_auto": False,
            "vencida": True, "pago_cents": None, "pago_em": None, "destino_travado": False,
            "destino_vence": None, **kw}


@pytest.mark.asyncio
async def test_desmarcar_fatura_quitada_a_mao(monkeypatch):
    async def fetch(sql, *args):
        assert "ci.status = %s" in sql and "paid" in args
        return [_fatura()]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    prep = await resources.prepare(_ctx(), _desfazer("fatura_paga"))
    assert prep["desfazer_fatura"] == "fatura_paga" and prep["invoice_id"] == "f1"
    assert "desmarcar a fatura de agosto/2026 do Nubank Cartão como paga" in prep["summary"]

    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append(sql)
        return {"id": "f1"} if "unsettle_invoice" in sql else {"ok": 1}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resources, "ensure_owned", lambda *a: _nada())
    r = await resources.execute(_ctx({"prepared": prep}), _desfazer("fatura_paga"))
    assert any("public.unsettle_invoice" in c for c in chamadas)
    assert "voltou a ficar em aberto" in r.message


async def _nada():
    return None


@pytest.mark.asyncio
async def test_fatura_paga_com_pagamento_manda_apagar_o_pagamento(monkeypatch):
    async def fetch(sql, *args):
        return [_fatura(settled_manually=False, pago_cents=142300, pago_em=date(2026, 8, 8))]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), _desfazer("fatura_paga"))
    assert "apaga o pagamento da fatura do Nubank Cartão" in err.value.mensagem_usuario


@pytest.mark.asyncio
async def test_duas_faturas_sem_mes_pergunta_qual(monkeypatch):
    async def fetch(sql, *args):
        return [_fatura(), _fatura(id="f2", reference_month=date(2026, 7, 1))]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), _desfazer("fatura_paga"))
    assert "agosto/2026, julho/2026" in err.value.mensagem_usuario


@pytest.mark.asyncio
async def test_desfazer_adiamento_de_cartao_que_adia_sozinho_e_recusado(monkeypatch):
    async def fetch(sql, *args):
        assert "rolled" in args
        return [_fatura(rotativo_auto=True)]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), _desfazer("fatura_adiada"))
    assert "adia a fatura vencida sozinho" in err.value.mensagem_usuario


@pytest.mark.asyncio
async def test_marcar_como_paga_por_aqui_aponta_o_verbo_certo():
    acao = ResourceAction(type=ResourceActionType.UPDATE, resource="cards", name="nubank",
                          fields=[ResourceField(name="fatura_paga", value="true")])
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), acao)
    assert "já paguei a fatura" in err.value.mensagem_usuario
