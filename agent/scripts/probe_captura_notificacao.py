"""Sonda: o texto de uma notificação de banco vira o lançamento certo — ou nenhum.

Roda no Gemini GRATUITO (IA_TABELA=economica) e imprime quantas chamadas fará antes de fazer.
Textos SINTÉTICOS no formato comum dos bancos; trocar por reais (anonimizados) quando houver.

    cd agent && .venv/bin/python scripts/probe_captura_notificacao.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("IA_TABELA", "economica")
os.environ["LANGFUSE_PUBLIC_KEY"] = ""

from app.graph import nodes  # noqa: E402
from scripts.eval_cache import com_paciencia  # noqa: E402
from app.routes.captures import origem_da_notificacao, texto_da_notificacao  # noqa: E402

# (banco, título, texto, esperado) — esperado: ("expense"|"income", centavos) ou None
CASOS = [
    ("Nubank", "Compra aprovada", "Compra de R$ 45,90 APROVADA em MERCADO SAO JOSE para o cartão com final 1234.", ("expense", 4590)),
    ("Nubank", "Pix enviado", "Você enviou um Pix de R$ 120,00 para Maria Silva.", ("expense", 12000)),
    ("Nubank", "Pix recebido", "Você recebeu um Pix de R$ 1.500,00 de EMPRESA LTDA.", ("income", 150000)),
    ("Itaú", "Itaú", "Compra aprovada no cartão final 9876 de R$ 89,90 em IFOOD *RESTAURANTE em 12/10 às 13:02.", ("expense", 8990)),
    ("Inter", "Pix", "Pix de R$ 35,00 recebido de JOAO P.", ("income", 3500)),
    ("C6 Bank", "Compra no débito", "Compra no débito de R$ 12,50 em PADARIA PAO QUENTE.", ("expense", 1250)),
    ("Mercado Pago", "Você pagou", "Você pagou R$ 59,99 para Netflix.", ("expense", 5999)),
    ("Banco do Brasil", "BB", "Transferência de R$ 200,00 enviada para CONTA 12345-6.", ("expense", 20000)),
    ("Nubank", "Fatura fechada", "A fatura do seu cartão fechou no valor de R$ 1.234,56. Vence em 20/10.", None),
    ("Nubank", "Limite", "Seu limite disponível agora é de R$ 800,00.", None),
    ("PicPay", "Cashback", "Você ganhou R$ 5,00 de cashback! Use até 30/10.", None),
    ("Itaú", "Saldo", "Seu saldo em conta é R$ 3.210,00.", None),
    ("Santander", "Oferta", "Empréstimo pré-aprovado de até R$ 10.000,00. Contrate agora!", None),
    ("Bradesco", "Compra negada", "Compra de R$ 300,00 em LOJA X foi NEGADA por saldo insuficiente.", None),
    ("Nubank", "Compra aprovada", "Compra de R$ 600,00 em 3x APROVADA em MAGAZINE LUIZA.", ("expense", 60000)),
    ("Caixa", "Pagamento", "Pagamento de boleto de R$ 150,75 realizado com sucesso.", ("expense", 15075)),
]
CRIA = {"create_expense", "create_income", "create_installment_purchase", "mark_paid"}


async def main() -> int:
    print(f"{len(CASOS)} chamadas ao modelo (parse).")
    erros = 0
    for banco, titulo, texto, esperado in CASOS:
        estado = {"text": texto_da_notificacao(titulo, texto), "origem": origem_da_notificacao(banco),
                  "timezone": "America/Sao_Paulo", "workspace_id": None, "messages": None,
                  "agora_local": "2026-10-12T13:05:00"}
        saida = await com_paciencia(lambda: nodes.finance_node(estado))
        acoes = [a for a in saida.get("finance_actions", []) if a.get("type") in CRIA]
        obtido = None
        if acoes:
            a = acoes[0]
            obtido = ("income" if a["type"] == "create_income" else "expense", a.get("amount_cents"))
        ok = obtido == esperado
        erros += not ok
        print(("ok   " if ok else "FALHA"), banco, "|", texto[:60], "→", obtido, "" if ok else f"(esperado {esperado})")
    print(f"\n{len(CASOS) - erros}/{len(CASOS)}")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
