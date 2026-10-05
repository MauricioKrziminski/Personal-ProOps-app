# F13 — principal, resultado e reavaliação

Estado: contrato do incremento, antes do código. Depende do F12 (a posição é a conta
`investment`, aporte/resgate são transferências ligadas a `investment_movements`). Staging
`utkqoiigimqzeenxkxdl`. Não declara implementação nem testes.

## O que cada operação é

| operação | o que é | caixa | renda | patrimônio |
|---|---|---|---|---|
| Aporte / resgate (F12) | dinheiro entra/sai da posição por transferência | move entre contas | não | não muda |
| **Atualizar valor** | quanto a posição vale numa data, informado pela pessoa | não | não | muda (resultado não realizado) |
| **Rendimento recebido** | dinheiro real que caiu (juros, dividendos), na posição ou noutra conta | sim | **sim** (é receita) | muda |
| **Informar aplicado** (correção de abertura) | quanto já estava aplicado numa data, antes do histórico no app | não | não | não |

## Números da posição (todos do servidor)

- **Saldo no app** (`ledger_cents`): saldo realizado da conta, como hoje (`caixa_das_contas`).
- **Valor atual** (`value_cents`): a última atualização de valor (`as_of` mais recente, nunca a
  mais recentemente digitada) **mais** o que entrou/saiu da conta depois daquela data. Sem
  nenhuma atualização, o valor atual é o saldo no app e a qualidade diz "sem atualização".
  O valor atual nunca fica abaixo de zero (resgatar tudo de uma posição desvalorizada zera).
- **Aplicado** (`principal_cents`): a abertura informada (se houver) + aportes − resgates depois
  dela. Sem abertura: `initial_balance_cents` + transferências líquidas da conta desde sempre.
- **Resultado** (`result_cents`) = valor atual − aplicado, com **qualidade explícita**:
  - `conhecido`: há abertura informada, ou a conta nasceu com saldo inicial 0;
  - `estimado`: saldo inicial > 0 sem abertura informada (o saldo inicial pode já conter ganho);
  - `indisponível`: sem nenhuma atualização de valor — a tela diz "Atualize o valor para ver o
    resultado" e **não** escreve R$ 0,00.
- Rendimento recebido creditado na posição NÃO entra no aplicado: é resultado realizado e
  aparece à parte (`received_cents`, soma das receitas de rendimento ligadas à posição).
- **Sem rentabilidade anualizada.** Percentual simples resultado ÷ aplicado só com `conhecido`
  e aplicado > 0.

## Patrimônio

`private.net_worth_now` passa a pôr as contas `investment` em **Investimentos** pelo **valor
atual**, e não mais em "Dinheiro em conta". `cash_total` e toda leitura de caixa/projeção/reserva
**não mudam** (ganho não realizado nunca entra no caixa). O líquido muda só pelo resultado não
realizado. Mesma assinatura e mesmas colunas, na mesma ordem; snapshots seguem iguais.

## Bens (`assets`): reavaliação retroativa não muda o valor atual

`update_asset_value` hoje sobrescreve `current_value_cents` mesmo com data antiga. Nova versão
(mesma assinatura e cabeçalho, mais `set timezone`): grava/atualiza a marcação e põe em
`current_value_cents` o valor da marcação de `as_of` **mais recente**. Nova
`public.delete_asset_valuation(p_valuation_id uuid)` apaga uma marcação e recalcula; recusa
apagar a única marcação de um bem ("informe outro valor antes").

## Persistência

Migration `<ts>_investment_valuations.sql`:

```sql
create table public.investment_valuations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  position_account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('valuation','opening')),
  value_cents bigint not null check (value_cents between 0 and 9007199254740991),
  as_of date not null,
  note text check (char_length(note) <= 280),
  edit_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  unique (position_account_id, kind, as_of)
);
```

Rendimento recebido é uma `transactions` `kind='income'`, `category='rendimentos'`, na conta
escolhida (a posição ou outra), criada pelo comando com o mesmo caminho de inserção do F12;
`investment_movements.kind` ganha `'income'` para ligar a linha à posição (mesmo desfazer).

## RPCs

Mesmo padrão F11/F12: definer + wrapper, recibo selado, revoke public/anon, `search_path=''`,
`set timezone` no cabeçalho.

```ts
// public.investment_value_command(p_input jsonb, p_request_id uuid) returns jsonb
type ValueInput =
  | { op: 'valuation'; position_account_id: string; value_cents: string; as_of: string; note?: string | null }
  | { op: 'opening'; position_account_id: string; value_cents: string; as_of: string }
  | { op: 'income'; position_account_id: string; to_account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'edit'; valuation_id: string; value_cents: string; as_of: string; expected_revision: number }
  | { op: 'delete'; valuation_id: string; expected_revision: number };
```

`as_of`/`occurred_on` não podem ser futuros. Mesma data e tipo já existente → recusa com o
caminho ("edite a de DD/MM"). Abertura única por posição (a nova substitui; a tela confirma).
`investment_positions()` (F12) ganha `value_cents`, `principal_cents`, `result_cents`,
`result_quality`, `received_cents`, `last_valuation_on`. O histórico paginado do F12 intercala
atualizações de valor e rendimentos com a natureza.

## Cliente

`src/lib/investment.ts` ganha rótulos/qualidade; a folha do F12 ganha os modos (sem segundo
formulário): no detalhe da posição, **Atualizar valor**, **Rendimento recebido** e **Informar
aplicado**; o bloco da posição mostra Valor atual, Aplicado, Resultado (qualidade em palavras,
sem número quando indisponível), Recebido e "atualizado em DD/MM". Em Patrimônio,
"Investimentos" soma o valor atual das posições + bens de investimento. A folha de bem ganha o
histórico de marcações com apagar.

## Aceite (matriz)

Posição antiga sem abertura (estimado); abertura informada (conhecido); resultado positivo e
negativo; resgate total do principal; dois aportes no mesmo dia; atualização retroativa que não
muda o valor atual; apagar uma atualização; rendimento recebido na posição e noutra conta (é
receita; caixa muda; valor atual muda uma vez só); mesma requisição repetida; revisão velha;
`cash_total` e reserva iguais depois de uma atualização de valor; patrimônio líquido muda só
pelo resultado. Bens: marcação retroativa não muda o valor atual; apagar recalcula. Nativo nos
dois sistemas, claro/escuro, fonte grande, ocultar valores, Reduzir movimento.
