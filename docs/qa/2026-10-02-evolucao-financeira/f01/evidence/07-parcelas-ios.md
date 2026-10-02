# EV07 — Parcelas com resto e entrada independente no iOS

**Resultado:** o plano `6403ef11-dd52-4d69-8dd5-6209957df681` registra R$ 80,02 em três parcelas Boleto na conta bancária, iniciadas em 01/10/2026. O resto de centavo ficou em 2.667, 2.667 e 2.668 centavos nas datas 01/10, 01/11 e 01/12; os estados são cleared, pending e pending. A entrada `62f44878-97bc-47bf-98e1-c499a6d8a3f3` é independente: 2.000 centavos, Debit, conta Poupança, cleared em 01/10, com `down_payment_plan_id` apontando para o plano e `installment_plan_id=null`. O total econômico combinado é 10.002 centavos.

- Plano, parcelas e entrada: `/private/tmp/proops-f01-ios-parcel-proof.json`, conferido pelo agente principal e reduzido em `snapshot-portable.json`.
- UI: `/private/tmp/proops-f01-ios-parcel-save-run.log` conclui a revisão e gravação; `/private/tmp/proops-f01-ios-parcel-open-run.log` e `/private/tmp/proops-f01-ios-parcel-entry-dedup-run.log` são trilhas de preparação/deduplicação. Somente o fluxo final e o snapshot primário são considerados prova do estado gravado.
- Android parcelamento/entrada e fluxo de financiamento continuam sem validação.
