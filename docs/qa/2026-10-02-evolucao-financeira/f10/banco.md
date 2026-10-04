# F10 — evidência de banco

Target conferido antes das operações: staging `utkqoiigimqzeenxkxdl`, branch
`gabriel/financas-22-melhorias`. Produção (`kwriuifcwyvdrxtspjiz`) não participou.
Este registro prova operações de schema e contratos SQL; não é aceite funcional
F10 nem autorização para iniciar F11.

## Schema e projeção

Em 03/10/2026, o dry-run listou e o `db push` aplicou somente:
`20261003220000_goal_contribution_plans.sql` e
`20261003220001_goal_contribution_projection.sql`. A aplicação adiciona o modo
e os dados de horizonte/inicial às intenções de `goal_plan_items`, sem tocar o
ledger de aportes realizados.

`goal_planning_state_v2`, `save_goal_plan_v2` e
`resolve_goal_plan_attempt_v2` foram geradas no schema usado para atualizar os
tipos TypeScript. A projeção usa `private.cash_total` e
`private.eventos_de_caixa` F08 sem suas intenções; em seguida aplica os eventos
calculados do horizonte. Helpers de mês e cálculo SQL seguem o contrato puro
TypeScript. As respostas monetárias do contrato v2 são texto decimal.

O contrato de escrita conserva as RPCs v1. O caminho v2 mantém validação de
membership/lista de metas, fingerprint e revisão CAS, identidade/replay selado
e cancelamento terminal; os comandos ainda não criam contribuição, transação,
reserva ou outro registro financeiro.

## Testes SQL e aplicação

- A prova RED inicial recusou um plano por prazo antes de o contrato SQL aceitar
  esse modo. Depois da implementação, o runner isolado aprovou as duas fixtures
  novas F10 e as regressões SQL F08: quatro arquivos, todos com rollback.
- Após o `db push`, os mesmos quatro contratos passaram no schema aplicado; os
  resultados registram `committed:false`.
- Dry-run e aplicação registram exatamente as duas migrations listadas acima.
  Não houve migration fora do escopo nem escrita em produção.
- Advisers antes/depois: 23 issues antes, 23 depois, conjunto idêntico, zero
  adicionados ou removidos. Os arquivos originais do resultado foram mantidos
  fora desta pasta; a comparação exata está em
  [advisors-delta.json](evidence/sql/advisors-delta.json).

| Evidência | O que confirma |
| --- | --- |
| [RED](evidence/sql/red.log) | Modo por prazo ainda não coberto no contrato SQL inicial; rollback |
| [Candidate isolado](evidence/sql/candidate-isolated.log) | 4/4 fixtures F10 e regressões F08 passaram com rollback |
| [Schema aplicado](evidence/sql/applied-green.log) | As mesmas 4/4 fixtures passaram após aplicação, sem commit de dados de teste |
| [Dry-run](evidence/sql/push-dry-run.log) e [aplicação](evidence/sql/push.log) | Duas migrations F10 no staging |
| [Paridade](evidence/sql/parity-proof.json) | 320 vetores únicos sintéticos; resultado completo TS/SQL igual em transação somente leitura, sem escrita financeira; quatro estados cobertos |
| [Concorrência](evidence/sql/races-results.jsonl) | Três cenários concorrentes reais em conexões distintas, bloqueio advisory observado, 34 tabelas financeiras sem alteração, caixa igual e limpeza sem resíduos em 86 fronteiras |

Os três casos concorrentes foram: mesmo UUID/payload com um recibo; cancelamento
selado vencendo save atrasado; e v1/v2 concorrendo pela mesma revisão. Todos
passaram, inclusive o teste com bloqueio observado. As fixtures sintéticas não
tinham senha, identidade de login ou sessão. O log preservado contém resultados
e contagens, não os payloads das fixtures.

## Limites

Essas provas cobrem migrations/SQL staging, isolamento, recibos, calendário e
paridade determinística. Não provam o fluxo de UI nativo, leitura cruzada entre
aparelhos, preferências de acessibilidade nem aceite funcional. Nenhuma
conclusão sobre produção ou estabilidade Android decorre destes resultados.
