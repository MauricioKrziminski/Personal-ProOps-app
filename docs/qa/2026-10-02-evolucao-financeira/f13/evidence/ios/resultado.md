# F13 iOS nativo (iPhone 17 Pro, iOS 26.5, staging, dev@)

Posição criada: "QA F13 iOS Corretora" (Investimento, saldo 0); Aplicar R$ 1.000 do Nubank em 01/10.

| # | Caso | Resultado | Print |
|---|---|---|---|
| 1 | Sem avaliação: valor = saldo 1.000, Aplicado 1.000, Resultado em palavras sem R$ | PASSA | k02_case1 |
| 2 | Atualizar 1.100 em 03/10: +R$ 100, +10%, "atualizado em 03/10" | PASSA | k04_case2 |
| 3 | Retroativa 24/09 R$ 900: valor atual segue 1.100 | PASSA | k05_case3 |
| 4 | Rendimento 20 na posição: Recebido 20, valor 1.120 (uma vez) | PASSA | k06_case4 |
| 5 | Rendimento 15 no Nubank: Recebido 35, valor 1.120 inalterado | PASSA | k07_case5 |
| 6 | Data futura bloqueada: dias futuros desabilitados, mês seguinte desabilitado, toque em 05/10 ignorado | PASSA | k03_case6_futuro_bloqueado |
| 7 | Apagar a de 03/10: valor atual 1.920 = 900 (24/09) + 1.000 (aporte) + 20 (rendimento), "atualizado em 24/09", resultado +920 (+92%) | PASSA (conta confere) | k08_case7 |
| 8 | Patrimônio: Investimentos 29.270 = 26.500 + 850 (Android, outro runner) + 1.920; Dinheiro em conta caiu | PASSA (Dinheiro não reconciliado ao centavo por atividade do runner Android) | k09_case8_patrimonio |
| 9 | Tesouro Selic 27.000 hoje: 2 marcações; apagar a nova volta a 26.500; a única restante não oferece Apagar | PASSA (a recusa do banco não é exercida pela UI: a linha nem oferece) | k11, k12 |
| 10 | Escuro + accessibility-large; privacidade; Reduce Motion (key=1) | PASSA com ressalvas abaixo | k13, k16 |
| 11 | Limpeza e restauração | PASSA | k19, k20 |

## Defeitos de produto / observações
1. Patrimônio, linha "Investimentos": o valor aparece em fonte minúscula (~R$29.270,00 microscópico), em claro e escuro, antes e depois da F13 (já era assim com 26.500). Com privacidade ligada os pontos têm tamanho normal. (k18)
2. Sinal vaza com privacidade: Android "Resultado –●●●●●●" mostra o menos; "+92%" também continua visível no detalhe (k15 não copiado; k16 mostra o resto oculto).
3. Texto de qualidade diz "Calculado com o aplicado informado" numa posição que nasceu com saldo 0 sem abertura informada (qualidade "conhecido" por saldo inicial 0): rótulo impreciso.
4. Resultado +920 (+92%) após apagar a avaliação mais recente: avaliação de 900 em 24/09 antecede o primeiro aporte (01/10), e o resultado conta o aporte como ganho. Consequência da regra do contrato (valor = última avaliação + fluxos depois), mas enganosa.
5. Abas Valor/Rendimento/Aplicado da folha não crescem com a fonte grande.
6. Após apagar a última avaliação o app volta ao estado "sem atualização" corretamente (1.020, resultado em palavras).

## Runner (não produto)
Maestro não acha linhas agrupadas por texto (usei pontos); deep link appproops:// derrubou o app; swipes na lista mudam de tela; uma toque duplicado reabriu a folha de rendimento sem duplicar registro (conferido no histórico: um lançamento de 15).

## Restauração
Reduce Motion 0 (defaults = 0), content_size large, appearance light, tema do app Claro, privacidade desligada. Posição iOS mantida com saldo 0 (primário apaga por id). Tesouro Selic 26.500,00 com só a marcação de 03/09/2026.
