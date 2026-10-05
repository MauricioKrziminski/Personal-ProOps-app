# F13 Android (emulator-5574, staging, dev@proops.local)

Conta "QA F13 Android Corretora" (Investimento, saldo inicial R$ 500,00), Aplicar R$ 300,00 da Poupança.

| # | Caso | Resultado | Evidência |
|---|---|---|---|
| 1 | Sem avaliação: Resultado em palavras, sem R$ | PASS ("Atualize o valor para ver o resultado."; Valor atual R$ 800 = saldo, "Ainda sem atualização de valor") | 01 |
| 2 | Atualizar valor 850 -> estimado, sem % | PASS (+R$ 50,00, "Estimado: o saldo inicial pode já conter ganho. Informe o aplicado para confirmar."; sem %) | 02 |
| 3 | Informar aplicado 700 há 30 dias -> conhecido | PASS (Aplicado R$ 1.000, Resultado -R$ 150,00, "-15%", "Calculado com o aplicado informado") | 03 |
| 4 | Segundo Informar aplicado pede confirmação | PASS ("Substituir o aplicado informado? O valor informado em 04/09/2026 será trocado por este."), cancelado | 04 |
| 5 | Rendimento R$ 10 na posição | PASS (Recebido R$ 10,00; histórico "+R$ 10,00 Rendimento recebido na posição") | 05 |
| 6 | Resgatar 1.000 / 810 | PASS: 1.000 recusado ("Só há R$ 810,00 disponíveis em QA F13 Android Corretora."); 810 aceito (prévia 810 -> 0,00; Nubank 26.507,30 -> 27.317,30). Valor atual não ficou negativo | 06a, 06b, 06c |
| 7 | Privacidade, escuro, fonte 1.3, animações 0 | PASS: hero, lista de Patrimônio e detalhe da posição mostram só pontos; layout escuro com fonte 1.3 sem quebra | 07a, 07b, 07c |
| 8 | Limpeza | PASS: desfeitos resgate, rendimento, valor informado, aplicado informado e Aplicar; posição voltou a R$ 500,00 sem movimentos (conta mantida) | 08a, 08b |

## Observação de produto (a confirmar)
Após o resgate de R$ 810 no MESMO dia da avaliação (04/10), Valor atual continuou R$ 850,00 (Aplicado 190, Resultado +660, +347,37%): o resgate no mesmo dia da atualização não reduz o valor atual (regra "movimentos depois de as_of"). Decisão de produto se same-day conta; não é crash.
Detalhe: com resultado "indisponível" o Aplicado mostra R$ 1.000 (abertura) enquanto Valor atual R$ 800 (saldo) — coerente com o contrato, mas pode confundir (08a).

## Runner (não produto)
- Emulador muito lento: um ANR do Android durante "Informar aplicado" (anr-runner.png), recuperado com force-stop + am start; ação repetida com sucesso. Telas de 30-60 s.
- Toques do Aplicar 300 iniciais exigiram nova tentativa por lentidão.

## Restaurado
Tema do sistema: night no (original); font_scale 1.0 (original); animator/transition/window scale 1/1/1 (originais); privacidade desligada (botão volta a "Ocultar valor"); tema do app nunca alterado (Sistema). Conta QA F13 Android Corretora deixada para o primário apagar por id.
