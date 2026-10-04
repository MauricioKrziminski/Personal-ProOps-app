# F11 Android (emulator-5574, s26, Android 16) - 04/10/2026, staging, dev@

| Caso | Resultado | Evidencia |
|---|---|---|
| 1 Guardar > Ja esta na conta > Poupanca R$200 | PASS. Efeito: separado/livre antes->depois; saved R$200 | c1-efeito-antes, c1-extrato |
| 2 Vincular transferencia | PASS. 2 candidatos (R$34,56 Nubank->Poupanca 02/10); ao escolher um, Valor/Quando somem; depois so 1 candidato e oferecido | c2-candidatos-2, c2-candidato-1-apos-vinculo |
| 3 Retirar > Transferir de volta Poupanca->Nubank R$50 | PASS. Saldo -R$50 | c3-efeito-retirar |
| 4 Transferir de volta com data futura | PASS (recusado, nada gravado) | c4-recusa-data-futura |
| 5 Duplo toque Guardar R$10 | PASS. Um unico movimento/aporte | c5-duplo-toque-um-so |
| 6 Extrato com naturezas | PASS ("Separado em Poupanca", "Transferido de Poupanca para Nubank", "Transferencia vinculada de Nubank para Poupanca") | c6-extrato-naturezas |
| 7 Desfazer tudo | PASS. Confirmacao diz "Nenhum lancamento e apagado" (vinculada) / "transferencia criada por ela tambem e apagada". Meta voltou a so o aporte inicial de R$18.500 (dado pre-existente; "saved R$0" do enunciado ja nao era o estado). Transferencia vinculada voltou a ser candidata (2 candidatos de novo); lancamento segue existindo | c7-desfazer-vinculo, c7-extrato-zerado, c7-candidatos-de-volta |
| 8 Escuro + fonte 1.3 + privacidade + reduzir movimento | PASS com 2 achados abaixo. Privacidade oculta valores (inclusive "Retira ate ......") | c8-* |
| 9 Restore | OK | c9-restaurado |

## Defeitos de produto
1. Com reduzir movimento (3 escalas 0) o AccountPicker aberto, no Escuro/fonte 1.3, ficou com a linha selecionada/aberta SEM texto nem icone ate o toque seguinte (c8-reduzir-picker-linha-vazia). Repro: Escuro, font 1.3, animator/transition/window scale 0, Guardar > Transferir > abrir "Da conta" e escolher Nubank. Nao reproduzi com animacoes ligadas. Provavel conteudo animado que nao chega ao estado final com duracao 0 (gravidade baixa, nao testei isolado do fonte 1.3).
2. Dois candidatos identicos na lista de vinculo (R$34,56, mesma data, mesmo par): sao dois lancamentos distintos do dado de teste, nao necessariamente defeito; so confirmar que e dado, nao duplicacao.

## Runner
- ANR "ProOps isn't responding" ao digitar 1000 num campo com valor ja alto (100.010,00) logo apos religar as animacoes (c8 anr); recuperei com force-stop + relaunch (Metro intacto). Dock sumiu apos o restart ate novo force-stop. Nenhuma movimentacao criada nesse trecho (extrato conferido).
- Toque acidental numa divida (so abriu a tela, sem acao).
- Digitos da MoneyField: o Gboard abriu teclado numerico, sem overlay de handwriting.

## Estado final / originais
font_scale 1.0 (orig 1.0); animator/transition/window 1/1/1 (orig 1/1/1); show_ime_with_hard_keyboard 0 e stylus_handwriting 0 (nao alterados). Tema: original era "Sistema" (nao Claro); restaurado para Sistema (visual claro). Privacidade desligada. Meta Reserva: R$18.500 (aporte inicial) como no inicio; Troca do notebook intacta (R$2.400).
