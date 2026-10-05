# F14 — planejamento percentual junto do orçamento

Estado: contrato do incremento, antes do código. Staging `utkqoiigimqzeenxkxdl`. Não declara
implementação nem testes. `/finance/plan` é a assinatura e não é tocada.

## Comportamento

Em Orçamentos (`src/app/finance/budgets.tsx`), a ação **Planejar por percentual** abre o editor
do plano:

1. **Renda-base**: valor digitado (`MoneyField`). Abaixo, uma sugestão em uma linha com o
   denominador dito: "Entrou R$ X em <mês> (lançado, inclui previsto)" — tocar usa o valor.
2. **Grupos** editáveis (nome livre; começa com Essenciais / Estilo de vida / Futuro, que a
   pessoa troca ou apaga). Cada grupo tem linhas: uma **categoria** com seu percentual, ou uma
   linha **sem categoria** (ex.: "Investir"), que aparece no plano mas não vira orçamento.
3. Para cada linha, o equivalente em reais, calculado no servidor e mostrado ao digitar.
   Barra de composição acessível (texto antes do gráfico); a soma aparece em % e em reais, e o
   que falta para 100% aparece como **Não distribuído**.
4. **Aplicar aos orçamentos**: escolhe as linhas (categoria) e o alcance (**Todo mês** = limite
   padrão, ou **Só <mês>** = limite do mês). A confirmação lista cada categoria afetada com
   "antes → depois" e marca conflito ("já tem limite de R$ X neste mês"); só as marcadas mudam.

Comparação no plano: **Planejado** (% da renda-base) ao lado de **Realizado** (% da renda que
entrou no período da régua da tela, mesma régua Mês/Ciclo), cada número com o denominador
escrito. Sem renda no período → "sem renda lançada" em vez de percentual.

## Regras

- Percentual em **pontos-base** inteiros (1% = 100 bp), 0..10000 por linha. Soma das linhas
  ≤ 10000 (100,01% recusado com a frase). Renda-base > 0 para salvar (zero/negativa recusada).
- Reais de cada linha: `floor(base × bp / 10000)`; os centavos que sobram do arredondamento vão,
  um por vez, às linhas de maior resto (empate: a que vem primeiro). Com soma = 100% a soma em
  reais fecha EXATAMENTE a renda-base; abaixo de 100%, Não distribuído = base − soma.
- Uma categoria aparece em no máximo uma linha do plano (recusa com a frase). Nome de grupo
  único no plano. Categoria comparada sem acento e sem caixa, gravada minúscula (régua de
  `categories.ts`).
- **Plano versionado**: salvar cria uma versão nova imutável; o editor mostra a atual; versões
  antigas ficam para o histórico das aplicações. Mudar a renda-base depois NÃO reescreve
  orçamento já aplicado: só uma nova aplicação muda limites.
- Aplicar usa a mesma regra de `save_budget`/`edit_budget` (limite padrão ou do mês,
  `lower(trim)`), **preserva `rollover`** do orçamento que já existia, e grava a aplicação
  (versão, linha, categoria, alcance, mês, valor antes, valor aplicado). Rollover e limite do
  mês continuam valendo como hoje (`budgets_status_for` não muda).
- Revisão por workspace (`edit_revision`) + chave de requisição, padrão F11.

## Persistência

Migration `<ts>_budget_plans.sql`: `public.budget_plans` (id, workspace_id, user_id, version
int, base_income_cents bigint > 0, created_at; unique (workspace_id, version)),
`public.budget_plan_lines` (plan_id, position, group_name, category text null, share_bp int
0..10000), `public.budget_plan_applications` (plan_id, category, scope 'default'|'month', month
date null, before_cents bigint null, applied_cents bigint, created_at). RLS por workspace,
leitura para authenticated, escrita só por função. Recibo selado.

## RPCs

- `public.budget_plan_preview(p_input jsonb)` → linhas com `amount_cents` (string), soma,
  não distribuído e erros; pura, sem escrita (o mesmo cálculo do salvar).
- `public.budget_plan_command(p_input jsonb, p_request_id uuid)`: ops `save` (cria versão, com
  `expected_revision`) e `apply` (`version`, `categories[]`, `scope`, `month`) → o que mudou.
- `public.budget_plan_state(p_month date, p_view text)` → plano atual, valores, aplicações
  recentes e a comparação planejado × realizado na régua pedida (renda do período por
  `month_summary`, gasto por categoria pela mesma régua do orçamento).

## Cliente

`src/lib/budget-plan.ts` (+ teste): bp↔texto pt-BR ("12,5%"), validação, o mesmo arredondamento
do servidor só para teste de equivalência (a tela mostra o do servidor).
`src/hooks/use-budget-plan.ts`. UI no `budgets.tsx`: entrada "Planejar por percentual", editor
com `Field`, `MoneyField`, campo de percentual com `formatNumberBR` (vírgula), `CategoryPicker`,
barra de composição, confirmação de aplicação. Sem kit novo.

## Aceite (matriz)

Renda zero e negativa; soma 99,99 / 100 / 100,01; centavos de resto fechando a renda; linha sem
categoria; categoria em dois grupos (recusa); aplicar com limite existente (antes → depois,
rollover preservado); aplicar só no mês; mudar a renda depois (limites aplicados não mudam);
comparação planejado × realizado com denominador; revisão velha; requisição repetida. Nativo
nos dois sistemas, claro/escuro, fonte grande, ocultar valores, Reduzir movimento.

- Decisão (revisão): `apply` recusa (P0001) categoria do plano que não existe mais no espaço (sem transação, orçamento nem linha em `public.categories` pelo `private.fold`); o mês novo herda o `rollover` do limite padrão.
