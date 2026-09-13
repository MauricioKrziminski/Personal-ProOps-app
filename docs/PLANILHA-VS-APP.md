# A planilha e o app, conciliados até o centavo (13/09/2026)

Conferido contra `Planilha de gastos.xlsm`, aba **Setembro 26**, e contra os dados REAIS de
produção clonados no staging (`scripts/clone-prod-para-staging.py`).

## A régua da planilha não é a que o rótulo diz

A célula `H2` escreve **"03 Agosto -> 02 Setembro"** e foi por isso que a comparação começou
errada. Esse rótulo descreve **só quais compras de cartão estão dentro** — é a janela da fatura
do Nubank (fecha dia 3). A régua do BUCKET é outra, e é dupla:

| o que | régua da planilha |
|---|---|
| salário, pix, boleto, parcela de financiamento | **mês civil** (01/09 a 30/09) |
| cartão | a **fatura que VENCE** naquele mês (as duas vencem 10/09) |

É por isso que a aba "Setembro" contém o Pix do dia 5, o salário do dia 20, o Fundacred do dia 31
e a parcela do Carro do dia 23 — todos fora de "03 Agosto → 02 Setembro" — e contém as compras
de 03/08 a 02/09, que é a fatura paga em 10/09. Foi exatamente o que o Gabriel descreveu: *"pix
que eu faço entre o dia 3 de setembro até o dia 10, eu coloco na planilha no periodo 3 de agosto
até 2 setembro"*.

O app, hoje, tem a metade de cima (`MonthRuler` → Mês civil) e **não tem a de baixo**: cartão é
sempre por COMPETÊNCIA, na data da compra.

## A conta fecha

Somando o mês civil + a fatura que vence no mês, o app daria:

| bloco | planilha | app (civil + fatura) |
|---|---|---|
| Financiamento (Empr. Nubank 781,64 + Empr. Nubank 2 858,87) | 1.640,51 | 1.640,51 ✓ |
| Pix (Fundacred, 30/09) | 1.198,85 | 1.198,85 ✓ |
| Itaú / Carro (parcela 8, 23/09) | 1.485,00 | 1.485,00 ✓ |
| BB (fatura vence 10/09) | 1.432,51 | 1.432,51 ✓ |
| Nubank (fatura vence 10/09) | 3.271,77 | 3.260,64 |
| **Total de saídas** | **9.028,64** | **9.017,51** |

**Resíduo: R$ 11,13 — e ele também é explicado.** A planilha lança
`Juros de pagamento parcial da fatura (rotativo)` em **54,07** e o app em **42,97** (−11,10), e
`Saldo em rotativo de agosto` em **333,75** contra **333,72** (−0,03). São os dois números que
`finance.md` já declara ESTIMATIVA: a taxa do rotativo é observada da última cobrança real, não
cravada. Nada de estrutura.

## As entradas divergem por DADO, não por régua

| planilha | valor | app | diferença |
|---|---|---|---|
| Salário (2 partes) | 2.632,00 | 2.636,02 | +4,02 |
| Salário PJ | 4.000,00 | 4.000,00 | — |
| Pix Winicius | 420,00 | 420,00 | — |
| Pix pai carro | 350,00 | 350,00 | — |
| Pix Maurício | 160,50 | **não existe** | −160,50 |
| Pix mãe controle | 60,00 | **não existe** | −60,00 |
| Freela Scai Entrada | 225,00 | **não existe** | −225,00 |
| Cashback Nubank | 38,90 | 1,90 | −37,00 |
| Crédito em conta | — | 33,70 | +33,70 |
| **Total** | **7.886,40** | **7.441,62** | **−444,78** |

São R$ 444,78 que nunca foram lançados no app. `Saldo Agosto` (770,57) fica de fora da conta dos
dois lados: na planilha ele é linha de entrada, no app é o `Comecei setembro com`.

## O que o app mostra hoje, e por quê

Na régua **Ciclo** (11/08 → 10/09, que é o `cycle_close_day = 10` configurado):
entrou 6.293,62 · saiu 6.949,24 · resultado **−655,62**.

As saídas ali são Nubank 3.815,87 (por competência) + BB 294,01 (por competência) +
Conta corrente 2.839,36. A parcela do Carro (23/09) cai no ciclo SEGUINTE — não some, muda de
balde.

