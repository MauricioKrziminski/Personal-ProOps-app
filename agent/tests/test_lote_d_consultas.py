"""Lote D (consultas): reserva de emergência (F07) e plano de metas (F08).

A reserva não tem RPC de resumo — a conta mora em `src/lib/emergency-reserve.ts` e o Python a
espelha. `tests/fixtures/reserva_paridade.json` foi gerado RODANDO o TypeScript (decode + resumo +
formatação da cobertura) sobre dez estados; aqui o espelho tem que dar o mesmo. Para regerar, rode
`getEmergencyReserveSummary` sobre os `state` do arquivo e cole `summary`/`coverage`."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.graph.schemas import ResourceAction, ResourceField
from app.tools import lote_d, resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error
from tests.test_lote_b_movimentos import USER, WS, Banco

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "reserva_paridade.json").read_text())
STATUS = {"manual": "ok", "observed": "ok", "not_configured": "nao_configurada", "unreviewed": "sem_revisao",
          "incomplete_classification": "sem_classificar", "zero_base": "base_zero"}


def ctx(**extra):
    return ExecContext(USER, WS, None, "America/Sao_Paulo", "", "app:msg-1", action_index=0, **extra)


def lista(resource):
    return ResourceAction(type="resource_list", resource=resource, name=None, fields=[])


@pytest.mark.parametrize("nome", sorted(FIXTURES))
def test_resumo_da_reserva_bate_com_o_typescript(nome):
    esperado, estado = FIXTURES[nome]["summary"], FIXTURES[nome]["state"]
    r = lote_d.resumo_da_reserva(estado)
    assert STATUS[esperado["baseStatus"]] == r["base"]
    assert r["mensal"] == esperado["monthlyCents"]
    assert r["reservado"] == esperado["reservedCents"] and r["planejado"] == esperado["plannedCents"]
    assert r["meta"] == esperado["targetCents"] and r["falta"] == esperado["missingCents"]
    if esperado["monthlyCents"] is not None and esperado["reservedCents"] > 0:
        # o TS escreve "Menos de 0,1 mês" com maiúscula; a frase do agente segue a mesma regra
        assert lote_d.cobertura_em_texto(r["reservado"], r["mensal"]).lower() == FIXTURES[nome]["coverage"].lower()


def test_frase_da_reserva_com_numero():
    f = lote_d.frase_da_reserva(lote_d.resumo_da_reserva(FIXTURES["manual_3_3"]["state"]))
    assert "cobre 3,3 meses" in f and "R$ 4.000,00 reservados" in f and "R$ 1.200,00" in f
    assert "Meta: 9 meses = R$ 10.800,00" in f and "faltam R$ 6.800,00" in f


@pytest.mark.parametrize("nome, trecho", [
    ("nao_configurada", "ainda não definiu a base"),
    ("sem_classificar", "gasto sem classificar"),
    ("sem_revisao", "ainda não foram revisados"),
    ("base_zero", "não têm gasto essencial"),
])
def test_base_insuficiente_nunca_vira_numero(nome, trecho):
    f = lote_d.frase_da_reserva(lote_d.resumo_da_reserva(FIXTURES[nome]["state"]))
    assert trecho in f and "não calculo quantos meses" in f and "no app" in f
    assert "0 meses" not in f and "cobre " not in f


def test_reserva_zerada_diz_que_nao_ha_nada_separado_e_deficit_aparece():
    f = lote_d.frase_da_reserva(lote_d.resumo_da_reserva(FIXTURES["manual_zerada"]["state"]))
    assert "nenhum valor separado" in f and "0 meses" not in f and "faltam R$ 10.800,00" in f
    f = lote_d.frase_da_reserva(lote_d.resumo_da_reserva(FIXTURES["deficit"]["state"]))
    assert "cobre 2,5 meses" in f and "R$ 2.000,00 do que você escolheu" in f
    f = lote_d.frase_da_reserva(lote_d.resumo_da_reserva(FIXTURES["menos_de_um_decimo"]["state"]))
    assert "menos de 0,1 mês" in f


@pytest.mark.asyncio
async def test_consultar_a_reserva_roda_como_o_usuario_e_confere_o_espaco(monkeypatch):
    estado = {**FIXTURES["manual_3_3"]["state"], "workspace_id": WS}
    banco = Banco(**{"public.emergency_reserve_state(": {"s": estado}})
    monkeypatch.setattr(lote_d.db, "como_usuario", banco)
    p = await resources.prepare(ctx(), lista("reserva"))
    assert p["summary"] == "consultar a reserva de emergência"
    r = await resources.execute(ctx(target={"prepared": p}), lista("reserva"))
    assert r.read_only and "cobre 3,3 meses" in r.message
    assert banco.chamadas[0][1][0] == WS and banco.saidas == [True]  # a leitura também volta (nada fica)
    banco = Banco(**{"public.emergency_reserve_state(": {"s": {**estado, "workspace_id": "outro"}}})
    monkeypatch.setattr(lote_d.db, "como_usuario", banco)
    with pytest.raises(Exception, match="conferir o espaço"):
        await lote_d.ler_reserva(ctx())


@pytest.mark.asyncio
@pytest.mark.parametrize("resource", ["reserva", "plano_metas"])
async def test_configurar_pelo_agente_e_recusado(resource):
    for tipo in ("resource_update", "resource_create", "resource_delete"):
        with pytest.raises(resources.JaExiste, match="é só para consultar.*configurar é no app"):
            await resources.prepare(ctx(), ResourceAction(type=tipo, resource=resource, name=None, fields=[]))
    with pytest.raises(Level1Error, match="Campo não permitido"):  # nenhum campo existe para configurar
        await resources.prepare(ctx(), ResourceAction(type="resource_list", resource=resource, name=None,
                                                      fields=[ResourceField(name="x", value="1")]))


# ------------------------------------------------------------------ F08


def estado_plano(**ov):
    base = {
        "workspace_id": WS, "income_present": True, "first_pressure_on": None, "minimum_available_cents": "931418",
        "incomplete_goal_ids": [], "missed_deadline_goal_ids": [],
        "goals": [
            {"goal_id": "g1", "name": "Reserva", "included": True, "monthly_cents": "104546", "deadline": "2027-09-03"},
            {"goal_id": "g2", "name": "Notebook", "included": True, "monthly_cents": "132000", "deadline": None},
            {"goal_id": "g3", "name": "Fora", "included": False, "monthly_cents": None, "deadline": None},
        ],
    }
    return {**base, **ov}


def test_plano_de_metas_com_renda_e_sem_aperto_diz_que_cabe():
    f = lote_d.frase_do_plano_de_metas(estado_plano(), "2026-10-05")
    assert "Reserva: R$ 1.045,46 por mês até 03/09/2027" in f and "Notebook: R$ 1.320,00 por mês" in f
    assert "Fora" not in f and "Cabe: nos próximos 12 meses o disponível não fica negativo" in f and "R$ 9.314,18" in f


def test_plano_de_metas_que_aperta_diz_a_data_e_o_menor_disponivel():
    f = lote_d.frase_do_plano_de_metas(
        estado_plano(first_pressure_on="2027-04-05", minimum_available_cents="-2081734",
                     missed_deadline_goal_ids=["g1"], incomplete_goal_ids=["g2"]), "2026-10-05")
    assert "Aperta em 05/04/2027" in f and "-R$ 20.817,34" in f and "Não cabe sem ajustar" in f
    assert "Não chega no prazo: Reserva" in f and "Falta dado para calcular: Notebook" in f
    assert "Cabe:" not in f


def test_plano_de_metas_sem_renda_nunca_diz_que_cabe():
    f = lote_d.frase_do_plano_de_metas(estado_plano(income_present=False), "2026-10-05")
    assert "Não dá para dizer que cabe" in f and "não há renda lançada" in f and "Cabe:" not in f
    f = lote_d.frase_do_plano_de_metas(
        estado_plano(income_present=False, first_pressure_on="2027-04-05", minimum_available_cents="-100"), "2026-10-05")
    assert "Não dá para dizer que cabe" in f and "aperta a partir de 05/04/2027" in f and "Cabe:" not in f


def test_plano_de_metas_sem_meta_em_andamento():
    f = lote_d.frase_do_plano_de_metas(estado_plano(goals=[]), "2026-10-05")
    assert "não tem meta em andamento" in f and "Cabe" not in f


@pytest.mark.asyncio
async def test_consultar_o_plano_de_metas_usa_a_regua_do_espaco_e_365_dias(monkeypatch):
    banco = Banco(**{"from public.workspaces": {"v": "cycle"},
                     "public.goal_planning_state_v2(": {"r": {"state": estado_plano(), "horizons": []}}})
    monkeypatch.setattr(lote_d.db, "como_usuario", banco)
    r = await lote_d.ler_plano_de_metas(ctx())
    sql, args = banco.chamadas[-1]
    assert args == (WS, "cycle") and "365" in sql and "'month'" in sql
    assert r.read_only and "Seu plano de metas" in r.message
    banco = Banco(**{"from public.workspaces": {"v": "civil"},
                     "public.goal_planning_state_v2(": {"r": {"state": estado_plano(workspace_id="outro"), "horizons": []}}})
    monkeypatch.setattr(lote_d.db, "como_usuario", banco)
    with pytest.raises(Exception, match="conferir o espaço"):
        await lote_d.ler_plano_de_metas(ctx())
