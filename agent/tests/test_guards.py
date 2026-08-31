"""Nível 1: o que impede a saída do modelo de virar linha no banco."""

import pytest

from app.tools.guards import (
    require_current_installment,
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


class TestParcelaAtual:
    """"Tô na 4ª parcela de 10" é uma compra de três meses atrás.

    O agente agendava as 10 parcelas a partir de hoje — o histórico sumia e a
    projeção de caixa ganhava 3 meses de dívida que já foi paga.
    """

    def test_compra_de_agora_e_a_primeira(self):
        assert require_current_installment(None, 10) == 1

    def test_parcela_informada_passa(self):
        assert require_current_installment(4, 10) == 1 + 3

    def test_fora_da_faixa_cai_para_um_em_vez_de_inventar_passado(self):
        """"tô na 12ª de 10" é o modelo entendendo errado. Retroagir 11 meses
        criaria histórico que não existe; cair para 1 perde informação mas não
        inventa nenhuma."""
        assert require_current_installment(12, 10) == 1
        assert require_current_installment(0, 10) == 1
        assert require_current_installment(-4, 10) == 1

    def test_nao_confunde_bool_com_int(self):
        assert require_current_installment(True, 10) == 1
