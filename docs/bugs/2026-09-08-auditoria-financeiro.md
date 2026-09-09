# Auditoria do financeiro — 08/09/2026

Origem: *"o agente diz que criou mas não tem nada no app"*, *"em receita futura aparece
'Paguei' como se fosse dívida"*, *"tem muita coisa como essa, pequeno detalhe mas errado"*.

## 1. O financiamento existia — o app é que não falava dele

O agente disse a verdade. Verificado em produção: `debts` tem `carro`, `financing`,
`fixed_installments`, 48 parcelas de R$ 1.470, 8 pagas, saldo R$ 58.800, `archived=false`,
criado 08/09 23:16 UTC. A consulta do app **sob RLS, como o próprio usuário**, devolve a
linha; `debts` está na publicação `supabase_realtime` em produção. Nada quebrado no dado
nem no acesso.

A causa é a tela: os atalhos de **Gerenciar** eram quatro FIXOS — Lançamentos, Contas,
Cartões, Orçamentos. Dívidas só existia atrás de "Ver tudo". Um contrato de R$ 58.800 não
deixava rastro nenhum no Financeiro.

**Corrigido:** o atalho **Dívidas** aparece quando existe dívida, com o saldo devedor como
contagem — número que muda decisão, não enfeite. Validado no emulador: "Dívidas —
R$ 58.800,00".

## 2. "Paguei" em receita prevista

`tx.status === 'pending'` decidia o rótulo, **sem olhar `kind`**, em quatro telas. Receita
prevista ganhava "Paguei", "Vence em" e "Marque quando pagar" — vocabulário de dívida.

**Corrigido** em `src/lib/settle-labels.ts` (a decisão mora no primitivo, `frontend.md`):
`Recebi` / `Paguei` / `Concluí`, `Previsto para` / `Vence em`. `settle-labels.test.ts`
inclui uma varredura que quebra o build se uma tela voltar a cravar `label="Paguei"`.

`upcoming_bills` já filtrava `kind='expense'`, então Hoje e Projeção nunca mostraram receita
como conta a pagar — o defeito era só nas duas telas que exibem qualquer lançamento.

## 3. A prestação do financiamento não entrava na projeção

O maior erro numérico encontrado. A dívida entrava no **patrimônio** (a `0026` soma
`remaining_cents` no passivo) e não entrava em **nenhuma saída futura**: "vou ficar no
vermelho?" e "posso comprar isso em 10x?" respondiam ignorando R$ 1.470/mês por 40 meses.

**Corrigido** em duas migrations, consumindo `private.debt_schedule_for` (que já sabe o
calendário) em vez de recalcular amortização:

- `20260908234500_debts_in_forecast.sql` — `_cash_flow_forecast` / `cash_flow_forecast`
- `20260908235000_debts_in_upcoming_bills.sql` — `_upcoming_bills` / `upcoming_bills`,
  com `kind='debt'` novo no retorno

Medido no staging, fixture em transação com rollback: a projeção de 120 dias passou de
R$ 21.517,30 para R$ 25.927,30 de saídas — **exatamente 3 parcelas de R$ 1.470** —, e o saldo
final caiu o mesmo valor. `upcoming_bills` passou a devolver `Parcela carro` nos vencimentos.

`kind='debt'` tem `ref_id` de DÍVIDA, não de lançamento: Hoje e Projeção roteiam para a tela
de dívidas em vez de chamar baixa de lançamento. A união fechada em `use-finance.ts` fez o
TypeScript exigir isso das duas telas — foi ela que impediu o erro de passar.

## 4. Recorrentes: quantas para frente

`HORIZON_DAYS = 90` em `agent/app/jobs/scheduler.py`, materializadas como linhas `pending`
reais, idempotentes por `(recurring_id, occurred_at)`. Em produção, `materialized_until` de
uma regra mensal está em 04/12/2026 — 87 dias à frente, coerente.

Grandes apps do gênero não materializam longe: mostram a ocorrência futura por projeção e
criam a linha quando vence ou quando o usuário age. O risco do horizonte fixo é o **degrau
visível** — navegar para o mês N+4 e ver um mês vazio, enquanto N+1..N+3 têm linhas. Isso
NÃO foi observado nesta rodada (a tela de lançamentos é empurrada e não entra no
`design-preview`), e fica registrado como o próximo item a verificar no aparelho.

## Achados que NÃO foram corrigidos — decisão do dono do produto

- **Uma recorrente de salário está gravada como `kind='expense'`** em produção, R$ 4.000,
  com 4 ocorrências materializadas (uma `cleared`, três `pending`). A projeção **subtrai**
  esse valor todo mês em vez de somar. É dado errado, não código: o formulário tem seletor
  Despesa/Receita e nasce em Despesa. Não alterei dado de produção.
- **`reminders` e `alerts` estão PAUSADOS no Cloud Scheduler** ("até o corte", proposital no
  `setup-gcp.sh`) e **não têm equivalente no pg_cron** — que só cobre `finance-scheduler`,
  `process-jobs` e `purge-trashed-notes`. Enquanto isso valer, lembrete e alerta proativo
  não disparam por esse caminho.

