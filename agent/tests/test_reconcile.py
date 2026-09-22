"""A conciliação do extrato — cada camada, a reserva 1-para-1 e o parcelado."""

from datetime import date

from app.domain.reconcile import Existente, Item, add_months, conciliar, parse_parcela, semelhanca

CARTAO = "cartao-1"
D = date


def item(idx, desc, cents, dia, kind="expense", ext=None):
    return Item(idx, kind, cents, dia, desc, ext)


def tx(id_, desc, cents, dia, kind="expense", conta=CARTAO, **kw):
    return Existente(id_, kind, cents, dia, desc, account_id=conta, **kw)


def um(v, **esperado):
    for k, val in esperado.items():
        assert getattr(v, k) == val, (k, getattr(v, k), val)


def test_parse_parcela_e_estrutura_nao_palavra():
    assert parse_parcela("Luizroberto - Parcela 2/12") == ("Luizroberto", 2, 12)
    assert parse_parcela("Shopee*Solu Multimarca - Parcela 2/2") == ("Shopee*Solu Multimarca", 2, 2)
    assert parse_parcela("Wardogs Nuuvem (1/2)") == ("Wardogs Nuuvem", 1, 2)
    assert parse_parcela("LOJA PARC 03/10") == ("LOJA", 3, 10)
    assert parse_parcela("Mercado 24/7") is None, "24 > 7 não é parcela"
    assert parse_parcela("Taxa 1/1") is None, "1x não é compra parcelada"
    assert parse_parcela("Auto Posto") is None


def test_add_months_segue_a_regua_do_banco():
    assert add_months(D(2026, 3, 31), -1) == D(2026, 2, 28)
    assert add_months(D(2026, 1, 15), -2) == D(2025, 11, 15)


def test_semelhanca_de_nome_como_o_extrato_escreve():
    assert semelhanca("Openai *Chatgpt Subscr", "ChatGPT") >= 0.72
    assert semelhanca("Anthropic* Claude Sub", "Claude") >= 0.72
    assert semelhanca("Pix no Crédito - RECEITA FEDERAL", "Pix no Crédito - MARIA") < 0.72
    assert semelhanca("Uber", "Uber Eats") < 0.9


def test_cada_camada_e_a_cascata():
    itens = [
        item(0, "Posto Y", 7000, D(2026, 9, 20)),              # idêntico
        item(1, "Loja X - Parcela 2/3", 14010, D(2026, 9, 3)),  # parcela da compra do app
        item(2, "Openai *Chatgpt Subscr", 54654, D(2026, 9, 4)),  # nome parecido, 2 dias
        item(3, "Casa do Acai", 3700, D(2026, 9, 4)),           # mesmo valor, data diferente
        item(4, "Mercado Z", 9990, D(2026, 9, 10)),             # nada no app → novo
    ]
    existentes = [
        tx("t0", "Posto Y", 7000, D(2026, 9, 20)),
        tx("t1", "Loja X (2/3)", 14010, D(2026, 9, 28), installment_plan_id="p", installment_no=2, plan_installments=3),
        tx("t2", "ChatGPT", 54654, D(2026, 9, 6)),
        tx("t3", "Açaí com a Maria", 3700, D(2026, 9, 2)),
    ]
    v = conciliar(itens, existentes, conta_id=CARTAO, cartao=True)
    um(v[0], status="duplicate", camada="identico", transaction_id="t0")
    um(v[1], status="near_match", camada="parcela", transaction_id="t1")
    um(v[2], status="near_match", camada="perto", transaction_id="t2")
    um(v[3], status="near_match", camada="perto", transaction_id="t3")
    um(v[4], status="novo")


def test_um_lancamento_do_app_so_casa_com_um_item():
    """Dois postos de R$ 70 no extrato e um no app: o segundo é NOVO, não duplicata."""
    itens = [item(0, "Posto Y", 7000, D(2026, 9, 7)), item(1, "Posto Y", 7000, D(2026, 9, 7))]
    v = conciliar(itens, [tx("t", "Posto Y", 7000, D(2026, 9, 7))], conta_id=CARTAO, cartao=True)
    assert [x.status for x in v] == ["duplicate", "novo"]


def test_lancamento_sem_conta_do_whatsapp_tambem_conta():
    v = conciliar([item(0, "Mercado", 4500, D(2026, 9, 1))],
                  [tx("t", "mercado", 4500, D(2026, 9, 1), conta=None)], conta_id=CARTAO, cartao=True)
    um(v[0], status="duplicate", transaction_id="t")


def test_lancamento_de_outra_conta_nao_casa():
    v = conciliar([item(0, "Mercado", 4500, D(2026, 9, 1))],
                  [tx("t", "Mercado", 4500, D(2026, 9, 1), conta="corrente")], conta_id=CARTAO, cartao=True)
    um(v[0], status="novo")


