# EV08 — Escopos de edição recorrente no iOS

**Resultado:** os três escopos iOS terminaram com UI e snapshots coerentes, preservando R$ 32,10 por ocorrência e a conta bancária.

| Escopo | Estado persistido | Soma das ocorrências |
|---|---|---:|
| Só esta ocorrência | 02/10 Debit; 02/11 Boleto; padrão da série Boleto | 6.420 centavos nas duas linhas consultadas |
| Esta e as próximas | 02/10 Debit; 02/11 Pix; 02/12 Pix; padrão Pix | 9.630 centavos |
| Todas, inclusive passadas | 02/10, 02/11 e 02/12 `bank_transfer`; padrão `bank_transfer` | 9.630 centavos |

- UI: `/private/tmp/proops-f01-ios-recurring-one-run.log`, `/private/tmp/proops-f01-ios-recurring-future-run.log` e `/private/tmp/proops-f01-ios-recurring-all-visible-config-run.log` terminaram com a seleção do escopo e saída do editor.
- SDK: `/private/tmp/proops-f01-native-post-one.json`, `/private/tmp/proops-f01-ios-future-proof.json` e `/private/tmp/proops-f01-ios-all-proof.json`, conferidos pelo agente principal; linhas reduzidas em `snapshot-portable.json`.
- Durante a preparação de “todas”, um roteiro intermediário encontrou valor RHF oculto zerado e a leitura de acessibilidade de `0,00` ficou momentaneamente em `0,`; esse roteiro falhou antes de gravar e não é contado como passe. No fluxo final, o valor visível foi R$ 32,10, método transferência, e todas as três ocorrências foram salvas por 3.210 centavos cada. A verificação de estabilidade SDK usada aqui é do snapshot final primário, não do roteiro interrompido.
- Android recorrência e escopos permanecem pendentes.
