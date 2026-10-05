# QA-ANDROID-20261003-ANR — investigação de causa

Registro de 05/10/2026, branch `gabriel/financas-22-melhorias`, somente staging
`utkqoiigimqzeenxkxdl`. Build debug `com.proops.personal.dev` em `emulator-5574`
(API 36, 4 GB), logado como dev@. Nenhum código do app foi alterado.

## Hipótese e veredito

Hipótese: ao alternar "ocultar valores", uma avalanche de timers JS (`setTimeout`,
`setInterval`, `requestAnimationFrame`) enche o `PriorityQueue` do `JavaTimerManager` e
trava a thread principal.

**Refutada.** Em cerca de 800 alternâncias em Hoje, Finanças e Patrimônio, a contagem de
timers ativos ficou estável e nenhum `am_anr` foi registrado.

O mecanismo que a medição encontrou é outro: **cada alternância é um commit React grande**
(0,7–2,6 s no debug, no emulador sob carga do host). Isso pode explicar um app lento sob
toques repetidos, mas **não prova** a ANR original. A causa raiz do incidente continua não
comprovada; o que se sustenta está na seção "O que está e o que não está provado".

## Método

1. Leitura estática: `conceal.tsx`, `Money`, `CountUpMoney`, `useAgora`, `Entrada`,
   `Skeleton`, `com-teto` e todo `setTimeout/setInterval/requestAnimationFrame/withRepeat`
   de `src/`. Nenhum timer é criado por render ou por valor monetário; os poucos existentes
   têm limpeza (`useAgora` reagenda um só, `Entrada` limpa no cleanup, `comTeto` limpa no
   `finally`). `ConcealProvider` só guarda um booleano e grava no AsyncStorage.
2. Instrumentação temporária, **já removida**: um módulo que embrulhava
   `setTimeout/clearTimeout/setInterval/clearInterval/requestAnimationFrame`, mantendo o
   conjunto de IDs vivos e logando a cada 1 s (`ativos`, `criados`, `delta`); um gancho que
   expunha o `toggle` do `ConcealProvider`; e um laço que dispara N alternâncias a cada 60 ms
   por um sinal externo (servidor HTTP local), para repetir sem depender de toque na tela.
   Depois, um `<Profiler>` ao redor do conteúdo do provider e um micro-benchmark JS fixo
   (laço de 3e5 somas) a cada segundo.
3. Coletas em paralelo: `adb logcat -b events | grep am_anr`, `dumpsys meminfo` (Native
   Heap), `top -H`, `uptime` e `ps -r` do host.

## Medições

### Timers (série limpa, processo único)

| Tela | Alternâncias | Ativos antes → depois | Timers criados no total |
| --- | --- | --- | --- |
| Hoje | 2 × 100 | 22 → 22 | +5 |
| Finanças | 50 + 3 × 100 | 32 → 15 (volta ao repouso) | alguns por rodada, sem acúmulo |
| Patrimônio (Bens carregados) | 100 | 38 → 45 (retries das consultas que falhavam) | sem relação com o toggle |
| Patrimônio completo | 40 | 63 → 63 | 0 |

`requestAnimationFrame` ativos: 0 em repouso. `setInterval`: 1–3 (cooldowns e o próprio
log). Não há crescimento com o número de alternâncias. Para a fila segurar a thread por
segundos seriam necessárias centenas de milhares de entradas; a medição mostra dezenas.

Ressalva: parte das rodadas intermediárias rodou com o instrumento carregado duas vezes
por fast refresh (duas séries de log intercaladas). As conclusões acima usam só séries de
um processo único; após o ajuste do instrumento o app foi encerrado e relançado.

### Memória

Native Heap após rodadas sucessivas: 587 → 607 → 624 → 647 → 634 → 649 → 626 → 689 MB.
Oscila ±20 MB sem tendência por alternância; o patamar alto (~600 MB, RSS do app ~1 GB)
existe desde a abertura em Hoje. Não há vazamento por toggle.

