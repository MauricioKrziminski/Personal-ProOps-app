# Conciliação de setembro contra os documentos (09/09/2026)

Fonte da verdade: os arquivos que o Gabriel baixou. Nada aqui saiu de estimativa.

| documento | o que é | período |
|---|---|---|
| `Nubank_2026-09-10.pdf` | fatura Nubank que vence 10/09 | 03 AGO a 03 SET |
| `Nubank_2026-10-10.ofx` | fatura Nubank de outubro, **como está hoje** | 03/09 a 09/09 |
| `fatura.pdf` | fatura BB que vence 10/09 | ~01/08 a 31/08 |
| `NU_..._01AGO..31AGO.pdf` | extrato da conta Nubank | agosto |
| `NU_..._01SET..07SET.pdf` | extrato da conta Nubank | 01 a 07/09 |

Cada soma abaixo foi conferida linha a linha contra o documento.

---

## 1. Os R$ 10,49 — resolvidos, e não era o financiamento

O palpite era desconto por antecipação de empréstimo. Não é: **os empréstimos saíram pelo valor
cheio**, o mesmo em agosto e em setembro (extratos, dia 04 dos dois meses).

O que faltava eram duas coisas que nenhum extrato mostrava, porque as duas são de 08/09 — depois
do extrato fechar (gerado 08/09 23:59) e dentro do ciclo de outubro:

```
fatura de setembro                                    3.271,77
− pagamento de boleto      04/09 (extrato)            2.080,00
− pagamento recebido       08/09 (OFX outubro)          649,00
− pagamento recebido       08/09 (OFX outubro)          160,00
− estorno "Juros de pagamento parcial (rotativo)"
                           04/09 (OFX outubro)           11,10
                                                   ──────────
= em aberto                                             371,67
```

São **R$ 371,67**, contra os R$ 371,66 que você falou. O centavo é ruído do próprio Nubank: a
seção "Pagamentos e Financiamentos" da fatura soma −2.111,18 e o PDF escreve −2.111,15.

E os R$ 10,49 do cálculo anterior eram: o estorno de 11,10 menos os **R$ 0,62** que sobraram na
conta (você tinha 809,62 disponível e pagou 649,00 + 160,00 = **809,00**, não 809,62).

---

## 2. Defeito de produto encontrado no caminho: o dia do fechamento está do lado errado

`private.invoice_window` (0013) coloca a compra feita **no** dia do fechamento na fatura daquele
mês. O Nubank faz o contrário, e os dois documentos provam isso de lados opostos:

| evidência | o que diz |
|---|---|
| fatura de setembro, "Período vigente: 03 AGO a 03 SET" | contém **03 AGO** — Globo Premiere 2/10, Mercadolivre 2/2, Pneustore 6/10, King Cell 9/10 |
| OFX de outubro, `DTSTART 20260903` | contém **03 SET** — King Cell 10/10, Luizroberto 2/12, Pneustore 7/10, Globo 3/10 |

Ou seja, a janela real é `[fechamento anterior, fechamento atual)`: compra **no** dia 3 vai para a
fatura seguinte. Medido contra produção:

```
compra     | app diz que vence | Nubank cobra em
2026-08-03 | 10/08             | 10/09   ← um ciclo inteiro de diferença
2026-09-03 | 10/09             | 10/10   ← idem
2026-08-04 | 10/09             | 10/09   ✓
```

**Correção: `<=` vira `<` em `private.invoice_window`.** É um caractere, e passa por todos os
caminhos de uma vez — trigger `set_invoice`, app, agente, importação —, porque todos derivam dali.

Duas coisas que essa migration **não** faz, de propósito:

- **não move nenhuma linha existente.** `set_invoice` só dispara em `insert or update of
  account_id, occurred_at`. Quem remaneja é o UPDATE de data, linha a linha, mais abaixo.
- **não vale para o BB.** O BB fecha dia 31 e nenhum documento tem compra no dia 31 — não há
  evidência para nenhum dos dois lados. Fica como está.

> Alternativa sem código: pôr `closing_day = 2` no cartão Nubank. Rejeitada — o cartão passaria a
> dizer "fecha dia 2" enquanto o Nubank diz 3. O erro sairia da conta e entraria na tela.

`finance.md` afirma hoje *"Compra **até** o dia de fechamento cai na fatura do próprio mês"*. A
frase precisa mudar junto.

---

## 3. Fatura Nubank de setembro: R$ 2.472,37 no app, R$ 3.271,77 real

A fatura real é `fatura anterior 2.920,08 + compras 2.462,85 − pagamentos e financiamentos
2.111,15`. O app não tem "fatura anterior", então o saldo que rolou vira uma linha.

### 3.1 Faltam no app (compras do período, todas no PDF)

