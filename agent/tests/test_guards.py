"""Nível 1: o que impede a saída do modelo de virar linha no banco."""

import pytest

from app.tools.guards import (
    Level1Error,
    clean_rrule,
    require_amount,
    require_date,
    require_installments,
    split_installment_total,
)


def test_valor_precisa_ser_positivo_e_plausivel():
    assert require_amount(4500) == 4500
    for ruim in (None, 0, -100, 10_000_000_001, True):
        with pytest.raises(Level1Error):
            require_amount(ruim)


def test_data_fora_da_janela_e_barrada():
    assert require_date("2026-08-30", "America/Sao_Paulo") == "2026-08-30"
    with pytest.raises(Level1Error):
        require_date("0045-01-02", "America/Sao_Paulo")   # OCR de cupom
    with pytest.raises(Level1Error):
        require_date("2190-05-01", "America/Sao_Paulo")   # alucinação
    with pytest.raises(Level1Error):
        require_date("30/08/2026", "America/Sao_Paulo")   # formato errado


def test_parcelas():
    assert require_installments(12) == 12
    for ruim in (None, 1, 0, -3, 100):
        with pytest.raises(Level1Error):
            require_installments(ruim)


def test_rrule_invalida_vira_none_e_nao_erro():
    # lançamento sem repetição é melhor que lançamento perdido
    assert clean_rrule("FREQ=MONTHLY;BYMONTHDAY=5") == "FREQ=MONTHLY;BYMONTHDAY=5"
    assert clean_rrule("RRULE:FREQ=DAILY") == "FREQ=DAILY"
    assert clean_rrule("todo dia 5") is None
    assert clean_rrule(None) is None


def test_soma_das_parcelas_bate_com_o_total():
    for total, n in ((100_00, 3), (3600_00, 12), (1, 2), (999_99, 7)):
        parcelas = split_installment_total(total, n)
        assert len(parcelas) == n
        assert sum(parcelas) == total, (total, n, parcelas)