### Custo de cada alternância (o achado real)

Com `<Profiler>` ao redor dos filhos de `ConcealProvider`, Patrimônio carregado, valores
trocando entre `R$` e a máscara:

- commit de `update`: `actual` 0,7–2,6 s (típico ~0,9 s); `base` ~5,3 s (custo da árvore
  inteira montada);
- cada passo do laço (60 ms de espera + commit) levou 0,9–2,5 s; em Hoje, ~0,3 s;
- o micro-benchmark JS ficou em 9–20 ms com o host calmo e 30–75 ms com o host carregado
  (até 8x mais lento pela carga).

O contexto troca `concealed` e re-renderiza todo consumidor montado (`Money`,
`CountUpMoney`, `useBRL`, linhas das telas). As abas e as pilhas ficam montadas, então o
trabalho cresce com o que já foi aberto na sessão. Em build debug, sem otimização do
Hermes, e num emulador disputando CPU com outros processos, o commit leva segundos.
Toques repetidos enfileiram commits sequenciais e a thread JS fica saturada. A thread
principal participa do mount de cada lote.

### Ambiente do host durante a sessão

- `uptime`: carga 12–33 em 10 núcleos; `qemu-system-aarch64` do emulador entre 120 % e 300 %
  de CPU, um simulador iOS em ~90 %, o Metro em ~140 %.
- O emulador estava com ~3,1 GB de 4 GB usados e ~560 MB de swap; `Long monitor contention`
  em `system_server` às 09:25.
- A rede do app ao staging parou várias vezes: `fetch` do OkHttp sem resposta (o `comTeto`
  rejeita com "Sem resposta do servidor"), enquanto `ping`/`nc` do emulador e `curl` do host
  ao mesmo endpoint respondiam em 0,7 s. Cold start nessa condição devolveu
  `AuthRetryableFetchError` e a tela de login (sessão perdida); `svc data disable/enable` e
  novo login pelo botão de teste restauraram o estado.

Uma máquina assim explica, sozinha, diálogo de ANR em ProOps e SystemUI ao mesmo tempo
(o incidente original teve dumps tardios dos dois, 19,5 s de atraso na coleta).

## O que está e o que não está provado

- **Provado:** não há avalanche nem crescimento de timers; não há vazamento de memória por
  alternância; 800+ alternâncias, algumas a 60 ms, não geraram `am_anr`; o app recupera a
  responsividade depois das rajadas.
- **Provado:** a alternância custa segundos de JS no debug sob carga (medido pelo Profiler).
- **Não provado:** que esse custo, ou a carga do host, tenha causado a ANR de 03/10. O frame
  em `JavaTimerManager` no dump é onde a thread principal estava sendo amostrada
  (Choreographer), não prova de quem a prendeu. A ANR não foi reproduzida nesta sessão.
- **Não coberto:** a fixture exata da Reserva (retirar vínculo e editor aberto) com
  alternância; build release (a execução com APK embutido de 03/10 já passou e não foi
  repetida); aparelho físico.

## Disposição proposta

A causa **não é** o mecanismo suspeito. O incidente fica **sem causa de código comprovada**,
com duas contribuições mensuráveis: carga do host/emulador e custo do re-render em cascata
no debug. Nenhuma correção de timer se justifica e nenhum teste novo foi criado (o repo não
tem defeito de timer a prender).

Decisões que cabem à sessão principal (não aplicadas aqui):

1. Medir o mesmo `Profiler` no APK release; se o commit cair para dezenas de ms, o custo é
   do debug e o incidente fica atribuído ao ambiente.
2. Se quiser reduzir o custo mesmo em debug: ignorar toques enquanto o commit anterior não
   assentou, ou diminuir quem re-renderiza (a máscara só precisa mudar o texto). Cuidado:
   atrasar o ocultar (`startTransition`/`useDeferredValue`) deixa o valor visível por mais
   tempo, o que contraria o propósito do recurso.
