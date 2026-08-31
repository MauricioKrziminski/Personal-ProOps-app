"""Formato de extrato de banco brasileiro não tem padrão — é o maior risco da
importação, e por isso o parser é puro e testado sem banco."""

from app.domain.statement import any_date, parse_csv, parse_ofx, to_cents

OFX = """
<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260815120000<TRNAMT>-45.90<MEMO>SUPERMERCADO XYZ</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260820<TRNAMT>1500.00<NAME>SALARIO</STMTTRN>
</BANKTRANLIST></OFX>
"""


def test_ofx():
    linhas = parse_ofx(OFX)
    assert len(linhas) == 2
    assert linhas[0].kind == "expense"
    assert linhas[0].amount_cents == 4590
    assert linhas[0].occurred_at == "2026-08-15"
    assert linhas[0].description == "SUPERMERCADO XYZ"
    assert linhas[1].kind == "income"
    assert linhas[1].amount_cents == 150000


def test_csv_com_cabecalho_e_ponto_e_virgula():
    csv = "Data;Descrição;Valor\n15/08/2026;Mercado;-45,90\n20/08/2026;Salário;1.500,00\n"
    linhas = parse_csv(csv)
    assert len(linhas) == 2
    assert linhas[0].occurred_at == "2026-08-15"
    assert linhas[0].amount_cents == 4590
    assert linhas[0].kind == "expense"
    assert linhas[1].amount_cents == 150000


def test_csv_sem_cabecalho_cai_para_posicional():
    linhas = parse_csv("2026-08-15,Mercado,-45.90\n")
    assert len(linhas) == 1
    assert linhas[0].description == "Mercado"


def test_formatos_de_numero_e_data():
    assert to_cents("1.234,56") == 123456   # BR
    assert to_cents("1,234.56") == 123456   # US
    assert to_cents("-45,90") == 4590       # sinal vira `kind`, não valor negativo
    assert to_cents("abc") is None
    assert any_date("15/08/2026") == "2026-08-15"
    assert any_date("2026-08-15") == "2026-08-15"
    assert any_date("agosto") is None
