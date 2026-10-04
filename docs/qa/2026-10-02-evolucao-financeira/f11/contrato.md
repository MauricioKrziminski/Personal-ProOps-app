# F11 — reservar x transferir de verdade

Estado: contrato do incremento, antes do código. Branch `gabriel/financas-22-melhorias`
(após F10 `8cdfc25b`), staging `utkqoiigimqzeenxkxdl`. Não declara implementação nem testes.

## Comportamento

"Guardar" numa meta pergunta **onde está o dinheiro**:

- **Já está na conta** (separar): escolhe a conta; nenhum dinheiro se move. O aporte entra no
  ledger da meta e a conta passa a ter esse valor separado para a meta.
- **Transferir**: escolhe origem e destino (contas próprias, diferentes); nasce UMA transferência
  real `kind='transfer'` origem → destino, e o dinheiro fica separado na conta de destino.
- **Vincular transferência existente** (dentro de Transferir): escolhe uma transferência já
  lançada ou importada; ela vira o aporte, sem criar outra. Uma transferência só pode ser
  vinculada a UMA movimentação de meta, para sempre.

"Retirar" espelha: **Liberar** (o valor deixa de estar separado, nada se move) ou **Transferir
de volta** (transferência real da conta onde está separado para outra conta).

A folha mostra o efeito antes de salvar: quanto fica separado/livre na conta escolhida e, na
transferência, o saldo das duas contas. Cada movimentação aparece no extrato da meta com a
natureza ("Separado em Nubank", "Transferido de Nubank para Caixinha", "Liberado de …") e se
**desfaz** numa transação só: some o aporte, some a separação e some a transferência que ELA
criou; uma transferência apenas vinculada volta a ser lançamento solto, intacta.

Nenhuma movimentação é consumo nem renda: a transferência já é neutra (`kind='transfer'`), e
separar não toca `transactions`.

## Regras

- Centavos inteiros 1..9007199254740991. Data civil explícita (`occurred_on`), dia local.
- **Separar** exige conta do workspace, não arquivada, não cartão. Soma das separações na conta
  (reserva F07 + todas as metas) depois da operação ≤ caixa realizado da conta hoje
  (`private.caixa_das_contas`). Senão `SALDO_INSUFICIENTE` com quanto há livre.
- **Transferir**: origem ≠ destino, ambas do workspace, não arquivadas; destino não cartão. Data
  futura cria a transferência `pending` (a regra atual de transferência decide o status, não
  esta função). Não confere saldo da origem: transferência que deixa a origem negativa é
  permitida como em qualquer transferência; a folha avisa.
- **Vincular**: transferência do workspace, `kind='transfer'`, ainda não vinculada (unique),
  destino não cartão. O valor e a data são os da transferência.
- **Liberar/transferir de volta**: no máximo o separado da meta naquela conta; e o ledger da meta
  não fica negativo (regra já existente de `goal_deposit`). Retirar dinheiro "sem origem"
  continua possível (Liberar sem conta = aporte negativo sem separação).
- Separações por (meta, conta) vivem em `financial_allocations` `purpose='goal'` (uma linha por
  meta+conta, já prevista no F07): a linha é a SOMA das movimentações; chega a zero → apagada.
- Contas e transferências apagadas: a movimentação perde o vínculo (FK `set null`), o aporte
  permanece; a separação que passar do caixa aparece como déficit nas leituras do F07, nunca
  vira saldo fabricado.