## Validação

- App: 312 testes, TypeScript e lint limpos. 5 testes novos em `settle-labels.test.ts`.
- Migrations aplicadas **no staging**; tipos regenerados pelo CLI. Produção não recebeu nada.
- Emulador Android (s26, 1344×2992): Financeiro com o atalho Dívidas e o saldo correto.
- O rótulo `Recebi` está coberto por teste unitário e pela varredura anti-regressão, **não**
  por captura de tela — a tela de lançamentos é empurrada e o `design-preview` só monta as
  cinco raízes de aba.

## 5. O histórico das parcelas pagas — 09/09/2026

Origem: *"ao falar que estou na nona parcela ... ele tem que continuar aparecendo quando eu
abrir o lançamento e olhar para trás, quero ter o histórico completo, só não tendo aquele
aviso chato de que estou devendo tudo para trás"*, e *"parece que ele criou 40 parcelas ao
invés das 48"*.

Eram **dois** defeitos, não um.

**(i) A numeração era da lista, não do contrato.** `private.debt_schedule_for` devolve só o
que falta — 40 linhas — e as numerava de 1 em diante. Medido em produção:

```
select count(*), min(installment_no), max(installment_no)
from private.debt_schedule_for('c5d8ba6e-…')  → 40, 1, 40
```

A 9ª parcela aparecia como "parcela 1" e a tabela terminava em 40: daí a leitura de que o
financiamento nasceu com 40 parcelas. Corrigido em
`20260909010000_debt_schedule_contract_numbering.sql`, deslocando pelo `installments_paid`
**no SELECT final** (a recursão continua contando de 1, porque é ela que decide quando
parar). Medido no staging com fixture em transação e rollback: `carro` 48x/8 pagas passou a
devolver 40 linhas numeradas **9..48**, soma inalterada (R$ 58.800); um Price de 24x/4 pagas
devolve 20 linhas **5..24**.

Nenhum dos seis consumidores de `debt_schedule_for` lê `installment_no`
(`_cash_flow_forecast`, `_upcoming_bills`, `payoff_strategy_for` e os wrappers) — conferido
por `prosrc` em produção. Contagem de linhas e valores não mudaram, então projeção e contas
a pagar continuam idênticas.

**(ii) O passado não existia como linha.** Diferente da compra parcelada no cartão (onde
`create_installment_plan_with_history` materializa as N parcelas e marca as pagas como
`cleared`), um financiamento guarda o passado como **contagem**: `installments_paid = 8`.
Não há data, conta nem valor para as oito — quem disse "estou na nona" declarou, não lançou.

Por isso as linhas antigas são **apresentação derivada da contagem**, nunca lançamento:
`src/lib/debt-history.ts` monta `Parcela 1..8 de 48` com o valor da parcela e a data andando
para trás na cadência mensal a partir do primeiro vencimento em aberto. Onde existe pagamento
de verdade (`pay_debt_installment` grava um `transactions` com `debt_payment_no`), a data e o
valor vêm dele — `useDebtPayments`. Elas não entram na projeção, não viram `transactions` e
não mexem no saldo, e a tela diz isso em uma linha embaixo da lista.

O sheet do financiamento agora tem **Já pagas · 8 de 48** (check, sem cor de atraso) e
**A pagar** começando em 9 e terminando em 48.

Verificado no emulador (s26, 1344×2992, claro e escuro) pela faixa `Dívidas` nova do
`design-preview` — o sheet só abre no toque, então sem essa faixa a correção só poderia ser
conferida logando. De quebra, o cartão da lista escrevia "juros juros incluídos, sem
detalhamento": a palavra vinha do template e do rótulo ao mesmo tempo.

## 6. A data da parcela andava sozinha — e pulava um mês — 09/09/2026

O `carro` foi criado pelo agente **sem dia de vencimento**. Sem ele
`private.debt_schedule_for` tirava o dia de `current_date`: a próxima parcela vencia "dia 8"
ontem e "dia 9" hoje, e com ela andavam a projeção de caixa, as contas a pagar e as datas
estimadas do histórico da seção 5. Cronograma que muda de resposta porque o relógio virou
não é cronograma.

Olhando a mesma expressão, um segundo erro: a primeira parcela era **sempre** no mês
seguinte (`add_months(current_date, 1)`). Com vencimento no dia 15 e hoje dia 9, a parcela
que vence daqui a seis dias sumia da projeção e o app anunciava a de outubro.

`20260909020000_debt_schedule_stable_anchor.sql` corrige as duas: a âncora do dia passa a ser
`started_at` (`not null`, default `current_date`) e a primeira parcela é a **próxima
ocorrência do vencimento a partir de hoje, inclusive**. Medido no staging em transação com
rollback, hoje 09/09: `dia 15` → 15/09; `dia 5` → 05/10; `sem dia` com `started_at` em 31/01
→ 30/09, 31/10, 30/11 (o `day_in_month` prende o dia 31 no fim de cada mês). Nos três,
40 linhas numeradas 9..48 e soma R$ 58.800 — contagem e valores intactos.

### E o dado que faltava: quem pergunta o vencimento

