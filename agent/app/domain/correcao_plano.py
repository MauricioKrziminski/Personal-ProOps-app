"""Frases da correção de compra parcelada, num lugar que grafo e tools podem ler.

A mesma recusa sai de dois pontos — `policy.erro_de_correcao` (antes do SIM) e a
tool (segunda trava) —, e duas cópias do texto divergiriam.
"""

SEM_CORRECAO = "O que você quer mudar: o valor, o nome, a categoria ou a data? Ainda não mudei nada."
DATA_DO_PLANO = "A data de uma compra parcelada muda em Editar a compra no app. Ainda não mudei nada."
CONTA_DO_PLANO = "A conta de uma compra parcelada muda em Editar a compra no app. Ainda não mudei nada."
VARIAS_PARCELAS = "Consigo corrigir a compra inteira (as parcelas em aberto) ou uma parcela por vez."
PARCELA_TRAVADA = (
    "Essa parcela já foi paga (ou a fatura dela foi paga): o valor, a data e a conta "
    "dela não mudam mais. Ainda não mudei nada."
)
QUAL_PARCELA = 'Não achei essa parcela nessa compra. Diga qual corrigir, por exemplo "a 3ª parcela".'
NADA_EDITAVEL = "Nenhuma parcela dessa compra pode mudar mais — todas já foram pagas. Ainda não mudei nada."