| data real | descrição no documento | valor |
|---|---|---|
| 05/08 | Apple.Com/Bill | 19,90 |
| 08/08 | Conta Vivo | 35,00 |
| 08/08 | Marcelao Beer Luck | 43,00 |
| 09/08 | Ec *Melimais | 19,90 |
| 10/08 | Nubank Croma | 29,00 |
| 12/08 | Servicos Cla*Claro | 20,00 |
| 21/08 | Apple.Com/Bill | 12,90 |
| 22/08 | Shopee *Autopecasfamaf — Parcela 1/3 | 140,12 |
| | **subtotal** | **319,82** |

As cinco primeiras existem no app como **recorrentes materializadas em setembro** (fatura de
outubro). Não são as mesmas: Apple e Melimais aparecem nos **dois** ciclos nos documentos. As de
agosto precisam ser criadas; as de setembro ficam onde estão.

### 3.2 Faltam no app (Pix no crédito — adiantamento vira compra na fatura)

| data | documento | valor | no app |
|---|---|---|---|
| 10/08 | ORAL PLATINUM | 177,00 | ausente (existe como recorrente "Manutenção dentista" na Conta corrente) |
| 20/08 | RECEITA FEDERAL | 88,85 | ausente (existe como recorrente "DAS" na Conta corrente) |
| 10/08 | Karen Alessandra 28,47 + 56,75 | 85,22 | "Pix Karen" 85,23 — **1 centavo a mais** |
| 10/08 | LUIZ ROBERTO CAMARGO TEIXEIRA | 67,90 | "Entrega Mac" ✓ |

### 3.3 Falta no app (o saldo que rolou de agosto)

| 10/08 | Saldo em rotativo | **333,72** |

Uma linha de despesa "Saldo em rotativo de agosto". **Não conta o gasto duas vezes**: a fatura de
agosto está `settled_manually`, e a `0046 §4` já exclui as linhas dela do saldo do cartão.

### 3.4 Está no app e não existe em documento nenhum

| 02/09 | **Despesa Gato — R$ 120,00** |

Não está na fatura, nem no extrato de agosto, nem no de setembro. **A conta só fecha sem ela.**

### 3.5 Datas erradas (a compra é a mesma, o dia é outro)

| app | vira | documento |
|---|---|---|
| Case Mac 04/08 | 05/08 | Shopee*As Place Ecomme |
| Tim multa 05/08 | 11/08 | Tim Pos |
| Globo Premiere (1/10) 11/08 | 03/08, **2/10** | Globo Premiere — Parcela 2/10 |
| Playground Gato ML (1/2) 18/08 · 56,43 | 03/08, **2/2**, 56,42 | Mercadolivre*Mercadol — Parcela 2/2 |
| Película Teclado Mac 02/09 | 05/08 | Mercado*Inovetecnolog |
| Entrega Mac 02/09 | 10/08 | LUIZ ROBERTO |
| Pix Karen 02/09 | 10/08 | Karen Alessandra |
| Vacina Gato 2/4 02/09 | 14/08 | Bicho Molhado Petcente |
| Acessorios Mac (1/2) 03/09 | 04/08 | Shopee*Solu Multimarca 1/2 |
| King Cell (9/10) 03/09 | 03/08 | King Cell Machado 9/10 |
| Mac (1/12) 03/09 | 04/08 | Luizroberto 1/12 |
| Pneu (6/10) 03/09 | 03/08 | Pneustore Cpx 6/10 |

⚠️ As quatro últimas só continuam na fatura de setembro **depois** da correção do §2. Com a regra
de hoje, mover para 03/08 as jogaria na fatura de agosto, que está paga.

### 3.6 A conta fecha

```
app hoje                                       2.472,37
+ compras que faltavam            (3.1)          319,82
+ Pix no crédito                  (3.2)          265,85
+ saldo em rotativo               (3.3)          333,72
− Despesa Gato                    (3.4)          120,00
− centavos (Pix Karen, Playground)                 0,02
                                              ─────────
                                               3.271,74
fatura real                                    3.271,77   (Δ 0,03 = ruído do PDF)
```

---

## 4. Fatura Nubank de outubro (OFX de hoje: R$ 2.904,05)

Todas as parcelas do Nubank são postadas **no dia 3**, qualquer que seja o dia da compra.

| falta lançar | valor |
|---|---|
| 04/09 Anthropic* Claude Sub | 567,64 |
| 04/09 Openai *Chatgpt Subscr | 546,54 |
| 04/09 IOF de compra internacional (Claude) | 19,86 |
| 04/09 IOF de compra internacional (ChatGPT) | 19,12 |
| 04/09 Casa do Acai Cafe | 37,00 |
| 06/09 Shopee *Shpstecnologia | 19,99 |
| 07/09 Auto Posto Costa Costa | 70,00 |
| 07/09 Auto Posto Costa Costa | 14,00 |