## ⚠️ Um defeito achado no caminho

O bloco **"Faturas do período"** da tela do Mês soma só as compras que caem na janela, então ele
escreve `Nubank · vence 10/09/2026 · R$ 767,91` — e a fatura de verdade é **R$ 3.260,64**. Tocar
na linha abre a tela da fatura, que mostra o valor cheio. O número da linha discorda da tela para
onde ela leva, sem erro nenhum.

Sai de `faturasDoPeriodo` em `src/app/finance/month.tsx:124` — o agrupamento é feito sobre as
linhas do período, não sobre a fatura.

## A `debt_installments_undocumented = 16`

Dezesseis parcelas estão marcadas como pagas no cadastro das dívidas sem transação
correspondente. Elas não pesam em mês nenhum do app, então **meses passados vão divergir da
planilha por construção** — só setembro fecha porque as duas de setembro (Empr. Nubank e Empr.
Nubank 2) foram lançadas como transação.

## O que fazer — hoje, e o que falta construir

### Hoje, sem código: trocar a régua para **Mês** na tela do Mês

Medido no emulador com os dados reais clonados: `01/09 – 30/09` → entrou **7.441,62**, saiu
**7.800,37**, resultado **−358,75**. Do lado das ENTRADAS isso já é a planilha — a diferença
cai para os R$ 444,78 de lançamento que falta, e nada mais.

⚠️ **O `cycle_close_day = 10` configurado em produção não é a régua da planilha.** Ele foi
configurado para o dia do pagamento, e por isso a tela abre em 11/08–10/09 enquanto a planilha
raciocina em mês civil. Não precisa apagar a configuração: `MonthRuler` é por TELA.

### O que falta: uma BASE, não uma régua

O que sobra depois de trocar a régua é só o cartão, e o buraco é o **BB**: no mês civil ele
aparece por **199,10** e a fatura que ele paga em 10/09 é **1.432,51**. O BB fecha no último dia
do mês, então a fatura vencida em 10/09 é quase toda de agosto.

⚠️ **E o Nubank bate por coincidência, o que é pior que não bater.** No mês civil ele soma
3.276,91 e a planilha escreve 3.271,77 — cinco reais de distância, e são MESES DIFERENTES:
3.276,91 é a fatura que vence em **10/10**, e a planilha está falando da que vence em **10/09**
(3.260,64). Dois números parecidos que não descrevem a mesma coisa é exatamente a divergência
que não dá erro.

**A proposta é um eixo novo, ortogonal ao `MonthRuler`: `Competência | Caixa`.**

| base | o cartão aparece como |
|---|---|
| **Competência** (hoje, e continua o padrão) | cada compra, na data da compra |
| **Caixa** | UMA linha `Fatura Nubank · vence 10/09 · R$ 3.260,64`, na data do VENCIMENTO |

Fora do cartão nada muda — pix, salário e boleto já estão na data em que acontecem.

**Por que isto não é a régua "Fatura" que já foi recusada.** A objeção registrada em
`finance.md` é sobre a JANELA: *"with several cards with different closing dates you cannot align
to all of them"*. Ela continua de pé e não se aplica aqui, porque base de caixa **não escolhe
fechamento nenhum** — cada fatura cai sozinha no período que contém o vencimento dela, com
qualquer quantidade de cartões. É o argumento que o próprio arquivo já faz ao descrever o modelo
do Organizze; o que existe hoje é a metade visual dele (o bloco "Faturas do período"), sem os
números terem acompanhado.

**Não escrever aritmética nova.** A regra "fatura no vencimento, `status not in ('paid','rolled')`"
já existe na projeção de caixa — a base Caixa lê ela, nunca uma segunda cópia.

### E o bloco "Faturas do período" vira a linha da fatura

Na base Caixa o bloco deixa de ser um agrupamento informativo e passa a ser a própria linha, com
o valor cheio — o mesmo caminho de código resolve o defeito descrito acima.

---

# O saldo mês a mês (13/09/2026)

## A tela já existe: Projeção → "Por mês" → régua **Mês**

