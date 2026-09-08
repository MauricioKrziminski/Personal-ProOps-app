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
