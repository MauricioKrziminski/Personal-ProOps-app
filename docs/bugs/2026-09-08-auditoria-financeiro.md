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