3. Cold start com timeout de rede levou à tela de login (`AuthRetryableFetchError`, sessão
   perdida). Está fora do escopo deste incidente e merece análise própria.

## Como reproduzir / verificar

1. Embrulhar os cinco timers globais com um contador de IDs vivos e logar a cada segundo.
2. Abrir Patrimônio (`appproops:///finance/net-worth`) com a rede do app respondendo e
   esperar "Bens" e o patrimônio carregarem (com o host carregado pode levar mais de 1 min).
3. Disparar 40–100 alternâncias seguidas e observar: ativos estáveis, `am_anr` vazio,
   `dumpsys meminfo` sem tendência, `<Profiler>` mostrando commits de centenas de ms a
   segundos.
4. Para confirmar a hipótese do host, repetir com `uptime` abaixo de 4 e comparar o `actual`.

## Estado final

Instrumentação, servidor local e arquivos temporários removidos; `git status` sem arquivos
meus além deste documento. App relançado como dev@ com valores visíveis (chave
`proops.conceal` = `0`, verificada na tela de Patrimônio).

## Medição no release (05/10/2026)

Mesmo aparelho (`emulator-5574`, AVD s26, 4 vCPU, 4 GB), mesma conta (dev@, staging), mesmo dia. Nenhum
código versionado ficou alterado; ver "Instrumentação e estado final" no fim da seção.

### Resultado em uma linha

**O release não derruba o custo para dezenas de ms.** Cada alternância de "ocultar valores" custa
**0,4 a 0,9 s de CPU da thread JS** no release (debug, mesmo dia e mesma carga: 0,9 a 1,3 s), e a tela
leva **0,6 a 1,3 s** para assentar. O release corta o custo para cerca da metade e **elimina a fila**
que o debug acumula, mas o commit continua na casa das centenas de ms. Nenhum `am_anr` em nenhuma rodada.

### Build

- `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` em `android/` (13 min), Hermes
  com bytecode embutido, assinado com a chave de debug do template. `applicationId` trocado para
  `com.proops.personal.anr` **no `android/app/build.gradle` (gitignorado), restaurado e conferido com
  `diff`**, para não substituir o dev client (`.dev`).
- Staging confirmado dentro do APK: `assets/app.config` traz `extra.proops.supabaseUrl` do projeto
  `utkq…`, e o bundle contém a URL `https://utkq….supabase.co`. O ref de produção aparece no bundle só como
  string solta da tabela de strings do Hermes (nenhuma URL `https://kwri….supabase.co`), e o app logou como
  dev@, que só existe no staging.
- O build leva a versão 1.6.3 do JS no HEAD **mais um botão temporário** (ver instrumentação). O dev
  client instalado é um binário nativo de 28/09 (1.3.52) rodando o JS atual pelo Metro: a comparação
  debug × release inclui essa diferença de nativo.
- Login no release por e-mail e senha (no release o botão "Entrar como teste" não existe).

### Método

Sem Profiler (não existe no release) e sem tocar no código do app além do botão abaixo. Quatro leituras,
todas sem sincronizar relógios do host com o aparelho:

1. **CPU por thread**: `/proc/<pid>/task/*/stat` (utime+stime, tique de 10 ms) antes/depois, mais um
   amostrador no aparelho a cada ~95 ms lendo a thread JS (`mqt_v_js`), a principal e a `RenderThread`,
   alinhado aos toques (`date +%s%N` antes/depois de cada `input tap`). "ms/toggle" = CPU da janela do
   primeiro ao último toque ÷ nº de toques. É o análogo sem instrumento do `actual` do Profiler.
2. **JS ocupado após o toque**: tempo do toque até a thread JS ficar ociosa (≤ 20 ms de CPU em ~300 ms).
3. **Tempo até a tela assentar**: `dumpsys gfxinfo framestats` (a janela de 120 quadros comporta 20
   alternâncias); para cada toque, o `FrameCompleted` do último quadro antes do toque seguinte, com o
   relógio mapeado por `/proc/uptime` × `date`. Cada alternância gera 2 a 3 quadros.
