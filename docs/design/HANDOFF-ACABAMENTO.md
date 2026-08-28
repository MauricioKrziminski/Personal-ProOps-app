# Handoff — acabamento visual (28/08/2026)

Documento de passagem para a próxima sessão. **Leia inteiro antes de tocar em código.**
Cada item tem: o que está errado, ONDE, por quê, o caminho sugerido e como verificar.

> Regra de ouro desta frente, aprendida na marra: **screenshot ou não aconteceu.** Nesta sessão
> a tela de Notas foi dada como "conferida" duas vezes e o usuário achou defeito nas duas. Code
> review e `tsc` limpo não detectam feiura. Abra a tela, olhe, e só então diga que está pronta.

---

## 0. Onde as coisas estão

- **Regras que não se negociam:** `.claude/rules/design.md`, `frontend.md`, `workflow.md`.
- **Documentos de tela:** `docs/design/*.md` — um por tela. Se o documento e o código
  discordarem, um dos dois está errado; conserte os dois no mesmo commit.
- **Escala tipográfica:** `src/design/tokens.ts` (`Type`). O `ThemedText` aponta para ela —
  **uma escala só**. Tipos: `default` (body 17/400), `title` (34/700), `subtitle` (22/600),
  `headline` (17/600), `small` (subhead 15/400), `smallBold` (15/600), `footnote` (13/400),
  `caption` (12/400).
- **Primitivos:** `src/components/ui/` — `card`, `row` (+`Section`), `button`, `money`,
  `sparkline`, `empty-state`, `field`, `icon`, `screen`, `segmented`, `toast`, `action-sheet`,
  `section-head` (`HeroLabel` + `SectionHead`), `header-actions` (`HeaderActions` + `HeaderMenu`,
  o **único** caminho para ação de header — `overflow-menu.tsx` foi absorvido por ele). Glass em
  `src/components/glass/glass-card.tsx`.
- **Estado atual:** 33 commits nesta frente, árvore limpa, `tsc`/`lint` limpos, **84 testes**
  verdes, contagem anti-slop zerada (0 hex fora do tema, 0 `fontSize` solto, 0 emoji na chrome,
  0 `SafeAreaView` à mão, 0 `Alert` cru, 0 `headerRight` montado à mão).

---

## 1. Ambiente — como rodar e verificar (isto economiza horas)

### Subir

```bash
orb start                                   # OrbStack (Docker) — o Supabase local depende dele
npx supabase start                          # API em 127.0.0.1:54321, Studio em :54323
npx expo start --dev-client --clear         # Metro
npx expo run:ios -d "iPhone 17 Pro"         # UDID F0BDF23C-0286-4183-97E3-3BCC61D4267D
npx expo run:android --device s26           # AVD "s26"
```

`.env` aponta para o Supabase LOCAL. O remoto está em `.env.remote.bak`. **Não** aplique
migration no remoto — o histórico diverge (seção A do `PROXIMO-PASSO.md`).

### ⚠️ Armadilha nº 1 — cache do Metro apaga uma tarde

Se der crash de worklets sem explicação (`jsi::Value::getString assertion "isString()" failed`,
SIGABRT em `mqt_v_js`), é **descasamento entre o JS transformado e o binário nativo** do
`react-native-worklets`. `--clear` sozinho NÃO basta:

```bash
pkill -f "expo start"
rm -rf node_modules/.cache "$TMPDIR/metro-cache"
npx expo start --dev-client --clear
npx expo run:ios / run:android              # o dev client precisa renascer junto
```

**`pidof`/processo vivo NÃO é critério de sucesso** — com redbox o app fica vivo e quebrado. O
critério é: zero `isString` no logcat **e** screenshot com a tela real.

### Navegar e fotografar

**Android é a plataforma de varredura** (deep link e tap são confiáveis):

```bash
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:54321 tcp:54321   # refazer após CADA restart
adb shell am start -a android.intent.action.VIEW -d "appproops:///finance/accounts"
adb exec-out screencap -p > tela.png
adb shell input tap X Y
adb shell cmd uimode night yes|no                                  # dark/light
```

**iOS é onde o usuário testa** — e onde ele achou os bugs. Ferramentas:

```bash
xcrun simctl io <UDID> screenshot t.png
xcrun simctl ui <UDID> appearance dark|light
cliclick -r c:X,Y            # clique (instalado via brew nesta sessão)
cliclick -r dd:X,Y m:X,Y2 du:X,Y2   # arrastar (rolar). Movimento LENTO vira long-press.
```

- `openurl` no iOS abre um diálogo do SpringBoard que **não some** e trava o simulador (só
  reboot resolve). **Não use deep link no iOS.**