O buraco não era do cronograma, era de quem cadastra. **Nem o agente nem o app pediam o dia.**

- **Agente** (`app/tools/resources.py`): contrato com `installments` agora exige `due_day`,
  na MESMA pergunta das parcelas já pagas — *"Me diz quantas parcelas você já pagou (zero se
  nenhuma) e que dia do mês vence a parcela"*. Faltando só uma, a frase encolhe sozinha.
  Dívida sem parcelas ("devo 500 pro João") não tem cadência e continua sem exigir nada.
- **App** (`finance/debts.tsx`): "Vence dia" saiu de *Adicionar detalhes (opcional)* e virou
  o terceiro campo do modo Simples, obrigatório sempre que houver parcelas.

Medido com o Gemini REAL (`scripts/evaluate_answer_forms.py`, seção nova
`cadastro/dia de vencimento`): **94/94**, incluindo "dia 10", "todo dia 5", "vence dia 15",
"no dia 20 de cada mês", "cinco", "sempre no primeiro dia do mes", "debita no dia 28". As 15
formas de responder "quantas já pagou" continuam passando.

Verificado no emulador: o formulário mostra os três campos e o **Salvar fica desabilitado**
enquanto o dia estiver vazio.

A dívida `carro` de produção foi **apagada a pedido do Gabriel** (zero pagamentos lançados
apontavam para ela) para ser recriada já com o vencimento.

## 6. Dois defeitos que a tela de Mês ia colocar na cara do usuário — 09/09/2026

Encontrados ao modelar a página de mês (`docs/design/mes.md`), e confirmados lendo as definições
vivas em produção. Nenhum dos dois fazia estrago naquele momento (produção estava com 0 dívidas e
0 planos parcelados), e os dois quebram exatamente os números daquela tela assim que houver dado.

### A parcela do financiamento contava duas vezes no mês em que foi paga

**Regressão da `20260909020000`, aplicada horas antes.** Até ela, a primeira parcela do cronograma
era sempre `add_months(current_date, 1)` — nunca o mês corrente. Ao corrigir o caso "vence dia 15 e
hoje é dia 9" (que escondia da projeção a parcela que vence em seis dias), o mês corrente passou a
ser possível, e o cálculo olha só para `current_date` e o dia do vencimento:

```sql
case when private.day_in_month(current_date, dia) >= current_date
     then private.day_in_month(current_date, dia)
     else private.day_in_month(private.add_months(current_date, 1), dia) end
```

Com vencimento no dia 20, hoje 09/09 e a parcela de setembro registrada em 05/09: o trigger já
incrementou `installments_paid`, então o cronograma começa na parcela SEGUINTE — e a data nela em
20/09. Setembro ficava com a parcela paga (`transactions`) mais uma do cronograma, nos três
consumidores: projeção de caixa, contas a pagar e a tela nova.

`20260909030000_debt_schedule_skip_paid_month.sql` — havendo pagamento registrado para o contrato
dentro do mês corrente, a próxima parcela é a do mês seguinte. Medido no staging, hoje 09/09, com
`due_day = 20`: **antes** do pagamento o cronograma devolve a 9ª em 20/09; **depois**, começa na
10ª em 20/10 e setembro fica com **zero** linhas do cronograma.

### Parcela de cartão em fatura paga ficava `pending` para sempre

`pay_invoice` (`0013:292`) cria a transferência e marca a fatura como paga, mas **nunca tocava em
`transactions.status`**. Era inofensivo enquanto `_promote_due_transactions` promovia por data
qualquer linha com `installment_plan_id not null` — cláusula que a `20260908153143` removeu de
propósito, quando o histórico de parcelas virou explícito.

Consequência já visível fora da tela nova: `nextPendingInstallment`
(`src/lib/installment-progress.ts:6`) tira a próxima parcela do `min(installment_no) where
status='pending'`, então quem paga a fatura pela RPC lê **"parcela 1 de 10" pelo resto do plano**.
Os totais não mudavam (nenhum agregado filtra `status`), mas a coluna ✔ e qualquer "falta pagar"
ficavam errados.

`20260909031000_pay_invoice_clears_rows.sql` — a baixa que `settle_invoice` já fazia (`0046:110`).
Medido no staging: fatura com 4 linhas `pending` → todas `cleared` com `paid_at`, fatura `paid`,
transferência criada, e a próxima parcela do plano anda.

### Um terceiro caso, NÃO corrigido, registrado de propósito

`debt_schedule_for` ancora na *próxima ocorrência do dia de vencimento a partir de hoje,
inclusive*. Com hoje 25/09, vencimento no dia 23 e a parcela **não paga**, ele devolve 23/10: a
parcela vencida e não paga de setembro **não aparece em lugar nenhum** — nem como atrasada. Não é
regressão (o comportamento anterior tinha a mesma propriedade por outro caminho) e o conserto pede
uma decisão que não cabia nesta rodada: um financiamento cujo `installments_paid` foi DECLARADO no
cadastro, sem pagamento nenhum registrado, ficaria com uma parcela "atrasada" em todo mês, para
sempre. Fica anotado aqui para não ser redescoberto como mistério.