def test_empate_nao_escolhe_pergunta():
    itens = [item(0, "Loja", 5000, D(2026, 9, 5))]
    existentes = [tx("a", "Farmácia", 5000, D(2026, 9, 4)), tx("b", "Padaria", 5000, D(2026, 9, 6))]
    v = conciliar(itens, existentes, conta_id=CARTAO, cartao=True)
    um(v[0], status="uncertain", camada="talvez")


def test_nome_desempata_quando_um_e_claramente_o_mesmo():
    itens = [item(0, "Farmacia Sao Joao", 5000, D(2026, 9, 5))]
    existentes = [tx("a", "Farmácia São João", 5000, D(2026, 9, 4)), tx("b", "Padaria", 5000, D(2026, 9, 6))]
    um(conciliar(itens, existentes, conta_id=CARTAO, cartao=True)[0], transaction_id="a")


def test_arquivo_ja_importado_e_a_camada_mais_forte():
    """Mesmo renomeado e com a data corrigida no app, a linha do banco é a mesma."""
    v = conciliar([item(0, "Posto Y", 7000, D(2026, 9, 7), ext="fit-1")],
                  [tx("t", "Gasolina", 6900, D(2026, 8, 1))],
                  conta_id=CARTAO, cartao=True, ja_importados={"fit-1": "t"})
    um(v[0], status="duplicate", camada="arquivo", transaction_id="t")


def test_pagamento_da_fatura_casa_com_a_transferencia_do_app():
    pagamento = Existente("pg", "transfer", 16000, D(2026, 9, 8), "Pagamento da fatura",
                          account_id="corrente", counterparty_account_id=CARTAO)
    v = conciliar([item(0, "Pagamento recebido", 16000, D(2026, 9, 8), kind="income")],
                  [pagamento], conta_id=CARTAO, cartao=True)
    um(v[0], status="duplicate", camada="transferencia", transaction_id="pg")


def test_parcela_de_outro_numero_nunca_casa_mesmo_com_o_nome_igual():
    itens = [item(0, "Loja X - Parcela 3/3", 14010, D(2026, 10, 3))]
    existentes = [tx("p2", "Loja X (2/3)", 14010, D(2026, 10, 1),
                     installment_plan_id="p", installment_no=2, plan_installments=3)]
    um(conciliar(itens, existentes, conta_id=CARTAO, cartao=True)[0], status="novo")


def test_compra_parcelada_nova_adota_a_parcela_antiga_que_ja_esta_solta_no_app():
    """Parcela 3/4 nova; a 1ª já foi importada como linha solta num mês anterior."""
    itens = [item(0, "King Cell - Parcela 3/4", 39900, D(2026, 9, 3))]
    existentes = [tx("antiga", "King Cell - Parcela 1/4", 39900, D(2026, 7, 3))]
    v = conciliar(itens, existentes, conta_id=CARTAO, cartao=True)[0]
    um(v, status="novo", parcela=(3, 4))
    assert v.adotar == ["antiga", None], "a 1ª é adotada, a 2ª será criada"


def test_saldo_adiado_da_fatura_anterior_nao_entra_de_novo():
    saldo = tx("rot", "Saldo em rotativo de Agosto", 37166, D(2026, 9, 3), rollover=True)
    v = conciliar([item(0, "Valor pendente do mês anterior (rotativo)", 37166, D(2026, 9, 10))],
                  [saldo], conta_id=CARTAO, cartao=True)
    um(v[0], status="near_match", camada="saldo_anterior")


def test_reimportar_o_mesmo_arquivo_nao_traz_nada_novo():
    """Idempotência ponta a ponta do módulo: o que o 1º import criou casa 100% no 2º."""
    linhas = [item(i, f"Loja {i}", 1000 + i, D(2026, 9, 1 + i)) for i in range(10)]
    criados = [tx(f"t{i}", l.description, l.amount_cents, l.occurred_at) for i, l in enumerate(linhas)]
    v = conciliar(linhas, criados, conta_id=CARTAO, cartao=True)
    assert all(x.status == "duplicate" for x in v)


def test_o_caso_wardogs_compra_parcelada_criada_a_mao_casa_com_a_linha_da_fatura():
    """App: "Wardogs" 2x de R$ 52,49 a partir de 21/09 (lançada à mão). Fatura Nubank:
    "Nuuvem *Nuuvem - Parcela 1/2", R$ 52,50 em 15/09. Nome, valor e dia diferentes — é a mesma
    compra, e a camada de parcela a reconhece pelo contrato (1 de 2, centavo de arredondamento)."""
    existentes = [
        tx("w1", "Wardogs (1/2)", 5249, D(2026, 9, 21), merchant="Nuuvem",
           installment_plan_id="pw", installment_no=1, plan_installments=2),
        tx("w2", "Wardogs (2/2)", 5249, D(2026, 10, 21), merchant="Nuuvem",
           installment_plan_id="pw", installment_no=2, plan_installments=2),
        tx("tv1", "tv (1/2)", 5250, D(2026, 9, 10), installment_plan_id="ptv", installment_no=1, plan_installments=2),
    ]
    v = conciliar([item(0, "Nuuvem *Nuuvem - Parcela 1/2", 5250, D(2026, 9, 15))],
                  existentes, conta_id=CARTAO, cartao=True)[0]
    um(v, camada="parcela", transaction_id="w1")