- ⚠️ **`cliclick` sem guarda clica no app errado.** `osascript … activate` não garante que o
  Simulator veio para a frente: numa sessão cinco cliques caíram numa janela do Chrome que estava
  por cima. Confirme o frontmost ANTES de clicar e **aborte** se não for `Simulator`:
  `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`.
- Clique sintético **não abre linha de `FlashList` com `Link.Trigger`** no iOS (o context menu do
  iOS 26 engole o clique do mouse) e também não acionou botão de `Stack.Toolbar`. Para cair numa
  tela de detalhe, o caminho que funciona é um `router.push` temporário num `useEffect` da tela
  anterior — marque com `// TEMP-VERIFY` e reverta antes do commit.
- Clique na aba do iOS é instável. Para cair numa aba específica, o truque que funciona é
  remover temporariamente as outras de `src/components/app-tabs.tsx`, relançar, e **reverter**.
- Mapa janela→device: pegue `position`/`size` da janela via AppleScript; a tela do device começa
  ~11px da esquerda e ~28px do topo, e escala por `larguraJanela-22 / 402`.

### Dados de teste

Supabase local tem dados realistas (contas, cartão com fatura, contas a pagar atrasada/hoje/
futura, orçamento estourado, meta, dívida, 3 notas, lembretes). **Com 3 notas a lista não rola** —
para testar scroll, insira volume e **apague depois**:

```sql
insert into notes (workspace_id, user_id, content, source)
select n.workspace_id, n.user_id, 'Nota de teste ' || g || E'\nsegunda linha', 'app'
from (select workspace_id, user_id from notes limit 1) n, generate_series(1,18) g;
-- depois: delete from notes where content like 'Nota de teste %';
```

---

> **Estado em 28/08, fim da sessão seguinte:** os três defeitos da seção 2 estão **resolvidos**
> (commits `ba4ca63`, `41499dd`, `b41be59`), verificados em iOS claro/escuro e Android
> claro/escuro. A seção continua aqui como registro do que era e por quê. O que segue aberto é a
> seção 3 — direção estética de marca (decisão do usuário), Dynamic Type e o passe de movimento
> em vídeo.

## 2. Os três defeitos que o usuário apontou (prioridade máxima) — RESOLVIDOS

### 2.1 — "GERENCIAR": 12 links empilhados no fim do Financeiro

**Onde:** `src/app/(tabs)/finance/index.tsx` — array `MANAGE` (~linha 61) e render (~linha 557).
**Documento:** `docs/design/financeiro.md`.

**O que ele disse:** *"não é o padrão de aplicativos semelhantes deixar 'gerenciar' ali embaixo e
sim colocar um tab em cima ou qualquer outra coisa."*

**O que está lá hoje:** uma `Section title="Gerenciar"` com **12 `Row`s** de navegação no fim da
aba Financeiro: Todos os lançamentos, Contas e carteiras, Cartões e faturas, Faturas anteriores,
Compras parceladas, Orçamentos, Metas, Dívidas, Recorrentes, Patrimônio, Relatórios e IR,
Plano e família.

**Por que incomoda:** a aba Financeiro é "como está o meu mês?" — resumo. Doze destinos
empilhados no rodapé transformam o fim da tela num menu de configurações, e o usuário precisa
rolar a tela inteira para alcançar qualquer um deles. Nenhum app de finanças de referência
resolve assim.

**O que decidir (é decisão de produto — apresente opções ao usuário antes de codar):**
- **Faixa de atalhos no topo** (chips ou grid 2×N logo abaixo do card de destaque) com os 4–5
  mais usados, e um "Ver tudo" para os demais.
- **Segmented control / abas internas** no topo da aba, separando "Resumo" de "Gerenciar".
- **Mover o menu para a aba Perfil**, deixando o Financeiro só com conteúdo.
- **Grid de ícones** em vez de lista vertical — 12 itens em 3 colunas ocupam 4 linhas em vez
  de 12.

**Restrições:** `design.md` §8 — abas são pares, re-tap volta à raiz; máximo 5 abas na barra
inferior (já são 4, não cabe uma quinta). Qualquer navegação nova precisa responder: o que é o
destino, dá para voltar, e o que "voltar" faz depois.

**Atualize junto:** `docs/design/financeiro.md` (a seção Anatomia descreve o menu atual).

---

### 2.2 — Pílula de ações do header sem padding/raio uniforme

**Onde:** três padrões diferentes convivendo.

