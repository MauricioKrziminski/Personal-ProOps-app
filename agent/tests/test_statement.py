"""Formato de extrato de banco brasileiro não tem padrão — é o maior risco da
importação, e por isso o parser é puro e testado sem banco."""

from app.domain.statement import any_date, ofx_date, parse_csv, parse_ofx, to_cents

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


# --- formas medidas em extratos REAIS (agosto e setembro de 2026) -------------

_BB = """
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260703000000[-3:BRT]<TRNAMT>0.07<FITID>
<NAME>Saldo Anterior<MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260805000000[-3:BRT]<TRNAMT>1947.10
<FITID>51.133.572.606.352<NAME>Pix - Recebido<MEMO>05/08 GABRIEL</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>00021130000000[-3:BRT]<TRNAMT>0.11<FITID>
<NAME>Saldo do dia<MEMO></STMTTRN>
"""


def test_saldo_do_bb_nao_vira_lancamento():
    """O BB emite "Saldo Anterior" e "Saldo do dia" como <STMTTRN>, sem FITID.

    Sem o corte, um extrato de 2 movimentos importava 4 linhas — duas receitas fantasma cujo
    valor é o SALDO (0,11 é o próprio <LEDGERBAL>). O corte é pelo FITID vazio, nunca pelo nome.
    """
    linhas = parse_ofx(_BB)
    assert [l.description for l in linhas] == ["05/08 GABRIEL"]


def test_data_impossivel_do_bb_nao_entra():
    """`DTPOSTED = 00021130000000` — ano DOIS. Entrava como `0002-11-30` e envenenava mês,
    ciclo e projeção sem erro nenhum na tela."""
    assert ofx_date("00021130000000[-3:BRT]") is None
    assert ofx_date("20260805000000[-3:BRT]") == "2026-08-05"


def test_banco_que_nao_usa_fitid_nao_perde_o_extrato_inteiro():
    """A guarda não pode virar "descarta tudo" no banco que simplesmente não emite o campo."""
    sem_fitid = """
    <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260805<TRNAMT>-45.90<MEMO>Mercado</STMTTRN>
    <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260806<TRNAMT>100.00<MEMO>Salario</STMTTRN>
    """
    assert len(parse_ofx(sem_fitid)) == 2


# ── Estrutura dos arquivos REAIS do Nubank (22/09/2026), com dados fictícios ─────────────────
# Os arquivos de verdade têm nome e CPF de terceiros: a estrutura entra no teste, o dado não.

CSV_FATURA_NUBANK = """date,title,amount
2026-09-21,Pix no Crédito - FULANO,"88,68"
2026-09-15,Loja X - Parcela 1/2,"52,50"
2026-09-08,Pagamento recebido,"- 160,00"
2026-09-04,Posto Y,"70,00"
"""


def test_csv_da_fatura_nubank_compra_positiva_e_gasto():
    """O defeito medido: lida pela régua da conta, a fatura virava 26 receitas em 30 linhas."""
    linhas = parse_csv(CSV_FATURA_NUBANK, cartao=True)
    assert [l.kind for l in linhas] == ["expense", "expense", "income", "expense"]
    # a coluna `title` É o nome — antes todas saíam "Lançamento importado"
    assert linhas[1].description == "Loja X - Parcela 1/2"
    assert linhas[2].amount_cents == 16000


def test_csv_de_cartao_que_escreve_a_compra_negativa_tambem_funciona():
    """A régua é a MAIORIA dos sinais, não o formato de um banco."""
    csv = "Data;Descrição;Valor\n01/09/2026;Compra A;-10,00\n02/09/2026;Compra B;-20,00\n03/09/2026;Pagamento;30,00\n"
    linhas = parse_csv(csv, cartao=True)
    assert [l.kind for l in linhas] == ["expense", "expense", "income"]


def test_csv_da_conta_nubank_traz_o_identificador():
    csv = "Data,Valor,Identificador,Descrição\n01/08/2026,-25.00,abc-1,Transferência enviada\n"
    [linha] = parse_csv(csv)
    assert linha.kind == "expense" and linha.external_id == "abc-1"


def test_ofx_diz_se_o_arquivo_e_de_cartao_ou_de_conta_e_traz_o_fitid():
    from app.domain.statement import ofx_tipo

    cartao = "<OFX><CREDITCARDMSGSRSV1><CCSTMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260908<TRNAMT>-19.90<FITID>f-1<MEMO>Loja   Z</STMTTRN></BANKTRANLIST></CCSTMTRS></CREDITCARDMSGSRSV1></OFX>"
    assert ofx_tipo(cartao) == "cartao"
    assert ofx_tipo("<OFX><BANKMSGSRSV1><STMTRS></STMTRS></BANKMSGSRSV1></OFX>") == "conta"
    assert ofx_tipo("lixo") is None
    [linha] = parse_ofx(cartao)
    assert linha.external_id == "f-1"
    assert linha.description == "Loja Z", "espaço repetido sai: o nome é chave de comparação"


def test_impressao_digital_do_csv_e_estavel_e_separa_linhas_iguais():
    """Reimportar a mesma fatura em CSV (sem id do banco) tem que dar as MESMAS chaves; dois
    postos iguais no mesmo dia são duas chaves."""
    from app.jobs.importer import impressao_digital

    csv = 'date,title,amount\n2026-09-07,Posto,"70,00"\n2026-09-07,Posto,"70,00"\n2026-09-08,Loja,"10,00"\n'
    a = impressao_digital(parse_csv(csv, cartao=True))
    b = impressao_digital(parse_csv(csv, cartao=True))
    assert a == b and len(set(a)) == 3
