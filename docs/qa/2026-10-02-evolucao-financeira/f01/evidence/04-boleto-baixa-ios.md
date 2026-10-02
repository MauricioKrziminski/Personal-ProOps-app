# EV04 — Boleto pendente e baixa em iOS e Android

**Resultado:** em ambos os sistemas, o mesmo lançamento de R$ 56,78 mudou de `pending` para `cleared`, mantendo método `boleto`, conta bancária e vencimento 13/10/2026. O registro iOS é `6f350ba2-7dcb-4518-aacf-1a8f100e5ae8`; o Android é `f7957528-ca98-4913-b3ce-6052e97f9c70`. Os snapshots antes/depois do Android foram conferidos pelo agente principal.

- iOS: `/private/tmp/proops-f01-boleto-ios-before.json` e `/private/tmp/proops-f01-boleto-ios-after.json`; UI `/private/tmp/proops-f01-ios-boleto-clear-scrolled-run.log`.
- Android antes: `/private/tmp/proops-f01-native-post-one.json`, status pendente; depois: `/private/tmp/proops-f01-post-boleto-dec.json`, status quitado.
- UI Android: `/private/tmp/proops-f01-android-boleto-resume-run.log` cria com vencimento 13/10; `/private/tmp/proops-f01-android-boleto-clear-run.log` marca “Já saiu do caixa” e conclui salvamento.
- Casos Android antes/depois estão em `snapshot-portable.json`.