| Padrão | Arquivos | Como é |
|---|---|---|
| `View` à mão + `Pressable` + `Icon` | `(tabs)/today/index.tsx:105`, `(tabs)/notes/index.tsx:322` (estilo `headerActions`, `gap: Space.lg`) | dois ícones soltos dentro de uma `View` |
| `Stack.Toolbar` nativo | `finance/index.tsx`, `transactions.tsx`, `[txId].tsx` | só iOS; no Android usa `androidOverflow` (`src/components/ui/overflow-menu.tsx`) |
| `Pressable` único inline | `notes/folders.tsx`, `notes/trash.tsx`, outros | um ícone, sem container |

**Por que fica torto:** no iOS 26 o header nativo desenha uma **pílula de vidro** em volta do que
está no `headerRight`. Quando o conteúdo é uma `View` à mão com dois `Pressable` e `gap: 16`, a
pílula envolve a `View` inteira e o respiro interno não é o do sistema — é o `gap` que a gente
escolheu. Daí a sensação de padding errado e de raio que não bate entre telas.

Some a isso uma violação de `design.md` §4 (**disciplina filled vs outline**): na Hoje convivem
`magnifyingglass` (contorno) e `plus.circle.fill` (preenchido, azul) no MESMO nível de
hierarquia. Um vira glifo, o outro vira botão.

**Caminho sugerido:**
1. Criar **um primitivo** `HeaderActions` (ou estender `overflow-menu.tsx`) que seja o único
   caminho para ação de header — como o `Icon` é para ícone e o `Button` para ação.
2. Preferir o **nativo** onde der: `Stack.Toolbar.Button` deixa o sistema resolver pílula,
   espaçamento e o comportamento com o large title. Lembre que `Stack.Toolbar` **reclama o slot
   direito do header mesmo sem desenhar no Android** — por isso hoje ele é envolto em
   `Platform.OS === 'ios' ? … : null` e o Android recebe `headerRight` (veja o comentário em
   `overflow-menu.tsx`, isso já mordeu uma vez).
3. Padronizar peso de ícone: **ou todos contorno, ou todos preenchidos**, nunca misturado no
   mesmo header.

**Verificar em:** Hoje, Notas, Financeiro, Perfil, Pastas, Lixeira, detalhe da nota — lado a
lado, iOS claro e escuro. É uma inconsistência que só aparece comparando telas.

---

### 2.3 — Tela de detalhe da nota (`notes/[id]`) está fraca

**Onde:** `src/app/(tabs)/notes/[id].tsx`, componente `ReadBody`.
**Documento:** `docs/design/nota-detalhe.md`.

**Defeitos concretos, verificados no print do usuário:**

1. **Título duplicado.** O header nativo mostra "Reunião com o contador" (vem de
   `noteTitle(content)`), e o `ReadBody` renderiza **todas** as linhas — inclusive a primeira,
   que é o mesmo título. A pessoa lê a mesma frase duas vezes, com 40px de distância.
2. **Hashtag crua no corpo.** O corpo mostra `levar extrato do trimestre #trabalho` enquanto a
   mesma tag já aparece como chip logo acima. (Na LISTA isso já foi corrigido: `noteTitle` e
   `notePreview` passam por `stripTags`. No detalhe, não — e ali é discutível, porque é o texto
   que volta pro WhatsApp. **Decida e documente.**)
3. **Sem hierarquia nenhuma.** Todas as linhas em `Type.body`, sem espaçamento entre elas
   (`ReadBody` empilha `ThemedText` sem `gap`). Nota com 5 linhas vira um bloco.
4. **Vazio enorme.** Nota curta deixa 70% da tela em branco, sem nada — nem affordance de
   edição, nem estrutura.
5. **Metadado solto.** `via WhatsApp · há 15 min` fica numa linha órfã entre os chips e o corpo.

**Caminho sugerido (a anatomia é decisão; alinhe antes):**
- Primeira linha vira **título de verdade** no corpo (`title`/`subtitle`) e sai do header, OU
  continua só no header e o corpo começa da segunda linha. Escolha uma — hoje faz as duas.
- `gap` entre linhas do corpo (`Space.sm`) e respiro nas laterais.
- Metadado junto dos chips, não em linha própria.
- Estado vazio/curto: dar ao corpo uma área de toque óbvia ("Toque para escrever") em vez de
  branco morto.
- Checklist já funciona bem (círculo + risco) — **não mexa** nisso sem motivo.

---

## 3. Pendências que já estavam anotadas

### 3.1 Direção estética de marca — **decisão do usuário, não sua**
O que foi feito até aqui é **sistema e consistência** (escala, hierarquia, densidade, superfície).
O que NÃO foi feito é identidade: paleta própria, personalidade, o que faz o app parecer *deste*
produto e não "iOS bem feito". Isso exige **referência real** (prints que ele goste, ou o MCP do
Appllama, que não estava conectado em nenhuma das sessões). **Não invente de memória** — foi
exatamente assim que a primeira leva de telas nasceu "correta e sem graça".

