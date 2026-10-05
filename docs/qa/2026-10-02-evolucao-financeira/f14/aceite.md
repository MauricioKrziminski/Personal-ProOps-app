# F14 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. [Contrato](contrato.md).

Em Orçamentos, o menu "…" tem **Planejar por percentual**: renda-base primeiro (com a sugestão do
que entrou no período, quando houve renda), grupos e categorias em %, os reais calculados no
servidor, o "Não distribuído", planejado × realizado com o denominador escrito, e **Aplicar** aos
limites padrão ou só ao mês, com antes → depois por categoria. Mudar a renda depois não mexe nos
limites já aplicados.

## Banco

- `20261004170000_budget_plans.sql` — `budget_plans`, `budget_plan_lines`,
  `budget_plan_applications`, comando `budget_plan_command` (save/apply com recibo selado e
  revisão). Revisada antes do push: mensagens sem aspas, o mês novo herda o `rollover` do padrão,
  `private.fold` na categoria, `apply` recusa categoria que sumiu do espaço, cascata, renda com o
  previsto, teto de 60 linhas.
- `budget_plans` e `anon_sem_execute` passaram depois do push; tipos regenerados do staging.
- A suíte SQL inteira rodou depois (108 arquivos). Ela achou uma regressão de antes do F14 — o
  `set_invoice` tinha perdido duas guardas na `20261003002625` (F04) — corrigida à parte em
  `20261005110000_set_invoice_guardas_de_volta.sql`; e dois testes velhos (data do mês, frase da
  recusa compartilhada) foram ajustados. Ficam de fora só os que dependem de banco vazio ou data
  fixa (`expected_recurring_occurrences`, `agent_migrations`, `income_pending`).

## Código

Correção do QA iOS: em **Só o mês**, sem limite do mês, a prévia dizia "sem limite → R$ 2.400"
com um padrão de R$ 3.000 valendo. Agora o "antes" é o padrão, e a linha diz "Vale o limite
padrão de R$ 3.000,00; só em outubro passa a R$ 2.400,00" (`applyRows`, `src/lib/budget-plan.ts`,
com teste). Conferido no Android. `npx tsc --noEmit`, `npx expo lint` e `npm test` com exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 9/9: vazio e sugestão de renda, montar o plano (99,99/100/100,01% e 520% recusados), mesma categoria em dois grupos, salvar e reabrir com a comparação, aplicar ao padrão, só o mês, mudar a renda depois, toque duplo, escuro + fonte grande + ocultar valores + Reduzir movimento. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 8/8, incluindo a correção do "Só o mês". [Resultado e capturas](evidence/android/) |

Oráculo depois dos dois aparelhos: o toque duplo gravou UMA aplicação por categoria. Limites
restaurados por ID aos valores e `rollover` de antes, os overrides de outubro criados pelo QA e
os cinco planos apagados por ID; caixa e lançamentos iguais à linha de base.

## Limites

- Com valores ocultos, o campo Renda-base do editor mostra o número (é entrada da pessoa, como os
  outros campos de dinheiro do app); prévia, distribuição e comparação ficam mascaradas.
- A barra de composição não mostra o estouro acima de 100%; só o texto em vermelho avisa.
- No escuro, o trilho dos interruptores da folha "Aplicar aos orçamentos" quase não aparece
  (primitivo `SwitchRow`, anterior ao F14).
- No Android, "= R$ x por mês" mostrou por um instante o valor da prévia anterior antes de
  assentar no novo.
- A sugestão de renda não foi vista no Android (o período não tinha renda lançada); no iOS sim.
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Simulador/emulador não são aparelho físico. Sem
  produção, push, tag ou deploy do agente.