4. `logcat -b events | grep am_anr`, `dumpsys meminfo`, `uptime` do host antes de cada rodada e uma
   calibração de CPU do guest (`dd | md5sum` de 300 MB: 1,84 a 2,52 s em todas as rodadas).

Toque: `adb shell input tap` num laço dentro do aparelho (`/dev/input` e `sendevent` negam acesso ao
shell). Cada `input tap` leva ~0,13 s, então a "rajada de 60 ms" não é alcançável: o mais rápido foi um
toque a cada ~110 ms. Dois laços paralelos defasados perdem toques (36 ms de JS por toque) e foram
descartados.

Condição de "árvore cheia": as cinco abas visitadas antes (ficam montadas), depois Patrimônio por deep
link (`appproops:///finance/net-worth`, com `-p` do pacote). "Frio" = app recém-aberto direto em Patrimônio.

Tentativas descartadas: gravação de tela + `show_touches` (o emulador usa SwiftShader, quadros a 1-3 fps,
marcadores de sincronismo não confiáveis); `simpleperf` (o emulador não tem `cpu-cycles` nem `cpu-clock`);
perfil Hermes por CDP pelo Metro (a conexão fecha com 1006).

### Números

Toques espaçados; `Δtoque` é o intervalo real. Host: `uptime` de 1 min entre 6,0 e 11,0 em todas as rodadas
(nunca abaixo de 4). Patrimônio não tem olho, então ali o toque é no botão temporário; em Finanças é o olho
real do painel (mesma ação, mesmo provider).

| Build | Tela | Árvore | Δtoque | JS ms/toggle | Principal ms/toggle | JS ocupado após o toque (mediana / p90) | Tela assentou (mediana / p90 / máx) | Host |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| release | Patrimônio | 5 abas | 3,15 s (N=20) | **828** | 256 | 0,97 / 1,82 s | **1,30 / 1,92 / 2,23 s** | 11,0 |
| release | Patrimônio | 5 abas | ~1,2 s (N=30) | 726 | 243 | 0,93 / 3,49 s (13 de 30 passaram do toque seguinte) | n/d | 7,8 |
| release | Patrimônio | 5 abas | ~1,2 s (N=40, 1ª rodada) | 757 | 227 | n/d | n/d | 7,8 |
| release | Patrimônio | **só a tela (frio)** | 1,0 s (N=30) | **405** | 171 | 0,60 / 0,80 s | 0,64 / 0,91 / 1,13 s (rodada à parte, 2 s, N=20) | 8,2 |
| release | Finanças | 5 abas | 3,2 s (N=20) | **624** | 234 | 0,81 / 1,15 s | **1,26 / 1,75 / 3,87 s** | 7,9 |
| release | Finanças | 5 abas | ~1,5 s (N=30) | 620 | 236 | 0,79 / 2,32 s (7 de 30) | n/d | 8,3 |
| debug | Finanças | 5 abas | 3,2 s (N=20) | **1.333** | 402 | 1,58 / 2,45 s | **2,05 / 2,51 / 2,94 s** | 8,8 |
| debug | Finanças | 5 abas | ~1,3 s (N=30) | 960 | 348 | **4,84 / 9,84 s** (24 de 30) | n/d | 6,4 |
| debug | Patrimônio | 5 abas | ~1,2 s (N=30) | 924 | 270 | **4,47 / 10,44 s** (24 de 30) | n/d | 8,3 |

Leituras do mesmo conjunto:

- **Mesmo espaçamento, mesma tela (Finanças, 3,2 s):** release 624 ms de JS e 1,26 s até assentar; debug
  1.333 ms e 2,05 s. O release custa ~2,1× menos CPU e ~1,6× menos tempo até a tela.