- `edit_goal_contribution` recusa aporte que pertence a uma movimentação ("edite pela
  movimentação") — senão aporte e separação divergem.

## Persistência

Migration nova `<ts>_goal_money_movements.sql`:

```sql
create table public.goal_money_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  goal_id uuid not null references public.goals(id) on delete cascade,
  kind text not null check (kind in ('allocate','transfer_in','link_in','release','transfer_out')),
  account_id uuid references public.accounts(id) on delete set null,      -- onde fica/estava separado
  from_account_id uuid references public.accounts(id) on delete set null, -- outra ponta da transferência
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  occurred_on date not null,
  contribution_id uuid unique references public.goal_contributions(id) on delete cascade,
  transfer_id uuid unique references public.transactions(id) on delete set null,
  created_transfer boolean not null default false, -- true = a movimentação criou a transferência
  edit_revision bigint not null default 1,
  created_at timestamptz not null default now()
);
-- RLS deny-by-default: select para authenticated por workspace; escrita só pelas funções.
```

Recibo selado `private.goal_money_write_receipts` (mesmo desenho de
`private.goal_plan_write_receipts`) + `private.reserve_payment_request` /
`finish_payment_request`.

## RPCs

Todas `security definer` em `private`, wrapper `public` invoker; revoke de public/anon;
`set search_path=''`; `set timezone='America/Sao_Paulo'` no cabeçalho.

```ts
// public.goal_money_command(p_input jsonb, p_request_id uuid) returns jsonb
type GoalMoneyInput =
  | { op: 'allocate'; goal_id: string; account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'transfer_in'; goal_id: string; from_account_id: string; account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'link_in'; goal_id: string; transfer_id: string }
  | { op: 'release'; goal_id: string; account_id: string | null; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'transfer_out'; goal_id: string; account_id: string; to_account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'undo'; movement_id: string; expected_revision: number };
// resultado: { movement_id: string | null, contribution_id: string | null,
//              transfer_id: string | null, saved_cents: string, revision: number }
```

Mesma chave + mesmo payload devolve o resultado anterior; payload diferente é erro. Ordem de
travas: advisory `financial-allocations:<ws>`, depois a meta `for update`, depois as linhas de
alocação. Undo com `expected_revision` diferente → `PT409`.

Leituras:

- `public.goal_money_state(p_goal_id uuid, p_limit int, p_before timestamptz)` → por conta:
  separado desta meta, caixa realizado, separado no total (reserva + metas), livre; e as
  movimentações da meta paginadas, do mais recente ao mais antigo, com natureza, contas e
  transferência.
- `public.goal_link_candidates(p_goal_id uuid, p_limit int)` → transferências do workspace sem
  vínculo, destino não cartão, mais recentes primeiro.

## Cliente

- `src/lib/goal-money.ts` (puro): `GoalMoneyInput`, validação (origem≠destino, valor, data),
  `efeitoDaMovimentacao(state, input)` → linhas de efeito por conta para a folha, e rótulo da
  natureza. Teste `src/lib/goal-money.test.ts`.
- `src/hooks/use-goal-money.ts`: `useGoalMoneyState`, `useGoalLinkCandidates`,
  `useGoalMoneyCommand` (chave estável por intenção, como `useSaveTransaction`), invalidação de
  metas, contribuições, saldos, reserva/planejamento e transações.
- `src/app/finance/goals.tsx`: a folha Guardar/Retirar ganha `Segmented` de 2 opções no topo
  (Guardar: **Já está na conta | Transferir**; Retirar: **Liberar | Transferir de volta**), os
  `AccountPicker` necessários (origem antes de destino), "Vincular uma transferência" dentro de
  Transferir (`SelectField` dos candidatos), linhas de efeito e o extrato com natureza e
  "Desfazer". Sem kit novo.

## Aceite (matriz)

Duas metas separando o mesmo saldo ao mesmo tempo (uma recusa); retirar mais que o separado;
mesmo request repetido (um movimento só); vincular transferência importada e tentar vincular de
novo; contas iguais; conta arquivada; cancelar e repetir; transferência com data futura;
desfazer separação, transferência criada e vínculo; receita/despesa consolidadas e caixa total
iguais antes/depois de separar (ao transferir, só muda a distribuição entre contas). Nativo:
iOS e Android, claro/escuro, fonte grande, ocultar valores, Reduzir movimento.
