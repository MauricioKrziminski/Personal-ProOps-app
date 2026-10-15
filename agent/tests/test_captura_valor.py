"""O valor da captura sai do TEXTO da notificação; o modelo só vale se o texto o sustenta."""

import pytest

from app.domain.captura import ancorar_valor, fechar
from app.domain.money import valores_em_reais
from app.routes.captures import BANCOS, tem_valor
from scripts.notificacoes_de_banco import CASOS


@pytest.mark.parametrize("texto,esperado", [
    ("Compra de R$45", ([4500], [])),
    ("R$ 1.460,53 e R$1.250,00 no cartão final 1234", ([146053, 125000], [])),
    ("Pagou BRL 45,90", ([4590], [])),
    ("Pix recebido 1.200,00", ([120000], [])),
    ("Transferência para CONTA 12345-6, código 482913", ([], [])),
    ("Compra de US$ 12,99 APROVADA", ([], ["US$ 12,99"])),
    ("US$ 12,99 (R$ 70,15)", ([7015], ["US$ 12,99"])),
    ("EUR 9,90 e 20 dólares", ([], ["EUR 9,90", "20 dólares"])),
    ("R$ 5,00 e de novo R$ 5,00", ([500], [])),
    ("Juros de 1,50% e R$ 3,00", ([300], [])),
])
def test_valores_em_reais_so_com_moeda(texto, esperado):
    assert valores_em_reais(texto) == esperado


@pytest.mark.parametrize("texto,modelo,esperado", [
    ("Compra de R$ 45,90", 4590, (4590, None)),
    ("Compra de R$ 45,90", 99999, (4590, None)),                          # (b)
    ("Compra de R$ 45,90", None, (4590, None)),                           # (c)
    ("Compra de R$ 20,00. Limite: R$ 1.980,00", 2000, (2000, None)),      # (a)
    ("Compra de R$ 20,00. Limite: R$ 1.980,00", 198000, (2000, None)),  # o limite rotulado sai da disputa
    ("Compra de R$ 20,00 aprovada. Limite disponível: R$ 1.980,00", None, (2000, None)),
    ("Pix de R$ 50,00 enviado. Saldo R$ 1.200,00", 120000, (5000, None)),
    ("Compra de 3x de R$ 100,00", 30000, (30000, None)),                  # N×V
    ("Compra em 3x de R$ 100,00", 10000, (30000, None)),                  # a parcela no lugar do total
    ("Compra de R$ 600,00 em 3x", 60000, (60000, None)),                  # total dito
    ("Compra de US$ 20,00 (R$ 110,40)", 2000, (11040, None)),             # (e) com reais
    ("Compra de 0x de R$ 5,00 e 1x de R$ 7,00", 500, (500, None)),        # N inválido não vira parcelada
])
def test_ancorar_valor(texto, modelo, esperado):
    assert ancorar_valor(texto, modelo) == esperado


def test_dois_valores_e_nenhum_e_o_do_modelo_pergunta_e_nunca_escolhe():
    valor, pergunta = ancorar_valor("Pix de R$ 20,00 enviado. Tarifa de R$ 1,50", 777)
    assert valor is None and "R$ 20,00" in pergunta and "R$ 1,50" in pergunta


def test_limite_rotulado_nunca_ganha_e_sozinho_nao_some():
    # o limite sai da disputa só quando há outro valor; sozinho, segue o caminho de sempre
    assert ancorar_valor("Compra de R$ 20,00. Limite: R$ 1.980,00", 198000) == (2000, None)
    assert ancorar_valor("Seu limite disponível agora é de R$ 800,00.", None)[0] == 80000


def test_moeda_estrangeira_sem_reais_pergunta_em_reais():
    assert ancorar_valor("Compra de US$ 12,99 em NETFLIX.COM", 1299) == (None, "Compra de US$ 12,99: quanto foi em reais?")


def test_sem_nenhuma_quantia_em_reais_pergunta():
    valor, pergunta = ancorar_valor("Compra aprovada", 4500)
    assert valor is None and pergunta.startswith("Confira o valor")


def test_valor_do_modelo_invalido_nao_passa():
    assert ancorar_valor("Compra de R$ 45,90", -5) == (4590, None)
    assert ancorar_valor("Compra de R$ 45,90", 0) == (4590, None)


def test_fechar_converte_mark_paid_em_gasto_com_o_valor():
    a, perguntas = fechar([{"type": "mark_paid", "new_amount_cents": 15075, "description": "boleto"}],
                          "Pagamento", "Pagamento de boleto de R$ 150,75 realizado.")
    assert (a["type"], a["amount_cents"], perguntas) == ("create_expense", 15075, [])


def test_fechar_ignora_o_que_nao_e_lancamento_e_fica_com_a_primeira():
    assert fechar([{"type": "create_transfer", "amount_cents": 1}], "", "R$ 1,00") == (None, [])
    a, _ = fechar([{"type": "create_income", "amount_cents": 500}, {"type": "create_expense", "amount_cents": 900}],
                  "", "Pix de R$ 5,00")
    assert a["type"] == "create_income"


def test_fechar_descarta_data_invalida_com_pergunta():
    a, perguntas = fechar([{"type": "create_expense", "amount_cents": 4590, "occurred_at": "2026-09-31"}],
                          "", "Compra de R$ 45,90")
    assert a["occurred_at"] is None and a["amount_cents"] == 4590 and "Confira a data" in perguntas[0]
    a, perguntas = fechar([{"type": "create_expense", "amount_cents": 4590, "occurred_at": "2026-09-30"}],
                          "", "Compra de R$ 45,90")
    assert a["occurred_at"] == "2026-09-30" and perguntas == []


def test_corpus_so_usa_bancos_da_lista_e_esperados_validos():
    for pacote, titulo, texto, esperado in CASOS:
        assert pacote in BANCOS and isinstance(texto, str)
        assert esperado is None or (esperado[0] in ("expense", "income") and (esperado[1] is None or esperado[1] > 0))


def test_a_quantia_do_corpus_esta_no_texto():
    """Todo valor esperado é um dos lidos do texto (ou N×V): a ancoragem e o corpus concordam."""
    for _p, titulo, texto, esperado in CASOS:
        if not esperado or esperado[1] is None:
            continue
        valor, pergunta = ancorar_valor(f"{titulo}\n{texto}", esperado[1])
        assert (valor, pergunta) == (esperado[1], None), texto


def test_corpus_sem_valor_nao_chama_o_modelo():
    sem = [t for _p, ti, t, e in CASOS if e is None and not tem_valor(t)]
    assert any("482913" in t for t in sem)
