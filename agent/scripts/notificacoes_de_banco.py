"""Notificações de banco no formato que os apps mandam — os casos da sonda e do simulador.

Só dado, sem import: `probe_captura_notificacao.py` (o modelo direto) e `scripts/simular-notificacao.py`
(o caminho inteiro, pelo aparelho ou pela rota) leem daqui, para os dois testarem os mesmos textos.
SINTÉTICOS no formato comum dos bancos; trocar por reais (anonimizados) quando houver.

(pacote, título, texto, esperado) — esperado: ("expense"|"income", centavos) ou None (não lança).
"""

CASOS = [
    ("com.nu.production", "Compra aprovada", "Compra de R$ 45,90 APROVADA em MERCADO SAO JOSE para o cartão com final 1234.", ("expense", 4590)),
    ("com.nu.production", "Pix enviado", "Você enviou um Pix de R$ 120,00 para Maria Silva.", ("expense", 12000)),
    ("com.nu.production", "Pix recebido", "Você recebeu um Pix de R$ 1.500,00 de EMPRESA LTDA.", ("income", 150000)),
    ("com.itau", "Itaú", "Compra aprovada no cartão final 9876 de R$ 89,90 em IFOOD *RESTAURANTE em 12/10 às 13:02.", ("expense", 8990)),
    ("br.com.intermedium", "Pix", "Pix de R$ 35,00 recebido de JOAO P.", ("income", 3500)),
    ("com.c6bank.app", "Compra no débito", "Compra no débito de R$ 12,50 em PADARIA PAO QUENTE.", ("expense", 1250)),
    ("com.mercadopago.wallet", "Você pagou", "Você pagou R$ 59,99 para Netflix.", ("expense", 5999)),
    ("br.com.bb.android", "BB", "Transferência de R$ 200,00 enviada para CONTA 12345-6.", ("expense", 20000)),
    ("com.nu.production", "Fatura fechada", "A fatura do seu cartão fechou no valor de R$ 1.234,56. Vence em 20/10.", None),
    ("com.nu.production", "Limite", "Seu limite disponível agora é de R$ 800,00.", None),
    ("com.picpay", "Cashback", "Você ganhou R$ 5,00 de cashback! Use até 30/10.", None),
    ("com.itau", "Saldo", "Seu saldo em conta é R$ 3.210,00.", None),
    ("com.santander.app", "Oferta", "Empréstimo pré-aprovado de até R$ 10.000,00. Contrate agora!", None),
    ("com.bradesco", "Compra negada", "Compra de R$ 300,00 em LOJA X foi NEGADA por saldo insuficiente.", None),
    ("com.nu.production", "Compra aprovada", "Compra de R$ 600,00 em 3x APROVADA em MAGAZINE LUIZA.", ("expense", 60000)),
    ("br.com.gabba.Caixa", "Pagamento", "Pagamento de boleto de R$ 150,75 realizado com sucesso.", ("expense", 15075)),
]
