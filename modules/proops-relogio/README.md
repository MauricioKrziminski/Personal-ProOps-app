# proops-relogio (só iOS)

Rede de segurança dos timers do JS: `ios/ProOpsRedeDosTimers.m` (o porquê está no topo dele).

**Ao subir o React Native**, confira que a rede continua instalada: ela depende de
`RCTTiming` ter `createTimerForNextFrame:duration:jsSchedulingTime:repeats:`, `startTimers`,
`didUpdateFrame:` e os ivars `_timers`, `_paused` e `_inBackground`. Faltando algum, o app segue
normal e o log do Xcode mostra `[ProOpsRelogio] RCTTiming mudou: a rede dos timers NÃO foi
instalada.` — aí é revisar o `RCTTiming.mm` novo (`node_modules/react-native/React/CoreModules/`).

Como provar que ela funciona (feito em 08/10/2026 no simulador): pausar o display link do JS com
`_paused` = NO na thread do JS (o estado do iPhone) — sem a rede nenhum `setTimeout` volta; com
ela o primeiro volta em ~0,3 s e o resto segue no ritmo normal, sem disparo em dobro.
