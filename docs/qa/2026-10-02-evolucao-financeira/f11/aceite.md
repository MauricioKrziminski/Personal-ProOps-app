# F11 — aceite e limites

Estado: **aceito no staging** em 04/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. [Contrato](contrato.md).

"Guardar" numa meta pergunta onde está o dinheiro: **Já está na conta** (separa, nada se move)
ou **Transferir** (uma transferência real, ou uma já lançada/importada vinculada). "Retirar"
espelha: **Liberar** ou **Transferir de volta**. A folha mostra o efeito por conta antes de
salvar; o extrato da meta diz a natureza de cada movimentação e a desfaz numa transação só.

## Banco

Migration `20261004120000_goal_money_movements.sql`, **só no staging**. Revisada antes do push;
a revisão apontou três defeitos médios corrigidos antes da aplicação (vincular sem conferir o
caixa, desfazer liberação sem conferir o caixa, repetição do desfazer com a mesma chave
devolvendo erro) e endurecimentos (gatilho que impede editar/apagar por fora o aporte de uma
movimentação, retirada sem origem limitada ao dinheiro sem origem, transferir de volta sem data
futura, entradas inválidas → 22023, publicação realtime idempotente). Testes SQL depois do push:
`goal_money_movements.sql` e `anon_sem_execute.sql` passaram; antes do push, em rollback, também
`emergency_reserve`, `goal_withdraw`, `editar_aporte_da_meta`, `goal_contribution_plans` e
`goal_plans`. Tipos regenerados do staging (`--linked --schema public`).

## Código

`npx tsc --noEmit`, `npx expo lint` e `npm test` (2.214 testes) com exit 0; agente com `ruff` e
`pytest` (1.234) verdes — o agente recusa, antes do SIM, editar um aporte que veio de uma
movimentação. Paridade registrada em `docs/AGENTE-PARIDADE-COM-O-APP.md` (o agente guarda sem
origem).

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 10/10 casos — [resultado](evidence/ios/resultado.md) |
| Android 16 `emulator-5574` (s26) | 9/9 casos — [resultado](evidence/android/resultado.md) |

Separar, transferir, vincular (o candidato some da lista e volta ao desfazer), liberar,
transferir de volta, recusas (mesma conta, caixa insuficiente com o livre na frase, liberar
acima do separado, transferir de volta com data futura), duplo toque = uma movimentação,
extrato com natureza, desfazer de cada tipo (a transferência criada sai; a vinculada fica),
claro/escuro, fonte grande, ocultar valores e Reduzir movimento nos dois.

Oráculo do banco depois dos dois aparelhos: nenhuma movimentação restante, nenhuma transação
nova, caixa total idêntico ao de antes (R$ 39.249,15) e as separações de volta às duas da
reserva. A meta "Reserva de emergência" tinha `saved_cents = 0` com R$ 18.500,00 no ledger
(divergência anterior a esta sessão); a primeira operação recalculou a coluna pela soma do
ledger, que é a regra, e ela ficou em R$ 18.500,00.

## Limites

- Uma captura Android (tema escuro + fonte 1,3 + animações em 0) mostrou o cabeçalho do
  `SelectField` em branco. **Não reproduzido** pela primary com animações ligadas nem em 0
  ([capturas](evidence/android/picker-reproducao/)); o componente é anterior ao F11. Fica como
  observação, sem correção alegada.
- Um "não está respondendo" no Android durante a digitação de um valor alto, logo depois de
  religar as animações — o mesmo padrão do `QA-ANDROID-20261003-ANR` do F07, que permanece
  aberto. Nenhuma escrita ocorreu naquele trecho.
- Simulador/emulador não equivalem a aparelho físico. Sem produção, push, tag ou deploy do
  agente.