- **A fila é do debug.** Com toques a ~1,3 s, o debug fica com a thread JS ocupada 4,5-4,8 s (p90 ~10 s) e
  leva 3-5 s para esvaziar depois do último toque; o release fica em 0,8-0,9 s (p90 2,3-3,5 s) e esvazia em
  0,7-1,4 s. Em ambos o custo por alternância passa de 1 s de relógio em parte dos toques.
- **O custo cresce com a árvore montada:** Patrimônio frio 405 ms contra 726-828 ms com as cinco abas atrás
  (~45 % do custo está em telas que nem estão à vista). Patrimônio e Finanças custam o mesmo com a árvore
  cheia (828 e 624 ms, mesma ordem), então não é coisa de uma tela.
- **Rajada** (40 toques, um a cada ~110 ms, Patrimônio): release 124 ms de JS por toque na janela, 14
  quadros, thread JS ociosa 0,72 s após o último toque; debug 99 ms por toque, 6 quadros, 2,82 s. Os toques
  se fundem em poucos commits: não há fila crescente nem `am_anr` em nenhum dos dois.
- **Ocioso** (40 s em Patrimônio, release): 940 ms de CPU no processo, 220 ms na JS (5,5 ms/s). O que
  sobra do custo por toque não é relógio de fundo.
- **Memória:** Native Heap 89 MB (frio) a 215 MB (rodada de 40 toques) no release, contra 740-777 MB no
  debug; PSS total 262-505 MB contra 1.093-1.167 MB. Sem tendência por alternância nos dois.
- **`gfxinfo` não discrimina:** 100 % dos quadros "janky" e mediana de 150-400 ms nos dois builds, porque o
  AVD roda GL por software (SwiftShader). As colunas acima não dependem disso.
- **ANR:** `am_anr` = 0 em todas as rodadas (~270 alternâncias no release, ~120 no debug).

### Comparação com o debug anterior

O Profiler do debug deu `actual` de 0,7-2,6 s (típico ~0,9 s) com o host entre 12 e 33 de carga. Hoje, com o
host entre 6 e 11, o debug custa 0,9-1,3 s de JS por alternância: **a mesma ordem**. A carga do host
alongou o relógio (e a fila), mas não é ela que faz o commit custar centenas de ms.

### Veredito

- **A hipótese "no release cai para dezenas de ms" não se confirma.** O custo por alternância continua em
  centenas de ms de CPU de JS (0,4-0,9 s) e 0,6-1,3 s até a tela assentar, nesta máquina.
- O incidente de 03/10 **não pode ser atribuído só a debug + carga do host**: o release reduz o custo pela
  metade e tira a fila, mas o commit continua grande e escala com o que está montado.
- **A causa raiz da ANR segue não comprovada.** Nada nas medições mostra a thread principal presa por 5 s
  (principal ~0,17-0,31 s de CPU por alternância, diluídos), e ~390 alternâncias somadas, algumas em rajada,
  não geraram `am_anr`. O que se sustenta: um app que gasta quase 1 s de JS por toggle, em aparelho mais
  lento ou sob carga, tem margem curta para virar não-resposta; isso é plausível, não provado.
- Limites desta medição: emulador sobre um Mac compartilhado (GL por software, host nunca abaixo de 6);
  valores absolutos não se transferem a um aparelho, a proporção entre cenários sim. Para cair em "dezenas
  de ms" o aparelho teria de ser cerca de 8-10x mais rápido que este vCPU, e a calibração (`dd | md5sum`
  de 300 MB em 1,84-2,52 s, estável entre rodadas) não sugere uma distância dessas; um celular de entrada
  tende a ser mais lento, não mais rápido. Hoje não foi medida à parte (o olho de Finanças é o mesmo
  mecanismo); o nativo do dev client é mais antigo que o do APK.
- N por rodada: 20 a 30 nas rodadas com latência (a janela de 120 quadros do `framestats` comporta 20
  alternâncias com 2-3 quadros cada) e 40 na rajada; os totais de 270 (release) e 120 (debug) vêm da soma.

### Correção mínima proposta (não implementada)

Pelo que a medição mostra (custo proporcional ao que está montado e a tela inteira re-renderizando),
em ordem de retorno por esforço:

