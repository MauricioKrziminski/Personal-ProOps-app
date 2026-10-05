# F18 nativo Android (emulator-5574) - resultado

Bundle novo provado: menu da série com "Encerrar" e Tipo "Transferência" no Recorrente. Deep link `appproops:///finance/...`. Emulador lento: cada tela leva 10-40 s e o screenshot vem atrasado.

| Caso | Resultado | Screenshot |
|---|---|---|
| 1. Série "QA F18 Android assinatura" R$ 29,90 mensal, início 05/09/2026, conta QA F02 ANDROID Banco; passada materializada e paga; futura (05/11) materializada pendente | PASSA (com observação 1) | case1-form-assinatura, case1-ocorrencia-passada, case1-ocorrencia-futura-pendente |
| 2. Encerrar: prévia "Ficam 1 paga e 0 atrasadas. Saem 1 cobrança futura (R$ 29,90). A série vai para Encerradas."; confirmou; foi para Encerradas ("Encerrada em 05/09/2026"); paga de 05/09 ficou; 05/11 pendente sumiu; nada novo em out/nov | PASSA | case2-menu-encerrar, case2-preview, case2-encerradas, case2-lancamentos-sep |
| 3. Reabrir: ativa de novo ("próximo 05/10"); setembro continua com UMA linha paga; nov não foi recriada | PASSA com ressalva (observações 2 e 3) | case3-menu-encerrada, case3-reabrir-dialog, case3-reaberta |
| 4. Transferência recorrente "QA F18 Android transferencia" R$ 50,00 mensal, Nubank -> QA F02 ANDROID Banco: sem categoria nem estabelecimento; lista de destino NÃO oferece a conta de origem; aparece em Recorrentes (todo dia 5, próximo 05/10); Projeção "no fim de hoje" R$ 29.208,69 e "em 90 dias" R$ 15.931,78 idênticos antes e depois | PASSA (observação 4) | case4-form, case4-destino-sem-origem, case4-recorrentes, case4-projecao-antes, case4-projecao-depois |
| 5. Escuro + font_scale 1.3 + ocultar valores + animações 0: prévia do Encerrar e formulário de Transferência legíveis, sem corte | PASSA | case5-encerrar-dark, case5-transferencia-dark |

## Observações / defeitos

1. Criar a série com "Entra como pago na data" ligado e início 05/09 gravou DUAS linhas pagas no banco (05/09 e 05/10, ambas `cleared`), não só a passada. A 05/10 é hoje, então é coerente com a regra, mas o roteiro esperava uma passada paga.
2. Reabrir regravou a cobrança de 05/10 como `cleared` (a prévia do Encerrar depois diz "Ficam 2 pagas"; o saldo da conta QA caiu 29,90 de novo). Hoje = 05/10, então não é "passado", mas é uma cobrança paga criada sem ação da pessoa na reabertura. Revisar se é desejado (possível DEFEITO leve).
3. Nenhum "Editar" no menu de série encerrada: só "Ver ocorrências / Reabrir / Apagar". Reabrir foi feito por "Reabrir" (diálogo "O fim sai e as cobranças futuras voltam a ser geradas"), não editando "Termina em". Caminho de edição do fim em série encerrada não testado.
4. "entra/sai" do card da Projeção subiu (entra 300 -> 450, sai 23.517,67 -> 23.667,67): a transferência conta como movimento bruto em entra/sai (+150 = 3 ocorrências de R$ 50 na janela), saldo líquido inalterado. Conferir se é esperado.
5. "Mesma conta recusada" foi verificado por omissão: o seletor "Para a conta" não lista a conta escolhida em "Da conta". Não há mensagem de recusa.

## Runner

- Emulador muito lento; digitação por `input text` perde caracteres (usei um caractere por vez com pausa). `uiautomator dump` ficou desatualizado em vários momentos; usei screenshots com espera.
- Um toque errado abriu o menu da série "QA F18 iOS assinatura" (de outro agente); fechei com Cancelar, sem ação.
- O 1º toque no ícone "Ocultar valor" não surtiu efeito; o 2º sim. Restaurei: ocultar desligado.
- Configurações restauradas: night no, font_scale 1.0, animações 1, stayon false.