def test_sem_ia_a_estrutura_ainda_tira_o_que_nao_e_gasto_nem_receita():
    from app.domain.reconcile import natureza_estrutural

    linhas = [
        ("income", 2500, D(2026, 8, 1), "Valor adicionado na conta por cartão de crédito"),
        ("expense", 2500, D(2026, 8, 1), "Transferência enviada pelo Pix - Fulana"),
        ("expense", 2500, D(2026, 8, 2), "Mercado"),  # mesmo valor, OUTRO dia: é gasto
        ("expense", 194710, D(2026, 8, 5), "Transferência enviada pelo Pix - GABRIEL ALMEIDA DIAS - BB"),
        ("expense", 9000, D(2026, 8, 29), "Pix - Gabriel Souza"),  # só o primeiro nome: não é ele
    ]
    n = natureza_estrutural(linhas, cartao=False, titular="Gabriel Almeida Dias")
    assert n == ["transferencia_propria", "transferencia_propria", None, "transferencia_propria", None]
    assert natureza_estrutural(linhas, cartao=True, titular="Gabriel Almeida Dias") == [None] * 5
    assert natureza_estrutural(linhas[3:4], cartao=False, titular="Gabriel") == [None], "um nome só não basta"


def test_saldo_adiado_casa_com_diferenca_de_centavos():
    """Fatura real de 10/2026: o banco disse 371,66 e o app adiou 371,64."""
    v = conciliar([item(0, "Valor pendente do mês anterior (rotativo)", 37166, D(2026, 9, 10))],
                  [tx("t", "Saldo em rotativo de setembro", 37164, D(2026, 9, 10), rollover=True)],
                  conta_id=CARTAO, cartao=True)
    um(v[0], status="duplicate", camada="saldo_anterior", transaction_id="t")


def test_camada_semantica_liga_nomes_que_palavra_nenhuma_liga():
    from app.domain.reconcile import pares_para_julgar
    itens = [
        item(0, "Boleto no Crédito - ANDREA F M SILVA ODONTOLOGIA", 19357, D(2026, 9, 13)),
        item(1, "Pix no Crédito - RECEITA FEDERAL", 8868, D(2026, 9, 21)),
        item(2, "Mercadolivre*Mercadol", 4997, D(2026, 9, 11)),
        item(3, "Posto Y", 7000, D(2026, 9, 7)),
    ]
    existentes = [
        tx("dent", "Manutenção dentista", 17701, D(2026, 9, 10), previsto=True),
        tx("das", "DAS", 8885, D(2026, 9, 20), previsto=True),
        tx("longe", "Algo caro", 90000, D(2026, 9, 11)),       # valor longe: nem vai ao modelo
        tx("posto", "Posto Y", 7000, D(2026, 9, 7)),           # já casa por estrutura
    ]
    antes = conciliar(itens, existentes, conta_id=CARTAO, cartao=True)
    pares = pares_para_julgar(itens, existentes, antes, conta_id=CARTAO)
    assert (0, "dent") in pares and (1, "das") in pares
    assert not any(t in ("longe", "posto") for _, t in pares), pares

    v = conciliar(itens, existentes, conta_id=CARTAO, cartao=True,
                  julgamentos={(0, "dent"): "mesmo", (1, "das"): "mesmo"})
    # valor diferente do previsto: a pessoa confere — fica desmarcado e aponta o lançamento
    um(v[0], status="uncertain", camada="semantico", transaction_id="dent")
    assert "Manutenção dentista" in v[0].nota and "previsto R$ 177,01" in v[0].nota
    # 88,68 × 88,85 é valor próximo (≤ 1%): casa como "já está no app", com a data do app
    um(v[1], status="near_match", camada="semantico", transaction_id="das")
    um(v[2], status="novo")
    um(v[3], status="duplicate", camada="identico")


def test_semantica_incerto_ou_diferente_nao_casa():
    itens = [item(0, "Loja A", 5000, D(2026, 9, 1))]
    existentes = [tx("t", "Loja B", 5400, D(2026, 9, 2))]
    for j in ("incerto", "diferente"):
        v = conciliar(itens, existentes, conta_id=CARTAO, cartao=True, julgamentos={(0, "t"): j})
        assert v[0].camada != "semantico", j
