"""Notificações de banco no formato que os apps mandam — os casos da sonda e do simulador.

Só dado, sem import: `probe_captura_notificacao.py` (o modelo direto) e `scripts/simular-notificacao.py`
(o caminho inteiro, pelo aparelho ou pela rota) leem daqui, para os dois testarem os mesmos textos.
Os 16 primeiros são SINTÉTICOS no formato comum dos bancos; os demais trazem a origem em comentário
(`# real: <url>`, `# fixture de terceiro: <url>`, `# sintético`).

(pacote, título, texto, esperado) — esperado:
  ("expense"|"income", centavos)  o rascunho final traz esse tipo e esse valor;
  ("expense"|"income", None)      o rascunho nasce SEM valor e com a pergunta "Confira o valor"/moeda;
  None                            não lança.
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
    # real: https://homeassistantbrasil.com.br/t/extrair-notificacoes-do-nubank/7233
    ("com.nu.production", "", "Compra de R$ 8,99 APROVADA em Google playstore.", ("expense", 899)),
    # real: https://homeassistantbrasil.com.br/t/extrair-notificacoes-do-nubank/7233
    ("com.nu.production", "", "Compra de R$ 89,99 REPROVADA em Kabum", None),
    # real: https://github.com/peklerbruno-dot/diario-de-treino/pull/69
    ("com.nu.production", "Compra no débito aprovada", "Compra de R$ 17,00 em ACADEMIA CEMI", ("expense", 1700)),
    # real: https://mochileiros.com/topic/19351
    ("com.itau", "Itaú", "Compra não aprovada de R$1.250,00 no seu ITAU MASTER final 1234. Favor contatar a Central de Atendimento.", None),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("br.com.intermedium", "Inter", "Olá Vinicius, você acaba de comprar no débito no BGC BRASILIA GUARA CEN o valor de R$ 63,80.", ("expense", 6380)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("br.com.intermedium", "Inter", "Compra no debito de R$ 26,47 no ATACADAO. Toque para ver detalhes.", ("expense", 2647)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("br.com.intermedium", "Inter", "Debito de R$ 89,90 - NETFLIX. Clique para gerenciar sua assinatura.", ("expense", 8990)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("br.com.intermedium", "Inter", "Pix enviado: R$ 1.200,00 para JOAO S. Toque para ver o comprovante.", ("expense", 120000)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("br.com.intermedium", "Transferência recebida", "Transferência recebida de VINICIUS C. no valor de R$ 500,00", ("income", 50000)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts) — dois valores
    ("com.nu.production", "Compra aprovada", "Compra de R$ 20,00 aprovada em PADARIA CENTRAL. Limite disponível: R$ 1.980,00", ("expense", 2000)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts) — parcela dita, total esperado
    ("com.nu.production", "Compra aprovada", "Compra parcelada em 3x de R$ 100,00 APROVADA em MAGAZINE LUIZA.", ("expense", 30000)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("com.nu.production", "Estorno", "Estorno de compra de R$ 35,90 em IFOOD creditado.", ("income", 3590)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("com.nu.production", "Pix enviado", "Você enviou R$ 500,00 para VINICIUS C. via Pix.", ("expense", 50000)),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("com.nu.production", "Sua fatura fechou", "A fatura do cartão fechou em R$ 3.832,80. O pagamento vence em 02/10.", None),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("com.nu.production", "Lembrete", "Sua fatura de R$ 3.832,80 vence amanhã. Faça o pagamento para evitar juros.", None),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("com.nu.production", "Boa notícia", "Seu limite subiu para R$ 5.000,00!", None),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("br.com.intermedium", "Inter", "Invista a partir de R$ 1 no CDB e resgate quando quiser! Toque para saber mais.", None),
    # fixture de terceiro: https://github.com/Ptedx/finance-app (captureParser.test.ts)
    ("br.com.intermedium", "Inter", "Simule seu empréstimo de até R$ 20.000. Clique aqui.", None),
    # sintético: compra internacional sem o valor em reais -> sem valor e com a pergunta da moeda
    ("com.nu.production", "Compra aprovada", "Compra de US$ 12,99 APROVADA em NETFLIX.COM", ("expense", None)),
    # sintético: compra internacional com o valor em reais junto -> vale o de reais
    ("com.nu.production", "Compra internacional", "Compra internacional de US$ 20,00 (R$ 110,40) aprovada em AMAZON", ("expense", 11040)),
    # sintético: pagamento de fatura não é lançamento (o gasto já contou nas compras)
    ("com.nu.production", "Pagamento da fatura", "Pagamento da fatura de R$ 1.234,56 realizado com sucesso.", None),
    # sintético: Pix devolvido é entrada
    ("com.nu.production", "Pix devolvido", "Pix devolvido: R$ 50,00 de LOJA X", ("income", 5000)),
    # sintético: sem R$ nem valor -> não lança (e nem chama o modelo)
    ("com.itau", "Itaú", "Seu código de verificação é 482913", None),
    # sintético: rendimento não é lançamento
    ("com.nu.production", "Rendimento", "Rendimento de R$ 12,34 na sua caixinha", None),
    # sintético: agendado para data futura não é lançamento
    ("com.nu.production", "Pix agendado", "Pix agendado de R$ 300,00 para 20/10", None),
]
