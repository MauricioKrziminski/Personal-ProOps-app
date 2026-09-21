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

# D1 — parcelar um lançamento que já existe (`convert_transaction_to_installments`).
# As recusas da RPC que dá para saber ANTES do SIM, com o texto dela.
NADA = " Ainda não mudei nada."
MUDAR_PARCELAS = "Mudar o número de parcelas é em Editar a compra no app." + NADA
LIMITE_PARCELAS = "Escolha pelo menos 2 parcelas (e no máximo 72)." + NADA
SEM_CARTAO = ("Você não tem cartão cadastrado, e uma compra parcelada precisa de um. "
              "Cadastre o cartão no app e me pede de novo." + NADA)
CARTAO_FALTANDO = "Não sei em qual cartão parcelar." + NADA + " Me manda de novo dizendo o cartão."
LINHA_SUMIU = "🤷 Esse lançamento não está mais aqui." + NADA


def e_conversao(action) -> bool:
    """D1: `update_transaction` com 2+ parcelas pode ser "parcelar um lançamento que já
    existe" — quem decide se o ALVO aceita é o resolvedor (`resolve.conversoes`)."""
    return (getattr(getattr(action, "type", None), "value", None) == "update_transaction"
            and (getattr(action, "installments", None) or 0) >= 2)


def qual_cartao(nomes: list[str]) -> str:
    return f"Em qual cartão? Você tem: {', '.join(f'*{n}*' for n in nomes)}. Me manda de novo dizendo o cartão."


def recusa_de_conversao(linha: dict, parcelas: int) -> str | None:
    """A recusa da RPC que o estado da linha já decide — `None` quando dá para parcelar."""
    if linha.get("installment_plan_id"):
        return None if linha.get("plan_installments") == parcelas else MUDAR_PARCELAS
    if not 2 <= parcelas <= 72:
        return LIMITE_PARCELAS
    if linha.get("kind") != "expense":
        return "Só gasto vira compra parcelada." + NADA
    if linha.get("recurring_id"):
        return ("Esse lançamento é uma ocorrência de uma série recorrente: edite a série, "
                "não a ocorrência." + NADA)
    if linha.get("debt_id"):
        return ("Esse lançamento é a parcela de um financiamento: o cronograma dele manda "
                "na divisão." + NADA)
    if linha.get("rollover_of_invoice_id"):
        return ("Esse lançamento é o saldo adiado de uma fatura: ele não é uma compra nova "
                "para parcelar." + NADA)
    if linha.get("fatura_travada"):
        return ("A fatura desse lançamento já foi paga, adiada ou paga em parte: ele não pode "
                "ser parcelado agora." + NADA)
    return None
