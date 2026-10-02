# EV02 — Dois Pix no crédito no mesmo dia, edição e zero explícito no iOS

**Resultado:** persistência e vínculo por FK confirmados. A compra A (`73e8fa84-bfa0-450d-9929-c1f5c21a8843`, 10.001 centavos) teve juros editados de 501 para 502 centavos e depois zerados explicitamente; o snapshot final não contém filha de juros para A. A compra B (`41c36f66-5daa-458c-81a1-e314869afc9b`, 20.002 centavos) conserva 700 centavos com FK para B e cartão de origem. Ambas ocorreram no mesmo dia; não há associação por título/data.

- UI: `/private/tmp/proops-f01-ios-fee-explicit-zero-run.log` registra guarda de incompatibilidade, edição para `0,00`, salvamento e reabertura sem campo de juros.
- Snapshot: `ios-fees-edited-proof.json` e `ios-fees-zero-proof.json`, reduzidos em `snapshot-portable.json`.
- Capturas existentes: `../screenshots/ios-pix-fee.png` e `../screenshots/ios-explicit-clear.png`.
