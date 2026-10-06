"""Uma função por regra: "sem conta" e "último dia do mês" valem igual em todo caminho (M6)."""

import pytest

from app.domain import matching
from app.domain.correcao_plano import ultimo_dia_das_parcelas
from app.graph.schemas import FinanceAction, FinanceActionType


@pytest.mark.parametrize("dito", ["sem conta", "Nenhuma conta", "sem nenhuma conta", " SEM  CONTA "])
def test_sem_conta_tem_uma_leitura(dito):
    assert matching.sem_conta_explicita(dito)


@pytest.mark.parametrize("dito", ["nubank", "conta do nubank", "", None])
def test_sem_conta_nao_pega_o_resto(dito):
    assert not matching.sem_conta_explicita(dito)


@pytest.mark.parametrize("dito", [
    "último", "Último dia", "ultimo dia do mês", "fim do mês", "final do mes",
    "FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3",
])
def test_ultimo_dia_tem_uma_leitura(dito):
    assert matching.ultimo_dia_do_mes(dito)


@pytest.mark.parametrize("dito", ["10", "dia 30", "FREQ=MONTHLY;BYMONTHDAY=10", "", None])
def test_ultimo_dia_nao_pega_o_resto(dito):
    assert not matching.ultimo_dia_do_mes(dito)


def test_as_parcelas_no_ultimo_dia_usam_a_mesma_funcao():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, recurrence="FREQ=MONTHLY;BYMONTHDAY=-1")
    assert ultimo_dia_das_parcelas(acao)


def test_like_escapa_curingas_do_termo():
    assert matching.like_contem("50%_x\\") == "%50\\%\\_x\\\\%"
    assert matching.like_contem(None) == "%%"
