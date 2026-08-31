"""Dinheiro é a parte que não pode errar: valor errado no banco é dado errado
para sempre, e o usuário só descobre no fim do mês."""

from app.domain.money import cents_to_brl, format_number_br, parse_valor_em_centavos


def test_valores_simples():
    assert parse_valor_em_centavos("gastei 45 no mercado") == 4500
    assert parse_valor_em_centavos("45,90") == 4590
    assert parse_valor_em_centavos("1.234,56") == 123456
    assert parse_valor_em_centavos("1234.56") == 123456


def test_multiplicadores():
    assert parse_valor_em_centavos("meu tesouro ta em 27 mil") == 2_700_000
    assert parse_valor_em_centavos("1,5 mil") == 150_000
    assert parse_valor_em_centavos("3 milhões") == 300_000_000


def test_ambiguo_devolve_none():
    # dois números plausíveis: perguntar é melhor que chutar qual é o dinheiro
    assert parse_valor_em_centavos("transferi 100 e gastei 200") is None
    assert parse_valor_em_centavos("sem número nenhum") is None
    assert parse_valor_em_centavos(None) is None


def test_ruido_nao_conta_como_dinheiro():
    # "12x" é parcela, "dia 5" é recorrência, "20%" é taxa
    assert parse_valor_em_centavos("parcelei 3600 em 12x") == 360_000
    assert parse_valor_em_centavos("me lembra dia 5 de pagar 1200") == 120_000
    assert parse_valor_em_centavos("desconto de 20% em 50 reais") == 5000


def test_formatacao_br():
    assert cents_to_brl(4500) == "R$ 45,00"
    assert cents_to_brl(123456) == "R$ 1.234,56"
    assert cents_to_brl(100000000) == "R$ 1.000.000,00"
    assert cents_to_brl(-4500) == "-R$ 45,00"
    assert cents_to_brl(0) == "R$ 0,00"
    # decimal com vírgula, nunca ponto: "90.4%" ao lado de "90,4%" foi defeito real
    assert format_number_br(90.44) == "90,4"
