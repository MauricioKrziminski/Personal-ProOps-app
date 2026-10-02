# EV03 — Dois Pix no crédito no mesmo dia e zero explícito no Android

**Resultado:** o registro A (`92ec2942-fb37-4370-af0d-2ed7d19a8263`, 10.001 centavos) teve a taxa de 501 centavos zerada explicitamente. O snapshot atual mantém método Pix, conta bancária e revisão 5, sem linha filha de taxa para A. B (`0ba20983-ef98-417e-bd5b-94dae86f6af0`, 20.002 centavos) mantém taxa de 700 centavos vinculada por FK e conta-cartão. São duas compras do mesmo dia com associação distinta.

- UI A: `/private/tmp/proops-f01-android-fee-zero-run.log` passou pela guarda de incompatibilidade, edição para `0,00`, salvamento e reabertura sem campo de juros.
- UI das compras: `/private/tmp/proops-f01-android-fee-A-single-dismiss-run.log` e `/private/tmp/proops-f01-android-fee-B-single-dismiss-run.log`. A loga duplo toque; a não duplicação e o vínculo são comprovados pelo snapshot, não por esse log isolado.
- Persistência final: `/private/tmp/proops-f01-android-fees-zero-proof.json`, reduzido em `snapshot-portable.json`. A B permanece com a mesma FK/taxa de 700.
