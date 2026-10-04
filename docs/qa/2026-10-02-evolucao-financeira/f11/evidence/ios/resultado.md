# F11 iOS (iPhone 17 Pro, iOS 26.5, staging, dev@)

| Caso | Resultado | Evidência |
|---|---|---|
| 1 Guardar, já está na conta, Nubank, R$100 (efeito visível; saved 2.500) | PASS | 01, 02 |
| 2 Transferir Nubank->Poupança R$50 (saved 2.550) | PASS | 04 |
| 3 Origem = destino: motivo inline "Origem e destino precisam ser contas diferentes", botão desabilitado | PASS | 03 |
| 4 Poupança R$20.000: "Só há R$ 15.329,12 livres em Poupança.", botão desabilitado, nada salvo | PASS | 05 |
| 5 Liberar Nubank R$30 (saved 2.520) | PASS | 06 |
| 6 Liberar R$500 (> R$70): "Só há R$ 70,00 separados nesta conta.", desabilitado | PASS | 07 |
| 7 Extrato com natureza: "Separado em Nubank", "Transferido de Nubank para Poupança", "Liberado de Nubank" | PASS | 08 |
| 8 Desfazer (swipe + confirmação com texto explicando que a transferência criada também é apagada) | PASS | 09, 10, 11 |
| 9 Escuro + fonte grande + privacidade (valores das linhas de efeito viram bolinhas) + Reduzir Movimento (troca de modos ok) | PASS | 12, 13, 14, 15 |
| 10 Restauração | PASS | 16 |

Desfazeres feitos, nesta ordem: transferência R$50 (caso 2), liberação R$30 (caso 5), separação R$100 (caso 1). Extrato final só com "aporte inicial" 2.400,00; card da meta R$ 2.400,00.

## Defeitos de produto
Nenhum confirmado.
Observações (não confirmadas como defeito):
- Ao trocar Guardar para Transferir (ou o inverso) origem/destino são zerados; o valor digitado é mantido. Provável desenho.
- Antes do teste de privacidade o efeito mostrou Nubank 26.557,30 / Poupança 18.479,12 (inverso de +-50 do estado inicial 26.507,30 / 18.529,12), e "livres em Poupança" 15.329,12 no caso 4 (esperado 15.529,12 menos reserva). O Android usava o mesmo workspace ao mesmo tempo (reserva de emergência mudou 18.700 -> 18.500), então muito provavelmente é atividade concorrente dele; vale conferir no banco que a transferência desfeita no iOS removeu a transação.

## Problemas do runner (não do produto)
Maestro não aceita % decimal; tapOn por texto em linhas de conta falha (rótulo agrupado), usei pontos; o ProOps voltou à tela inicial do simulador uma vez no começo (relançado com simctl launch); toquei por engano "Bold Text" em Ajustes e desfiz (chave nunca existiu).

## Estado final
Reduce Motion 0; content_size large; appearance light; tema do app Claro; privacidade desligada (valores visíveis); folhas fechadas sem salvar.
