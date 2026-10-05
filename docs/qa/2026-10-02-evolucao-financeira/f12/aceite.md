# F12 — aceite e limites

Estado: **aceito no staging** em 04/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. [Contrato](contrato.md).

A posição de investimento é a conta `investment`. Em Patrimônio, **Aplicar** e **Resgatar**
criam UMA transferência real (ou vinculam uma já lançada), com efeito antes → depois nas duas
contas; o histórico da posição vem pela data, do mais recente ao mais antigo, com Editar e
Desfazer. Resgate e desfazer nunca deixam a posição negativa em nenhuma data.

## Banco

- `20261004140000_investment_movements.sql` — revisada antes do push. A revisão **bloqueou** por
  um defeito alto (a transferência criada pelo movimento podia ser apagada/editada direto em
  Lançamentos, furando a regra do saldo) e apontou médios/baixos, todos corrigidos antes da
  aplicação: guarda em `transactions`, tipo/ponta conferidos depois da trava, `paid_at` no
  editar, `auto_confirm` na aplicação futura, status preservado, F11 sem oferecer transferência
  já ligada a investimento (e vice-versa), trava `for no key update`, migration idempotente,
  histórico por data com cursor composto e "Lançamento apagado" ainda desfazível.
- `20261004150000_investment_guard_p0001.sql` — a recusa da guarda sai como `P0001`, a régua de
  `financeErrorMessage`. Com `22023` o iOS mostrava "Tenta de novo" no lugar da frase.
- Testes SQL depois do push: `investment_movements`, `goal_money_movements`, `anon_sem_execute` e
  `emergency_reserve` passaram. Tipos regenerados do staging.

## Código

`npx tsc --noEmit`, `npx expo lint` e `npm test` com exit 0. Paridade registrada em
`docs/AGENTE-PARIDADE-COM-O-APP.md` (o agente ainda não aplica nem resgata).

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 11/11: estado vazio → criar conta, aplicar com efeito, retroativa no lugar certo do histórico, resgatar, resgate excessivo recusado com o disponível, desfazer permitido/recusado pela regra do saldo, só conta comum como ponta, editar valor, Lançamentos recusa editar/apagar a transferência, escuro + fonte grande + ocultar valores + Reduzir movimento. [Capturas](evidence/ios/) |
| Android 16 `emulator-5574` (s26) | 8/10: aplicar, agendada (futuro) no histórico, resgatar, resgate excessivo, duplo toque = um movimento, apagar a transferência recusado **com a frase** (já com a `P0001`), desfazer na ordem, escuro + fonte 1,3 + animações em 0. [Resultado](evidence/android/resultado.md) |

Oráculo do banco depois dos dois aparelhos: zero movimentos, nenhuma transação nova, Poupança e
Nubank com os saldos de antes e caixa total idêntico (R$ 39.249,15). As duas contas de QA
("QA F12 iOS Corretora", "QA F12 Android Corretora") foram apagadas por ID, sem transação ligada.

## Limites

- Android: "Transferência já lançada" (vincular) e ocultar valores não foram exercitados no
  aparelho; vincular está coberto no SQL e no iOS o ocultar passou.
- iOS: a frase da recusa em Lançamentos foi corrigida depois do teste do iOS e confirmada no
  Android; no iOS não houve nova rodada (a regra é a do `financeErrorMessage`, coberta por teste).
- Valor encolhido intermitente no iOS (linha "Investimentos" do resumo, que já existia antes do
  F12, e o valor da última linha do histórico): é o `Row` com coluna de valor fixa ligando o
  encolhimento do `Money` — no iPhone o texto encolhido numa medida estreita não volta a crescer.
  Primitivo compartilhado, anterior ao F12, não reproduzido de forma determinística; sem
  correção alegada.
- Caminhos de fora do comando (importação, F11 com conta de investimento como ponta) escrevem na
  posição sem a régua de saldo do F12. Resgate não olha o dinheiro separado para metas/reserva
  na posição (é o contrato: saldo realizado ≥ 0).
- A aplicação agendada aparece só no histórico, não na linha da posição (observação de UX).
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Simulador/emulador não são aparelho físico. Sem
  produção, push, tag ou deploy do agente.
