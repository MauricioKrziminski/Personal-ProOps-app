# F10 — evidência de código

Branch `gabriel/financas-22-melhorias`; verificação em 03/10/2026, após F09.
Este registro reúne resultados de código confirmados durante a implementação.
Não declara aceite funcional F10, conclusão da matriz nativa ou liberação de F11.

## Implementação observada

- `src/lib/goal-contribution.ts` concentra o cálculo puro e o calendário civil
  compartilhável. O resultado cobre `ready`, `reached`, `incomplete`,
  `unreachable` e `out_of_range`; centavos inteiros usam `BigInt`, datas são
  estritas e o clamp preserva o dia âncora em meses curtos. `goalMonthOn` e
  `goalContributionAt` expõem a mesma sequência usada para obter a data final.
- `src/lib/goal-horizon.ts` define o DTO v2 fechado, valida estado recebido e
  prepara leitura/preview/save sem aceitar campos ou metas fora do snapshot.
Os campos de origem inativa são limpos só no transporte; os drafts inativos
continuam na sessão.
- `src/lib/goal-horizon-save.ts` adapta o contrato v2 ao controlador selado
compartilhado. `src/hooks/use-goal-horizon.ts` usa as RPCs v2 e mantém a leitura
F08 existente disponível às outras telas.
- `src/components/finance/goal-contribution-fields.tsx` separa os campos, a
  dica da fonte ativa e o resultado pronto por meta. `goal-planning.tsx` mantém
  a sessão e snapshot acima do layout responsivo e usa o domínio F10 no editor.
- `src/app/finance/goals.tsx` lê pelo hook v2 e exibe `GoalContributionCaption`
  com a previsão derivada do plano. Aporte inicial isolado tem legenda própria;
  modo legado não promete conclusão sem respeitar o prazo. Com valores ocultos,
  o cartão exibe “Plano oculto” e omite a data.
- As migrations `20261003220000_goal_contribution_plans.sql` e
  `20261003220001_goal_contribution_projection.sql` foram aplicadas no staging;
  os tipos gerados incluem os campos v2 e as RPCs novas.

## Verificações de código

| Escopo | Resultado confirmado | Evidência |
| --- | --- | --- |
| Domínio puro | 60/60 passaram; uma falha RED específica para sinalizar aporte inicial passado foi corrigida antes do GREEN final | [RED inicial](evidence/codigo/proops-f10-domain-red.log), [RED da flag](evidence/codigo/proops-f10-domain-past-flag-red.log), [GREEN](evidence/codigo/proops-f10-domain-green.log) |
| DTO/horizonte | 20/20 passaram; cobertura inclui fontes mutuamente exclusivas, drafts preservados, meta atingida apenas com aporte inicial e deadline do plano separado do deadline real da meta | [RED](evidence/codigo/proops-f10-horizon-red.log), [GREEN](evidence/codigo/proops-f10-horizon-green.log) |
| Save selado | 36/36 passaram, incluindo 30 casos do protocolo legado e 6 casos F10; o adaptador reutiliza o controlador selado comum, sem uma implementação paralela | [GREEN](evidence/codigo/proops-f10-save-green.log) |
| Hook | 3/3 passaram; escopo, fonte, aporte inicial e datas participam da consulta v2, sem placeholder financeiro anterior | [GREEN](evidence/codigo/proops-f10-hooks-green.log) |
| UI real | 21/21 passaram depois dos ajustes nos cartões. Inclui dica real da fonte ativa, prazo do plano separado do prazo da meta, aporte inicial isolado, modo legado e ocultação de data; os dois REDs de cartão foram corrigidos. Essa rodada precede apenas a otimização Set do contrato fechado | [RED](evidence/codigo/proops-f10-card-red.log), [GREEN](evidence/codigo/proops-f10-ui-card-final.log) |
| Suite global | 2.195/2.195 passaram, exit 0, após a otimização Set do contrato fechado | [Log](evidence/codigo/proops-f10-global-set-final.log), [resultado](evidence/codigo/proops-f10-global-set-final-result.json) |
| TypeScript | `npx tsc --noEmit` terminou com exit 0 após a otimização Set; stdout vazio | [Log](evidence/codigo/proops-f10-types-set-final.log), [resultado](evidence/codigo/proops-f10-types-set-final-result.json) |
| Expo lint | `EXPO_NO_DOTENV=1 npx expo lint` terminou com exit 0 após a otimização Set; stdout vazio | [Log](evidence/codigo/proops-f10-lint-set-final.log), [resultado](evidence/codigo/proops-f10-lint-set-final-result.json) |
| React Doctor | 0 erros, 4 avisos no scan changed + include-untracked contra base HEAD, score 93 nesta rodada. Os quatro avisos de complexidade têm as mesmas funções e métricas do HEAD; não há avisos nos novos componentes/domínio F10 | [Scan final](evidence/codigo/proops-f10-doctor-set-final.json) |

Os avisos herdados são `GoalsScreen` (57/62/3), `useGoalPlanEditor`
(25/17/2), `PlanningResult` (13/16/2) e `GoalPlanSheet` (30/36/3), na ordem:
complexidade ciclomática/cognitiva/profundidade máxima. O diff por identidade AST
reporta quatro identidades novas e quatro corrigidas por mudança de hash; a
comparação das funções/métricas confirma que não são quatro regressões. A
triagem está registrada; o score do baseline é nulo e não é comparável ao 93.

Os REDs preservados são fronteiras semânticas durante o ciclo de
desenvolvimento. `proops-f10-card-red.log` registra duas falhas reais antes da
correção dos cartões. O arquivo `source-red.log` foi excluído porque aquele
teste passou e não demonstrava uma falha inicial.

## Limites

Suite global, typecheck, lint e React Doctor foram repetidos depois da
otimização Set. Os 21 testes focados passaram após os ajustes de cartão e
precedem apenas essa otimização fechada; a suite global posterior passou. A
verificação nativa F10 continua com os responsáveis de QA, sem declaração de
aceite. O incidente Android F07 continua aberto; nenhum resultado deste
documento declara sua cura.

Não confundir testes de domínio, DTO, protocolo ou JSX com gravação confirmada
em aparelhos, leitura cruzada iOS/Android ou aceite funcional.
