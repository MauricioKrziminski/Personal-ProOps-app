# EV05 — Transferência própria em iOS e Android

**Resultado:** os dois sistemas recusaram origem e destino iguais com “Origem e destino precisam ser diferentes”. Depois, salvaram a transferência para Poupança como `kind=transfer`, método `bank_transfer`, sem taxa. iOS persistiu R$ 34,56 no registro `5f94cee7-6a01-4197-a937-117b868b0ef7`; Android persistiu R$ 34,56 em `b27fd965-0430-43ee-94c5-ab0e751ce10f`. A conta de origem é bancária e a de destino é Poupança.

- iOS: `/private/tmp/proops-f01-ios-own-transfer-run.log` e `/private/tmp/proops-f01-native-latest-proof.json`.
- Android UI: `/private/tmp/proops-f01-android-own-destination-resume-run.log` passa pela recusa de mesma conta e seleção de Poupança.
- Android persistência: `/private/tmp/proops-f01-android-own-proof.json`, conferida pelo agente principal; a prova reduzida está em `snapshot-portable.json`.
