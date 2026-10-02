# EV01 — Round trip dos métodos e limpeza explícita nas duas plataformas

**Resultado:** UI e persistência confirmam a limpeza do Pix bancário em iOS e Android. O registro iOS `96fd835e-ef27-47ea-9ff1-cf51eb9dc206` e o Android `50d6be18-a8b0-408e-b4d4-abd21d912b76` ficaram `payment_method=null`, revisão 3, valor 12.345 centavos, `status=cleared` e conta bancária preservada. No Android, a tentativa de mudar Pix para Crédito sem cartão mostrou a guarda, preservou conta/título/valor, e a limpeza final reabriu como “Não informar” com R$ 123,45.

- iOS: fluxo `/private/tmp/proops-f01-ios-edit-clear-scrolled-run.log` passou em incompatibilidade, salvamento, round trip de `Não informar`, conta e valor. Roteiro: `ios-edit-clear.yaml`.
- Android: `/private/tmp/proops-f01-android-edit-clear-final-run.log` passou em guarda, preservação, salvamento e round trip de `Não informar`/conta.
- Persistência: `/private/tmp/proops-f01-android-clear-proof.json` contém o par de registros pós-limpeza; as linhas relevantes foram reduzidas em `snapshot-portable.json`. Um snapshot Android anterior preserva o estado original Pix para comparação.
- Capturas existentes: `../screenshots/ios-explicit-clear.png`; o fluxo Android registra `f01-android-incompativel-sem-perda` e `f01-android-metodo-limpo-roundtrip`.
