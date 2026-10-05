# F12 Android (emulator-5574, s26) - resultado

Evidencia: `evidence/android/`. Conta usada: "QA F12 Android Corretora". Backend staging.

| # | Caso | Resultado | Screenshot |
|---|------|-----------|------------|
| 1 | Cadastrar conta Investimento (saldo 0) -> posicao aparece em Patrimonio | PASS (ver defeito runner R1: empty state nao foi visto, abri Contas direto) | 01-posicao-criada |
| 2 | Aplicar R$ 800 da Poupanca, efeito antes->depois (Poupanca 18.529,12->17.729,12; posicao 0->800) | PASS, saldo 800,00 | 02-aplicar-800-efeito, 03-saldo-800-aplicado |
| 3 | Aplicar R$ 200 em 07/10 (futuro) | PASS: historico "agendado"; saldo da posicao segue R$ 800 (realizado); Lancamentos mostra "previsto" | 04-historico-agendado |
| 4 | Vincular | NAO EXECUTADO (nao procurei candidatas) |  |
| 5 | Resgatar R$ 800 para Nubank | PASS: efeito 800->0 / Nubank +800; saldo R$ 0,00 | 05-resgatar-800-efeito, 06-saldo-zero-apos-resgate |
| 6 | Resgatar +R$ 10 com saldo 0 | PASS: "So ha R$ 0,00 disponiveis em ...", botao desabilitado | 07-resgate-excessivo-recusado |
| 7 | Duplo toque em Aplicar R$ 10 | PASS: um unico movimento (+R$10; lista com 4 itens) | 08-historico-4-movimentos-um-aplicar-10 |
| 8 | Apagar transferencia de aplicacao em Lancamentos | PASS: "Esta transferencia pertence a uma aplicacao ou resgate: edite ou desfaca pela posicao" | 09-apagar-transferencia-recusado |
| 9 | Visual: Escuro + font 1.3; animacoes 0; Aplicar/Resgatar | PASS (sem ANR). Privacidade: NAO EXECUTADO (nao achei o controle a tempo) | 10, 11, 12, 13 |
| 10 | Cleanup | PASS: desfeitos todos (aplicar 800 recusado com resgate existente = regra OK, 14-...; depois resgate primeiro); posicao sem movimentos | 14, 15 |

Extra: desfazer aplicacao consumida por resgate -> "Nao da para fazer isso: o resgate de 04/10 ficaria sem saldo. Desfaca o resgate de 04/10 antes." (14).

## Defeitos de produto
- P1: nenhum defeito confirmado com valor 0: o botao Aplicar fica desabilitado (evidence/android/xx-glitch-valor-0-botao-desabilitado.png; desvio previo meu retratado e descartado).
- P2 (baixo, a confirmar): saldo da posicao mostra so o realizado; aplicacao agendada fica fora do saldo (so no historico). Coerente com o contrato, mas nao ha indicador de "agendado" na linha da posicao.

## Problemas do runner
- R1: app Metro estava com bundle antigo (sem a secao Investimentos); precisei force-stop + am start para recarregar.
- R2: emulador muito lento (telas de 5-40s); troquei de app 2x sem querer (launcher/Lens) com BACK em excesso.
- R3: Salvar da conta pareceu inerte no 1o toque (teclado aberto); funcionou ao tocar de novo.

## Restauracao (originais: font_scale 1.0, animator/transition/window 1/1/1, tema Sistema, privacidade off)
Font 1.0, animacoes 1/1/1, tema Sistema. Privacidade nunca foi ligada.