### 3.2 Não verificados
- **Dynamic Type (texto grande):** o `simctl ui` desta versão não expõe `content-size`. Só na
  mão, pelos Ajustes do simulador. `design.md` §11 exige.
- **Passe de movimento em vídeo** (`design.md` §11): nenhuma animação foi avaliada em gravação.
  O emulador Android está com **Reduce Motion ligado** — o que se viu lá estava colapsado.
- ~~**Guarda de perda de dado** nunca exercitada~~ — **resolvido em 28/08.** A decisão saiu do
  componente para `skipReason` (`src/lib/notes-autosave.ts`), com 8 testes, e foi exercitada no
  emulador: apagar todo o texto de uma nota e sair **não** grava; o `content` e o `folder_id`
  sobrevivem, e em `__DEV__` sai `[nota] autosave bloqueado: estado vazio sobre nota com texto.`
  no log.

### 3.3 Bug de perda de dado — gatilho provável identificado

Em 28/08 uma nota vinda do WhatsApp voltou do detalhe com `content` vazio **e `folder_id` nulo**.
Restaurada à mão, e o gatilho ficou sem explicação depois de duas tentativas de reproduzir.

**A evidência apareceu no `logcat` do emulador**, no mesmo dia, às 13:56:

```
E ReactNativeJS: { [ReferenceError: Property 'tagsOf' doesn't exist]
  componentStack: '\n    at NoteDetailScreen (…/notes/[id].bundle…)'
```

O Fast Refresh entregou um módulo incompleto (`tagsOf` estava sendo acrescentado ao `search.ts`
naquele momento) enquanto a tela estava aberta; ela lançou no render e o React remontou. Nesse
caminho o `useState` volta ao inicial — `content: ''` e `folderId: null` —, que é **exatamente o
par de valores que foi gravado**. Os `useRef` (`hydrated`, `idRef`, `persisted`) podem sobreviver
ao refresh, então o `hydrated` sozinho não segurava.

Não é prova, é a hipótese que casa com os dois valores ao mesmo tempo. É **dev-only** — Fast
Refresh não existe em produção —, mas o app roda em dev client no aparelho, então o risco era
real enquanto se mexia no arquivo.

**O que fecha a classe inteira, independentemente do gatilho:** `skipReason`
(`src/lib/notes-autosave.ts`) — estado que nunca foi hidratado, ou que voltou ao inicial, não
grava por cima de linha que tem conteúdo. Um dos testes reproduz literalmente a remontagem
(`refs sobreviveram, useState zerou`) e exige `'would-empty'`.

Se reaparecer **com a guarda no lugar**, aí sim é prioridade sobre qualquer coisa visual: quer
dizer que existe um segundo caminho.

### 3.4 Telas documentadas que não existem
`docs/design/conta-detalhe.md` descreve uma tela de extrato por conta que **não foi
implementada**. `conta-a-pagar` e `lembrete-recorrencia` viraram modo/seção de outros formulários
— os documentos dizem outra coisa.

---

## 4. Não faça

- **Não aplique migration no remoto.** O histórico diverge; o roteiro está no
  `PROXIMO-PASSO.md` §A, esperando o usuário.
- **Não instale lib nova sem justificar.** Aprovadas e já instaladas: `@shopify/flash-list`,
  `react-native-keyboard-controller`, `@shopify/react-native-skia`.
- **Não "conserte" o colapso do large title na Notas.** Ele é fixo de propósito: o iOS não
  rastreia a `FlashList`, e sem header opaco o conteúdo desenha por cima do título (era o bug
  que o usuário reportou). Detalhe em `notas.md`.
- **Não use `Link.Menu` sozinho** — é iOS-only. O caminho é `showItemActions`/`confirmDestructive`
  (`src/lib/item-actions.ts`).
- **Não deixe ícone fora do mapa.** `expo-symbols` **não** traduz SF→Material sozinho; o mapa
  vive no `Icon` e há `console.warn` em `__DEV__` para nome não mapeado. Ícone novo = entrada
  nova no mapa, senão some no Android.
- **Não commite `.env`.** Commits: conventional, **uma linha, sem co-autor**.

## 5. Antes de dizer que acabou

1. `npx tsc --noEmit`, `npx expo lint`, `npm test` (71 testes) limpos.
2. Screenshot da tela **iOS claro + iOS escuro + Android claro + Android escuro**.
3. Contagem anti-slop medida (não afirmada):
   `hex fora do tema · fontSize solto · emoji na chrome · SafeAreaView à mão · Alert cru` = 0.
4. Documento da tela atualizado no mesmo commit.
