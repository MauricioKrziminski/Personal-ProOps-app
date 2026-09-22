# "E se…": adiantar parcelas — desenho (21/09/2026)

Pedido do dono do produto: *"poder adiantar parcelas de um lançamento ou adiantar parcelas de um
financiamento (adiantar qualquer gasto fixo/recorrente ou periódico como parcelas)"*.

## O que é adiantar, em caixa

Adiantar N parcelas é MOVER dinheiro que já está na projeção: aquelas N parcelas deixam de sair
no dia delas e sai UM valor numa data escolhida. O rascunho existente só sabia somar dinheiro
novo; a peça que faltava é o "desfazer" de uma saída.

## Decisões

| decisão | escolha | por quê |
|---|---|---|
| onde mora a aritmética | banco: `draft_ocorrencias` ganha `mode = 'cancel'` (uma ocorrência, valor negativo) | todas as portas da projeção (dia, mês, agente) somam `cents` por `kind` — nenhuma muda, e não nasce uma segunda cópia da conta |
| em que DIA cancelar | o dia que a base usa, devolvido pelo banco (`anticipation_candidates`) | parcela de cartão sai no vencimento da FATURA, não na data da parcela; cancelar no dia errado cria uma saída fantasma num dia e deixa a verdadeira no outro |
| o que entra | compra parcelada, financiamento (cronograma) e recorrente de saída | "qualquer gasto fixo/recorrente ou periódico" |
| o que NÃO entra | parcela paga, em fatura fechada/paga/adiada, ou já vencida | a régua de `parcela_travada`; o que venceu é atraso, não adiantamento |
| quais parcelas | "As últimas" (padrão) ou "As próximas"; recorrente só "as próximas" | adiantar pelo fim é o normal de banco e de financiamento (encurta o prazo); recorrente não tem fim |
| valor sugerido | financiamento com taxa: valor presente de cada parcela no dia do pagamento, por meses inteiros; cartão e recorrente: nominal | CDC art. 52 §2º (quitação antecipada com redução proporcional dos juros). É estimativa: o campo é EDITÁVEL, porque o número exato é o que o banco informar |
| data do pagamento | o `MonthPicker` que o sheet já tem ("Pagar em"); no mês corrente, hoje | mesmo controle das outras hipóteses |
| horizonte | amplia até a ÚLTIMA parcela tirada (teto de 10 anos) | com "as últimas" de um financiamento, uma janela de 90 dias mostraria só o custo e esconderia o ganho |
| vida do rascunho | a mesma: `useState` da Projeção, some ao sair | contrato existente |

## Formato

`anticipation_candidates(p_pay_on)` devolve JSON (não `setof`): um financiamento de 48 parcelas e
duas recorrentes em dois anos passariam das 1000 linhas que o PostgREST corta em silêncio.

    [{source: 'plan'|'debt'|'recurring', ref_id, title, account_name, total_n, taxa,
      events: [{n, day, cents, pv_cents}]}]

Uma hipótese de adiantar vira, no cliente, `1 + N` drafts do motor existente, marcados com o
mesmo `grupo`: uma saída (`mode: 'total'`, 1x) no dia do pagamento e um `cancel` por parcela.
A lista de hipóteses mostra o grupo como UMA linha, e "Tirar" remove o grupo inteiro.

## O que o rascunho continua NÃO fazendo

Move o CAIXA, e só (finance.md): não remonta fatura, orçamento nem cronograma de dívida.
