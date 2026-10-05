# F18 iOS (iPhone 17 Pro, simulador) — 05/10/2026

Bundle provado: menu da série em Recorrentes tem "Encerrar" (07) e o Tipo do formulário Recorrente oferece "Transferência" (19).

| Caso | Resultado | Evidência |
|---|---|---|
| 1. Série "QA F18 iOS assinatura" gasto R$ 39,90 mensal, início 05/09/2026, Nubank (corrente). Ocorrência de setembro e novembro | PASSA (com desvio de roteiro, ver nota 1) | 02, 05, 06 |
| 2. Encerrar: prévia diz o que fica e o que sai; vai para Encerradas; paga fica; futura pendente some; nada novo | PASSA com defeito de cache (D1) | 08, 09, 10, 11, 12 |
| 3. Reabrir: série volta a Ativas (próximo 05/10), nenhuma cobrança passada vira paga | PASSA | 13, 14, 15 |
| 4. "Termina em": piso = início original (dias antes de 05/09 e mês anterior desabilitados); 20/09 (antes do próximo vencimento) aceito com aviso "encerra a série e tira as cobranças futuras" | PASSA | 16, 17, 18 |
| 5. Transferência recorrente: Da conta, depois Para a conta, sem categoria/estabelecimento; mesma conta recusada com frase; "QA F18 iOS transferencia" R$ 100,00 mensal Nubank -> QA F02 IOS Banco criada e listada em Recorrentes | PASSA (criação/UI) | 19, 20, 21 |
| 5b. Projeção: transferência nas duas contas, receita/despesa totais inalteradas | NÃO CONFIRMADO, suspeita de FALHA (D2); detalhe por conta não exercitado | 21 |
| 6. Escuro + accessibility-large + ocultar valores + Reduzir Movimento: prévia do Encerrar e formulário de Transferência | PASSA (layout legível, sem corte) | 22, 23 |

## Notas
1. A série com início passado nasce com "Entra como pago na data" LIGADO e o toggle não desliga (toque sem efeito) — a ocorrência de 05/09 já foi criada paga, então não foi preciso "Paguei". A de 05/11 (futura) foi materializada ao tocar na prevista: nasceu pendente, com botão "Paguei" (06). A de 05/10 (hoje) ficou só prevista (não materializada).
2. Encerrar: padrão "última cobrança" = 05/09, não 05/10 (a regra usa só datas gravadas; sem cron no staging a de hoje não existe como linha). Prévia: "Ficam 1 paga e 0 atrasadas. Saem 1 cobrança futura (R$ 39,90). A série vai para Encerradas." Confirmado: Encerradas mostra "encerrada em 05/09/2026"; Setembro mantém a paga; Novembro perdeu a materializada e não tem prevista.
3. Reabrir foi pelo item "Reabrir" do menu da série encerrada (confirmação "O fim sai e as cobranças futuras voltam a ser geradas"), não por edição do "Termina em".
4. Saldo Nubank caiu R$ 39,90 só pela paga de 05/09 (26.507,30 -> 26.467,40).

## Defeitos
- D1 (cache): depois de encerrar, o Lançamentos de Outubro continuou mostrando a prevista de 05/10 "recorrente" da série encerrada até relançar o app; após reabrir o app sumiu. Falta invalidar `ledger-expected` no `onSuccess` de `useEndRecurringSeries` (hoje só realtime em `recurring_transactions`, que não chegou). Também: o sheet Encerrar demora ~15 s para fechar (botão fica "busy").
- D2 (provável): na Projeção, depois de criar a transferência, o resumo mostra "entra R$ 300,00 · sai R$ 23.817,57" em 90 dias e "entra R$ 100,00" em Outubro, Novembro e Dezembro, exatamente a transferência, enquanto Recorrentes mostra entra R$ 0,00. Contrato pede consolidado inalterado. Em Lançamentos (ciclo de outubro) "entrou" ficou R$ 0,00, mas "saiu" subiu 129,90 (29,90 da série Android + 100,00?), enquanto o total do dia 05/10 (-69,80) exclui a transferência. Sem linha de base não consegui provar; conferir por SQL (entra/sai globais da `cash_flow_forecast` vs. `eventos_de_caixa` por conta).

## Problemas do runner
- idb `ui text` cai se o teclado cobre o campo; `swipe` precisa de `--duration`; toque em `Switch` ("Entra como pago") não surte efeito; deep link não troca de aba; a dock não aparece na árvore (toques por coordenada); o toque na pilha do deep link demora a atualizar.
- Compartilha o staging com o agente Android (série "QA F18 Android assinatura" apareceu na lista).

## Criados (para o primário apagar por id)
- Série recorrente "QA F18 iOS assinatura" (R$ 39,90, mensal dia 5, Nubank). Transação paga de 05/09/2026 gerada por ela. A de 05/11 foi apagada pelo encerramento e a reabertura não a recriou.
- Série recorrente "QA F18 iOS transferencia" (R$ 100,00, mensal dia 5, Nubank -> QA F02 IOS Banco 20261002), ainda ativa; sem transação gravada (prevista).
- Ajustes de exibição restaurados: aparência light, content_size large, Reduzir Movimento 0, tema do app Claro, valores visíveis.