`SALDO MÊS A MÊS, CARREGANDO A SOBRA`, com `veio de X · entra Y · sai Z` em cada mês — é a
mesma estrutura da planilha, e **a Projeção já trata o cartão por CAIXA** (fatura inteira na data
do vencimento, `status not in ('paid','rolled')`). A régua que falta na tela do Mês já está
pronta aqui.

Medido no emulador com os dados reais clonados:

| mês (régua Mês) | app | planilha |
|---|---|---|
| Setembro 2026 | −707,92 | −371,67 |
| Outubro 2026 | −941,77 | −429,56 |
| Novembro 2026 | −220,41 | −105,22 |

## O carry-over de setembro foi digitado à mão DE PROPÓSITO

`Setembro 26!R8` é `770.57` cravado, enquanto todas as outras abas usam
`='<mês anterior>'!R40`. **Isso não é erro:** agosto estava incompleto (faltava lançamento), e o
Gabriel reabriu a corrente com o valor certo em vez de arrastar um agosto pela metade. De
setembro em diante os links voltam a funcionar e a planilha está correta.

> Esta seção já afirmou que era um "elo quebrado" de R$ 360,52. Estava errado — a diferença
> entre `Agosto!R40` (410,05) e o 770,57 é exatamente a correção manual, não uma falha.

**Setembro é o marco zero: dali para trás é histórico, dali para frente é o que vale.**

## O que separa o app da planilha em setembro: R$ 336,25, e ele fecha exato

App fecha setembro em **−707,92**, planilha em **−371,67**. A conta é esta, sem sobra:

| parte | efeito no app |
|---|---|
| abertura de setembro — app 867,97 (saldo inicial da Conta corrente), planilha 770,57 | **+97,40** |
| quatro entradas que a planilha tem e o app não | **−444,78** |
| juros do rotativo — app 42,97, planilha 54,07 (+3 centavos no saldo adiado) | **+11,13** |
| **total** | **−336,25** |

As quatro entradas, item a item:

| entrada | planilha | app |
|---|---|---|
| Pix Maurício | 160,50 | não existe em setembro — o recorrente só materializa a partir de **05/10** |
| Pix mãe controle | 60,00 | não existe |
| Freela Scai Entrada | 225,00 | não existe |
| Cashback Nubank | 38,90 | 1,90 (faltam 37,00) |
| Crédito em conta | não existe | 33,70 |
| Salário (as duas partes) | 2.632,00 | 2.636,02 |

`482,50 − 33,70 − 4,02 = 444,78`.

## Para outubro bater: as seis linhas que faltam na planilha

Corrigido setembro, o app vai para **−605,52** em outubro e a planilha para **−429,56**. Os
**R$ 175,96** que sobram são seis lançamentos que o app tem e a planilha ainda não, mais o
arredondamento do salário:

| o que | valor | onde está |
|---|---|---|
| IOF Claude | 19,86 | fatura Nubank vence 10/10 — a planilha não prevê IOF de assinatura em dólar |
| IOF ChatGPT | 19,12 | idem |
| Shopee *Shpstecnologia (06/09) | 19,99 | compra de setembro ainda não lançada na planilha |
| Auto Posto Costa Costa (07/09) | 70,00 | idem |
| Auto Posto Costa Costa (07/09) | 14,00 | idem |
| Casa do Açaí Cafe (04/09) | 37,00 | idem |
| **soma** | **179,97** | |
| salário (app 2.636,02 × planilha 2.632,00) | −4,02 | |
| **resta** | **175,95** | (1 centavo de arredondamento) |

⚠️ **E tem um item no cartão trocado, que NÃO muda o total.** `Anthropic* Claude Sub` 567,64
está na fatura do **Nubank** no app e em **BB** na planilha. Por isso o BB de outubro é 199,10 no
app e 766,71 na planilha, e o Nubank é o inverso. O total de saídas é o mesmo — mas um dos dois
está no cartão errado, e vale conferir na fatura.

## Duas coisas a saber sobre a tela

- **"Outubro de 2026" na régua Ciclo é 11/09 a 10/10**, não outubro. O rótulo é o mês em que o
  ciclo TERMINA. Comparando com a planilha, use a régua **Mês**.
- **A projeção vai 90 dias por padrão** e por isso termina em janeiro/2027. O horizonte se
  estende pelo ícone de calendário no header (atalhos até 10 anos, ou data exata).