| corrigir | de | para |
|---|---|---|
| Globo Premiere | (2/10) 11/09 · 35,88 | **(3/10)** 03/09 |
| Playground Gato ML (2/2) 18/09 | — | **apagar**: 2/2 já foi cobrada em setembro |
| Carro Peças (1/3) 21/09 · 140,11 | — | **(2/3)** 03/09 · 140,10 |
| Acessorios Mac (2/2) | 03/10 · 134,16 | 03/09 · 134,15 |
| King Cell (10/10) | 03/10 | 03/09 |
| Mac (2/12) | 03/10 | 03/09 |
| Pneu (7/10) | 03/10 | 03/09 |
| Meli+ | 11/09 | 08/09 |

Vivo (08/09), Nubank Chroma (10/09) e Cabelo Marcelao (15/09) ainda **não postaram** — o OFX é de
hoje. Ficam como `pending`; não inventar.

---

## 5. Fatura BB de setembro: R$ 290,05 no app, R$ 1.432,51 real

| documento | valor | no app |
|---|---|---|
| 01/08 ANTHROPIC* CLAUDE SUB | 1.100,00 | ausente — está como recorrente na Conta corrente |
| 03/08 IOF - COMPRA NO EXTERIOR | 38,50 | ausente (junto com a de cima, 1.138,50) |
| 12/08 MP*ULTRAPASSEMENSAL | 3,99 | ausente |
| 04/12 EMPORIUM SPOR PARC 09/10 | 138,99 | ✓ |
| 15/06 DL *AliExpres PARC 03/04 | 60,08 | "Controle (mãe) 3/4" 60,11 — 3 centavos |
| 15/07 BICHO MOLHADO PARC 02/02 | 90,95 | ✓ |
| **total** | **1.432,51** | 290,05 |

⚠️ **A fatura está em débito automático e o dinheiro saiu.** O extrato de 04/09 mostra Pix de
**R$ 1.432,50** para a conta dele no BB (agência 872, conta 43143-5) — exatamente o valor da
fatura. Quitar "sem caixa" esconderia uma saída real de 1.432,50 em setembro.

A partir de outubro o Claude sai do BB: vira **Claude 567,64 + ChatGPT 546,54 no Nubank**, duas
assinaturas separadas (Claude é da ProOps, ChatGPT é pessoal).

---

## 6. Empréstimos e salários — os valores da planilha estão errados

Extratos de agosto **e** setembro, os dois no dia 04, os dois com o mesmo valor:

| dívida | app | real | dia no app | dia real |
|---|---|---|---|---|
| Empréstimo Nubank | 782,61 | **781,64** | 5 | **4** |
| Empréstimo Nubank 2 | 870,15 | **858,87** | 10 | **4** |
| Carro | 1.485,00 | sem evidência (sai do BB) | 23 | — |

| recorrente | app | real |
|---|---|---|
| Fundacred | 1.198,85, último dia do mês | 1.195,39 (04/08) e 1.198,85 (04/09) — **dia 4**, valor varia |
| Salário PJ | 4.000,00 dia 5 | 4.000,00 **dia 4** |
| Salário (CLT) | 2.632,00 dia 5 na Conta corrente | **não cai lá** — chega no BB; o que entra é transferência de 1.488,02 |
| Manutenção dentista 177,01 | Conta corrente, dia 10 | é Pix no crédito **no cartão Nubank** |
| DAS 88,85 | Conta corrente, dia 20 | é Pix no crédito **no cartão Nubank** |
| Pix pai carro | 340,00 | 350,00 (decidido: ajustar) |
| Pix Winicius | 303,00 | 420,00 (decidido: ajustar) |

Nenhum dos três financiamentos tem lançamento com `debt_id` para o pagamento de 04/09, exceto uma
linha solta no Empréstimo Nubank — o bloco "Já pagas" da tela de Dívidas depende disso.

---

## 7. O que ainda não dá para fechar sozinho

**A Conta corrente não bate porque falta a conta corrente do BB.** Hoje o app tem uma conta só
(a do Nubank). Isso produz dois furos ao mesmo tempo:

- o CLT de 2.632,00 nunca entra — o que se vê é uma transferência de 1.488,02 vinda do BB;
- a fatura do BB é paga com dinheiro que sai da conta do Nubank e passa pelo BB.

Criar **"Conta corrente BB"** resolve os dois de uma vez: o CLT cai lá, o cartão BB é pago de lá,
e o que sai do Nubank vira transferência entre contas próprias — que todo agregado do app já
exclui. Sem ela, qualquer escolha entre "quitar sem caixa" e "pagar de verdade" está errada de um
jeito ou de outro.