1. **Congelar telas fora de foco**: `enableFreeze(true)` (`react-native-screens` 4.26, uma chamada na
   inicialização) ou `freezeOnBlur` nas opções do Tabs/Stack. Hoje o repositório não usa nenhum dos dois
   (`grep` de `enableFreeze|freezeOnBlur|<Freeze` vazio), então abas e telas cobertas re-renderizam à toa.
   Pelo contraste frio × cheia, deve tirar ~40-55 % do custo. **Riscos a testar:** (a) ao voltar para uma aba
   congelada, conferir que ela nunca pisca valores sem máscara (privacidade) antes de refazer o render;
   (b) no Android as abas são o `Tabs`/`TabSlot` headless de `expo-router/ui` com a `PillTabBar` própria
   (`app-tabs.android.tsx`), não o `NativeTabs`: confirmar se o `TabSlot` repassa o congelamento ao
   `react-native-screens` antes de contar com `freezeOnBlur`; se não repassar, só um `Freeze` à mão no slot
   vale, e a estimativa acima muda.
2. **Consumir o contexto só nas folhas**: 21 telas de `src/app` chamam `useBRL()` no corpo (a tela inteira
   re-renderiza a cada troca) e há 156 `<Money>`, 54 arquivos no total consumindo `conceal`. Trocar o
   `useBRL()` do corpo por `<Money>`/um componente pequeno de folha, ou memoizar as seções pesadas
   (`FinanceAnalysisPanes`, `InvestmentsSection`, `EmergencyReserveSection`), leva a troca de "re-render da
   tela" para "re-render dos textos". A máscara só muda strings.
3. **Não recomendado:** ignorar toques enquanto o commit anterior não assentou ou adiar a máscara
   (`startTransition`/`useDeferredValue`): não reduz o custo e deixa o valor visível por mais tempo,
   contra o propósito do recurso.

Para validar qualquer das duas: repetir esta medição (CPU da thread JS por alternância, Patrimônio com as
cinco abas, toques a 3 s). Meta razoável: abaixo de 300 ms de JS por alternância.

### Instrumentação e estado final

- **Instrumentação temporária (removida):** uma ação extra no `HeaderActions` de `src/app/finance/net-worth.tsx`
  (botão de olho chamando `useConceal().toggle`, rótulo `ANRTOGGLE`), porque Patrimônio não tem o olho (ele só
  existe em Hoje e em Finanças). Entrou no APK e, por Fast Refresh, no dev client; o Metro da 8081 serviu essa
  edição durante duas janelas (~14:57-15:09 e ~15:44-16:00), inclusive a um simulador iPad que também está
  ligado a ele. Arquivo restaurado do backup; `git diff` sem alteração em `src/`.
- `android/app/build.gradle` restaurado (`applicationId 'com.proops.personal.dev'`, `diff` idêntico).
  `android/app/build/outputs/apk/release/app-release.apk` (gitignorado) agora é o APK `.anr`, no lugar do de 03/10.
- No aparelho: `com.proops.personal.anr` desinstalado, scripts e logs de `/data/local/tmp` e `/sdcard` apagados,
  `show_touches` voltou ao padrão, dev client intacto. Ficou um `adb reverse tcp:8081 tcp:8081` (o dev client
  usa; se já existia não muda nada). O daemon do Gradle segue ocioso.
- **Dev client de volta ao Metro da 8081:** relançado com `-n com.proops.personal.dev/.MainActivity` e a URL
  `appproops://expo-development-client/?url=http://10.0.2.2:8081`; `ReactNativeJS: Running "main"` às 16:22:23,
  Metro registrou `Android Bundled 523ms index.js` e `170ms index.js`, `/json/list` do Metro lista o alvo
  `com.proops.personal.dev (sdk_gphone64_arm64)`, e a Hoje abriu como dev@ com os valores visíveis (a máscara
  não ficou ligada). O Metro nunca foi parado.
