"""Frases da correção de compra parcelada, num lugar que grafo e tools podem ler.

A mesma recusa sai de dois pontos — `policy.erro_de_correcao` (antes do SIM) e a
tool (segunda trava) —, e duas cópias do texto divergiriam.
"""

SEM_CORRECAO = ("O que você quer mudar: o valor, o nome, a categoria, a data, a conta ou o "
                "número de parcelas? Ainda não mudei nada.")
# Uma PARCELA solta (não a compra inteira) não troca de conta: a compra é uma só, num cartão.
CONTA_DO_PLANO = ("A conta é da compra inteira, não de uma parcela. Me pede para mudar a "
                  "conta da compra toda. Ainda não mudei nada.")
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
# Uma PARCELA solta não reparcela nada; a compra inteira sim (`erro_de_correcao`).
MUDAR_PARCELAS = "Para mudar o número de parcelas, me pede sobre a compra inteira." + NADA
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


# Desparcelar (21/09/2026) — `update_installment_plan` com `p_installments = 1`, o chip
# "À vista" do app. Só a volta para 1x: reparcelar para outro N continua `MUDAR_PARCELAS`.
JA_A_VISTA = "Esse lançamento já é à vista." + NADA
# neutra: o 1 pode ser ruído do modelo numa correção de valor ("a tv foi 3000")
VALOR_COM_DESPARCELAR = ("Não entendi se é para voltar a compra para à vista ou corrigir o "
                         "valor. Me diz uma coisa de cada vez." + NADA)


def plano_travado(nome: str) -> str:
    """Conta, data da 1ª parcela e nº de parcelas travam com QUALQUER parcela paga (ou
    em fatura fechada/paga em parte) — a regra 2 de `update_installment_plan`."""
    return (f"A compra {nome} já tem parcela paga ou numa fatura fechada: a conta, a data e "
            "o número de parcelas não mudam mais. Dá para corrigir o total, o nome e a "
            "categoria." + NADA)


def conta_ambigua(nomes: list[str]) -> str:
    return (f"Encontrei mais de uma conta: {', '.join(nomes)}. Diga qual conta ou cartão "
            "deve ficar na compra." + NADA)


def desparcelar_travada(nome: str) -> str:
    return (f"A compra {nome} tem parcela já paga ou numa fatura fechada — não dá para "
            "voltar para à vista." + NADA)


def e_desparcelar(action) -> bool:
    """`update_transaction` com 1 parcela: sobre um PLANO é desparcelar; quem decide se o
    alvo é plano é o resolvedor. Nenhum campo novo no schema (teto de 252)."""
    return (getattr(getattr(action, "type", None), "value", None) == "update_transaction"
            and getattr(action, "installments", None) == 1)


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


def conta_nova_do_plano(action, target: dict | None, cand: dict) -> tuple[dict | None, str | None]:
    """(conta nova, erro) de uma correção de CONTA na compra inteira. Pura.

    `new_account_opcoes` são as contas que casam com o nome citado, congeladas pelo
    resolvedor (`resolve._opcoes_de_conta`). A conta que a compra JÁ tem entre elas é
    DESCRIÇÃO, não troca: "foi à vista no nubank" com a compra no Nubank Cartão (e uma
    conta Nubank ao lado) não muda conta nenhuma — era o caso que caía em "muda no app".
    """
    if not getattr(action, "new_account", None):
        return None, None
    opcoes = (target or {}).get("new_account_opcoes")
    if opcoes is None:
        # alvo de antes do deploy: sem as opções congeladas o SIM não sabe qual conta
        return None, "Ainda não mudei nada. Me pede de novo."
    atual = cand.get("account_id")
    casa = {o.get("id") for o in opcoes} | set((target or {}).get("new_account_casa") or [])
    if atual and str(atual) in casa:
        return None, None
    if len(opcoes) == 1:
        return opcoes[0], None
    return None, conta_ambigua([o["name"] for o in opcoes])


def muda_numero_de_parcelas(action, cand: dict) -> bool:
    """N → M (2..72) na compra inteira. Igual ao N atual é pista de busca; 1 é desparcelar."""
    n = getattr(action, "installments", None)
    return bool(n) and n >= 2 and n != cand.get("plan_installments")
