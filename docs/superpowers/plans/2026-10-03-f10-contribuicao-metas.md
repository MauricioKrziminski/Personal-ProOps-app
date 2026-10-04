# F10 — Implementation Plan

> **For agentic workers:** executar por responsabilidades limitadas com
> `subagent-driven-development` ou `executing-plans`. Preservar mudanças
> concorrentes. A primary integra, revisa SQL e aceita os dois aparelhos.

**Goal:** planejar metas por prazo ou valor mensal, com aporte inicial e
calendário exato integrado à capacidade conjunta F08.

**Architecture:** domínio puro O(1), contratos versionados e controlador
selado no cliente; extensão de intenção no Postgres. Reutilizar a leitura
financeira F08 e os componentes de formulário existentes.

**Tech Stack:** TypeScript/React Native Expo57, TanStack Query, Postgres.

## Restrições globais

Fonte: [contrato F10](../../qa/2026-10-02-evolucao-financeira/f10/contrato.md)
e spec dos 22 pontos. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. Sem produção, push, release, nova biblioteca ou API
Expo. Não editar migrations aplicadas. Não começar F11 antes do aceite F10.

## 1. Cálculo puro (worker domínio)

Arquivos exclusivos: `src/lib/goal-contribution.ts`, teste homônimo.

```ts
const input = { target_cents: 10001, saved_cents: 0, as_of: '2027-01-01',
  mode: 'deadline' as const, monthly_cents: null, first_on: '2027-01-31',
  deadline_on: '2027-03-31', initial_cents: 0, initial_on: null };
assert.equal(calculateGoalContribution(input).monthly_cents, 3334);
assert.deepEqual(goalContributionAt(input, 1),
  { on: '2027-02-28', cents: 3334, kind: 'monthly' });
assert.deepEqual(goalContributionAt(input, 2),
  { on: '2027-03-31', cents: 3333, kind: 'monthly' });
```

- [ ] Observar RED semântico e implementar a assinatura do contrato.
- [ ] GREEN para centavos/resto/zero/concluída/31/bissexto/today/inicial/past/
  range seguro/calendário enorme/acesso aleatório; registrar logs.
- [ ] Primary conferir diff e executar suite focada.

## 2. Schema e protocolo (worker banco)

Arquivos exclusivos: novas migrations `*_goal_contribution_plans.sql` e
`*_goal_contribution_projection.sql`, novos testes
`supabase/tests/goal_contribution_plans.sql` e
`supabase/tests/goal_contribution_projection.sql`. Runner somente em tmp.
Sem aplicar migration até revisão da primary.

```sql
-- Um preview não pode alterar estado financeiro nem revisão do plano.
select public.goal_planning_state_v2(:ws,365,'civil','day',:preview);
-- Comparar soma planned_cents com remaining e datas TS↔SQL.
-- Mesmo request/payload retorna revisão original; payload alterado falha 22023.
-- resolver antes de save devolve cancelled e impede escrita atrasada.
```

- [ ] SQL puro equivalente ao cálculo TS, DTO fechado/string money.
- [ ] Extensão retrocompatível de items e helper compartilhado save/resolve.
- [ ] Projeção sobre caixa F08 sem intenções; v1 DTO preservado.
- [ ] RED contrato/centavos em transação rollback, revisão SQL da primary,
  aplicar staging confirmado, GREEN e regressões F08.
- [ ] Provar legacy/client antigo, membership/RLS, CAS, replay, mismatch,
  resolução terminal e duas conexões. Registrar migrations/advisors sem delta.

## 3. Cliente e componente (primary)

Novos `src/lib/goal-horizon.ts`, `goal-horizon-save.ts` + testes;
`src/components/finance/goal-contribution-fields.tsx`. Modificar
`src/hooks/use-goal-planning.ts`, `src/components/finance/goal-planning.tsx`,
`src/lib/simple-finance-ui.test.ts`, `src/lib/database.types.ts` gerado.

```ts
// Sessão conserva mensal enquanto prazo é fonte ativa; transporte limpa inativo.
assert.equal(goalHorizonInput(snapshot, drafts).items[0].monthly_cents, null);
// Voltar Por mês revela o mesmo draft sem reset de sessão/caret.
// Resposta anterior não autoriza save de cenário novo.
```

- [ ] Testar DTO fechado, fonte/draft, listagem exata e safe money; selamento
  de intenção completa e confirmação/membership/revisão inválidas.
- [ ] Integrar RPC v2 preservando assinaturas F08 utilizadas por outras telas.
- [ ] Extrair campos; modos Atual/Por prazo/Por mês conforme contrato;
  resultado e calendário limitado; inicial opcional com data explícita.
- [ ] JSX real: manter sessão responsiva, campo inativo, resultado/zero,
  conceal, freeze de tentativa, saída/cancelamento sem depósito.
- [ ] Rodar tests focados, types/lint e global; revisar diff/Doctor sem
  ampliar refatoração fora da feature.

## 4. Prova nativa e entrega (primary + QA por aparelho)

- [ ] Fotografar baseline de plano/financeiro e preferências; fixtures exatas.
- [ ] iOS: prazo→mensal, mensal→data, zero/resto, inicial, data 31; cancelar e
  reabrir, salvar e conferir banco/calendário.
- [ ] Android: ler save iOS, alterar modo/aporte, salvar; iOS ler save Android.
  Repetir entradas/bordas relevantes, privacidade e fechamento sem escrita.
- [ ] Inspecionar claro/escuro/fonte1,3/ReduceMotion; registrar falhas de
  produto/runner/limites separadamente. Sem disputas no mesmo aparelho.
- [ ] Confirmar dinheiro/ledgers iguais ao baseline, restaurar apenas dados
  QA identificados e preferências; atualizar aceite/README/masterplan.
- [ ] Commit local só dos arquivos F10 revistos. F11 liberado após evidências.
