# Design — fidelidade nativa iOS 26 / Material 3 (obrigatório)

O app senta na tela ao lado do Apple Wallet e do Things. É assim que ele é julgado, em segundos.
Nenhuma tela é entregue "crua", e nenhuma tela é entregue "quase nativa".

**Uma frase:** *o app é o lugar calmo onde o que o usuário jogou no WhatsApp aparece organizado —
e onde ele decide o que fazer com isso.*

---

## 1. Superfícies — glass é destaque, não papel de parede

- **Glass fica na chrome**: tab bar nativa (`NativeTabs`), header, sheet e FAB.
- **Mais um único destaque por tela** — o bloco que responde a pergunta principal daquela tela
  (sobra do mês, patrimônio líquido, total da fatura, progresso da meta).

**O destaque das telas principais é `HeroPanel`, não glass** (29/08/2026). Vidro precisa de algo
atrás para refratar; sobre o fundo chapado do app ele virava um retângulo cinza com um número
dentro — a causa concreta do diagnóstico "corretas e sem graça". `GlassCard` continua na chrome e
no destaque de telas secundárias. A contagem não mudou: **um destaque por tela**.

**E o `HeroPanel` deixou de ser tinta chapada** (03/09/2026). Ele é um card de raio 12 com
**gradiente vertical** (`heroTop` → `heroBottom`), um **brilho verde difuso** saindo pelo canto
superior direito e um fio especular de 1px no topo — `GradientSurface`
(`src/components/ui/gradient.tsx`), em Skia, porque não há gradiente em `StyleSheet` e
`expo-linear-gradient` seria dependência nova para dois nós. Chapado ele ainda lia como retângulo
escuro com um número dentro; o export resolve o mesmo problema com LUZ, não com contraste.

O brilho ocupa o canto onde ficava a marca d'água da espiral, então ela saiu do painel — a forma
da marca continua nos outros quatro papéis.

⚠️ **`Canvas` do Skia NÃO aceita `onLayout`** (avisa "is not supported" em runtime e o gradiente
não posiciona). Quem mede é uma `View` em volta; o canvas só preenche.

**A faixa de rodapé que SANGRA até as bordas** é o segundo padrão repetido do export (painel de
destaque e card de tendência): superfície um degrau mais escura (`heroFooter`), pílula com o delta
à esquerda, comparação em texto à direita. Ela existe para o número grande não ter que carregar
contexto. Em card comum sai por `marginHorizontal/-Bottom` negativos + `overflow: 'hidden'`.
- **Todo o resto é opaco.** Card de lista, linha, formulário: superfície sólida, hierarquia por
  **elevação e espaço**, nunca por blur.

> Dois `GlassCard` na mesma tela é erro de revisão, não questão de gosto.

**Cartão de crédito é um CARTÃO, não um card** (`src/components/finance/card-stack.tsx`).
Anatomia obrigatória, medida do export: chip EMV dourado, contactless, número mascarado, fatura
atual em display, data de fechamento, barra de limite e rodapé com vencimento e disponível. Sem
essas peças o bloco lê como card de conteúdo — foi a queixa de 03/09/2026 ("ele fez em formato de
card ao expandir, ficando muito feio").

Fechada, os cartões de trás aparecem **ACIMA** do da frente e mais estreitos (`inset-x-2`,
`inset-x-4`), que é como uma carteira de verdade e como o Wallet fazem: para BAIXO a pilha lê como
lista. Ao toque ela abre em leque e **cada cartão continua sendo um cartão inteiro**, só deslocado
por um passo de 92px; escolher um fecha a pilha com ele na frente. O corpo do cartão abre a
carteira e a fatura tem botão próprio — um toque só não pode decidir entre "ver os outros" e
"abrir a fatura".

⚠️ **A cor DO BANCO voltou** (03/09/2026, decisão do dono do produto, contra a regra anterior).
O mapa nome → cor mora em `src/design/card-brands.ts`, que é allowlisted no `anti-slop.test.ts`:
a cor de um emissor não tem par light/dark porque não é nossa. Ela entra **misturada com a
superfície** (`blend`, nunca com preto puro — misturar com preto sumia o cartão no fundo escuro),
mais o ponto da bandeira e a barra de limite. Fora do cartão, cor de terceiro continua proibida.
A objeção antiga (roxo lê como Nubank) continua verdadeira e continua valendo em qualquer outro
lugar da tela — o que mudou é que DENTRO da forma de um cartão de crédito o usuário já espera a
marca do emissor.

⚠️ **`withSpring` só é interceptado quando é o valor DIRETO da propriedade de estilo.**
`withSpring(a) * b` devolve `NaN` e a view some sem um único erro no log — foi assim que a
carteira inteira ficou invisível. A conta vai DENTRO: `withSpring(a * b)`.

**Card de destaque que SOMA uma lista some quando a soma não informa nada:** com a lista vazia
(zeros em cima de um empty state) ou com UM item, quando ele repete o número da única linha
palavra por palavra. Soma de um item não é resumo, é eco — foi o caso de Cartões. Continua
aparecendo quando acrescenta algo que a linha não diz (juros até quitar, em Dívidas).

**Rótulo do herói vem ANTES do valor**, sempre, via `HeroLabel`. Era o único jeito de Plano ficar
igual às outras seis telas com card de destaque.

`src/components/glass/glass-card.tsx` (`GlassCard`) é o único caminho para glass. Ele resolve
`isLiquidGlassAvailable()` → `GlassView` nativo (iOS 26+) com fallback `BlurView` em iOS antigo,
Android e web. **Nunca** usar `GlassView`/`BlurView` direto numa tela.

Card comum é `Card` (`src/components/ui/card.tsx`): opaco, `Elevation`, `Radius.md`.

---

## 2. Tokens — fonte única, sem exceção

`src/constants/theme.ts` (cores e fontes) + `src/design/tokens.ts` (o resto).

| Token | Regra |
|---|---|
| **Cor** | Sempre via `useTheme()`. **Zero hex em tela.** Toda cor nova precisa de par light **e** dark. |
| **Raio** | `Radius`: `xs 8` (nada menor), `sm 12` inputs e linhas, `md 16` cards, `lg 20`, `xl 28` sheets, `pill` ações. Sempre com `borderCurve: 'continuous'`. |
| **Espaço** | Escala `Spacing`. Preferir `gap` do flexbox a empilhar margem. Padding de scroll vai em `contentContainerStyle`, nunca no `ScrollView`. |
| **Elevação** | `Elevation` via `boxShadow`. **Nunca** `shadow*`/`elevation` legado. Um sistema de elevação só. |
| **Movimento** | `Motion` (durações e curvas). Nada de `400` literal espalhado. |
| **Tipografia** | `ThemedText type=...`. **Zero `fontSize` solto.** |
| **Ícone** | `Icon` (`expo-symbols`). Zero emoji na chrome, zero glyph de texto (`‹`, `＋`) fazendo papel de ícone. |

**Um accent só** (`tint`), gasto em ação primária, estado ativo e progresso. `danger`, `success`
e `warning` são semânticos — nunca decoração. Uma família de cinza no app inteiro.

**O accent é VERDE desde 03/09/2026** — `#6DDC9E` no escuro, `#0D8F5B` no claro. É o `secondary`
do Stitch, adotado por decisão do dono do produto junto com a paleta inteira. A seção "o roxo foi
testado e devolvido", mais abaixo, continua valendo como registro do que NÃO fazer (roxo lê como
Nubank em finanças no Brasil); o que mudou é que o accent deixou de ser tinta monocromática. Ação
primária agora se comunica por superfície **e** matiz.

⚠️ **Superfície escura tem paleta PRÓPRIA: `heroChip`, `onHeroSuccess`, `onHeroDanger`,
`onHeroWarning`.** O painel de destaque e o cartão de crédito aberto são escuros nos DOIS temas.
Pintados com os tokens do tema ativo, o modo claro entregava um botão branco sólido com ícone
branco dentro — invisível — e vermelho escuro sobre preto. Dentro de superfície escura, use os
tokens `onHero*`; fora dela, os normais.

**A escala de raio virou a do Stitch** (03/09/2026): `xs 4` badge e barra, `sm 8` input e linha,
`md 12` card — o raio mais usado do design inteiro —, `lg 16` card de destaque, `xl 20` sheet,
`pill` ação. Os nomes não mudaram, só os valores; cards de 16 liam macios demais ao lado do
desenho.

**Todo card leva contorno de 1px em `cardBorder`.** É a assinatura do design e não é enfeite: no
fundo quase-preto a sombra desaparece, e sem o contorno o card não tem onde terminar — a tela
inteira lia como um bloco só. `Card` já aplica; superfície escrita à mão também precisa.

**O tema é ESCOLHA do usuário** (`ThemeProvider` em `src/hooks/use-theme.tsx`): `system` por
padrão, mais `light` e `dark` explícitos, gravados no `AsyncStorage` e trocados no Perfil. Esteve
travado em dark entre 02 e 03/09/2026 — o desenho do Stitch é OLED e o claro o desmontava —, e a
trava cobrou caro: metade da paleta ficou sem ninguém olhando.

⚠️ **`useColorScheme` do `react-native` é PROIBIDO em componente.** Quem responde qual esquema
vale é `useScheme()` do provider; o hook da plataforma ignora a escolha do usuário e o componente
que o usar fica com a elevação do tema errado — em silêncio, porque a cor ainda existe.
`Card`, `Row`, `Toast`, `GlassCard` e `Segmented` já foram corrigidos.

---

## 3. Tipografia — Hanken Grotesk + JetBrains Mono (03/09/2026)

**Duas famílias, e a régua da plataforma saiu.** O app usava `system-ui` e por isso lia como "iOS
bem feito genérico" mesmo com o layout certo — era a queixa, e a causa era esta linha.

| papel | família | onde |
|---|---|---|
| texto | **Hanken Grotesk** 400/500/600/700 | tudo que se lê |
| dado | **JetBrains Mono** 400/500/600 | hora, contador, unidade, badge, percentual, dinheiro em linha |

O par é o que dá voz a um sistema **sem cor de marca**: um tipo para ler, outro para carimbar
dado. Sem o mono o app volta a ser uma escala de cinza com uma fonte só.

**Peso é FAMÍLIA, nunca `fontWeight`.** Fonte custom no Android ignora `fontWeight` e cai no
regular com bold sintético. Quem escolhe a face é a variante de `Type`, que aponta para o nome
exato (`HankenGrotesk_600SemiBold`). `fontWeight` numa tela é bug, não estilo.

A escala é a do Stitch, medida do export, não inventada: 11 / 13 / 15 / 17 / 20 / 26 / 32, com
`letterSpacing` negativo do 15 para cima e positivo no 11. O tracking faz parte do desenho —
copiar só o `fontSize` não reproduz a tipografia.

As faces carregam por `useFonts` no `_layout.tsx` raiz e o splash segura até terminarem: `Type`
aponta pelo NOME, e face ausente não cai no system font — ela some.

**Uma display por tela** continua valendo.

**`fontVariant: ['tabular-nums']` em todo número que conta, mede ou custa** — dinheiro, data,
percentual, contador. Sem isso o valor "pula" quando muda.

Texto de UI em **pt-BR**, informal e direto. Uma intenção, um rótulo: "Salvar" é sempre "Salvar",
nunca "Confirmar" na tela seguinte.

---

## 4. Ícones e ilustração

- `Icon` (`src/components/ui/icon.tsx`) é o único caminho. Nenhuma outra biblioteca de ícone
  entra no projeto.
- **`expo-symbols` NÃO traduz nome sozinho** — esta regra afirmava que sim, e por isso *todo*
  ícone do app ficou invisível no Android até 28/08. No Android o `SymbolView` só resolve o nome
  no formato objeto (`{ ios, android }`); recebendo a string de um SF Symbol ele devolve o
  `fallback`. O mapa SF → Material vive dentro do `Icon`. **Ícone novo = entrada nova no mapa**,
  senão ele cai no glyph genérico `circle` no Android.
- **Emoji não é ícone.** Emoji só aparece em *conteúdo* — texto que o usuário escreveu, mensagem
  que veio do WhatsApp. Nunca em botão, aba, empty state, linha de lista ou título.

---

## 5. Movimento

Decidir nesta ordem:

1. **Frequência.** Ação feita 100× por dia (trocar de aba, teclado, scroll, voltar) → **o padrão
   da plataforma e nada mais**. Dezenas de vezes (press, selecionar linha) → imperceptível,
   < 150 ms. Ocasional (sheet, modal, toast) → movimento padrão. Delight só em momento raro.
2. **Propósito em uma palavra** — feedback, continuidade espacial, mudança de estado, explicação.
   Não achou a palavra? Não anima. **Dado que o usuário está lendo não se move por estética.**
3. **Teve dedo envolvido → mola.** `Motion.spring.sheet` para sheet, `Motion.spring.settle` para
   assentar. Sem dedo → timing < 300 ms com ease-out forte (`Motion.easing.out`). Nunca ease-in
   numa entrada. Saída é mais rápida que entrada.

Press-in de 100–150 ms: `scale 0.97` em botão e card; **highlight de fundo (não scale) em linha
de lista**; opacidade em botão de header.

Animação roda em **worklet** (`useSharedValue` + `useAnimatedStyle`), só `transform` e `opacity`.
Nunca animar altura de header. `Reduce Motion` colapsa movimento espacial em cross-fade.

Barra de progresso e gráfico **animam** quando o valor muda — valor que salta é bug visual.

---

## 6. Feedback

- **Haptics é pontuação**, um por ação do usuário, no mesmo frame do visual: `selectionAsync` ao
  passar de opção, `impactAsync(Light)` ao encaixar, `notificationAsync` no resultado. Nunca em
  scroll, nunca em loop, nunca como único feedback.
- **Mutation que falha precisa aparecer.** Toast + rollback visível. Falha silenciosa é
  reprovação — vale para delete, toggle, arquivar e pagar, não só para salvar.
- Confirmação destrutiva é **action sheet nativo**. Ação de item é **context menu nativo**.
  `Link.Menu` do expo-router é **iOS-only** — usar só ele deixa o Android sem ação nenhuma na
  linha. O caminho único é `showItemActions` / `confirmDestructive` (`src/lib/item-actions.ts`),
  que fala o idioma de cada plataforma: `ActionSheetIOS` no iOS, diálogo de opções no Android.
  `Alert` cru escrito na tela continua proibido; como **fallback de plataforma dentro do helper**,
  é o certo.

---

## 7. Estados obrigatórios em TODA tela

1. **Loading** — `Skeleton` com **a forma do conteúdo final**. Nunca spinner de tela cheia para
   atualização parcial.
2. **Empty** — `EmptyState`: ícone SF, título, e uma **dica acionável** (normalmente o atalho do
   WhatsApp). Composto, não um parágrafo cinza.
3. **Error** — inline e específico, com "Tentar de novo" que refaz a query.
4. **Conteúdo longo** — texto que trunca sem quebrar layout.

**Cada seção da tela tem o seu.** Tela com 4 queries não pode esconder o erro de 3 delas atrás do
estado da primeira: seção que falha diz que falhou, não some.

---

## 8. Navegação

Toda transição responde três perguntas: o que é o destino, o usuário precisa poder voltar, e o
que "voltar" faz depois.

- **Header é do navegador — exceto nas quatro RAÍZES de aba.** Ali quem desenha é o `AppHeader`
  (`src/components/ui/app-header.tsx`): **a faixa de marca do Stitch** — 56px sobre a safe area,
  fundo do app a 85% com desfoque, fio de 1px embaixo, e dentro dela a marca num quadrado de 28,
  a palavra "ProOps" em `Type.wordmark`, um ponto de status e o avatar de 32 à direita. Ação de
  raiz vai no slot `action` (`HeaderIconButton`), antes do avatar.

  A barra é **sobreposta**, não em fluxo: o desfoque só significa algo com conteúdo passando por
  baixo. Quem reserva a altura é a tela, por `useAppHeaderHeight()` — o `Screen` já faz isso
  quando recebe `topBar`, e as raízes com scroll próprio somam à mão.

  ⚠️ **Isto já foi decidido nos dois sentidos.** Entre 30/08 e 03/09/2026 a faixa foi trocada por
  uma micro-etiqueta de contexto + display grande, com o argumento de que a marca no topo gasta a
  faixa mais nobre da tela dizendo o que a pessoa já sabe. O argumento continua de pé em abstrato;
  o desenho é do dono do produto e as quatro telas do export têm esta barra. **Não "corrigir" de
  novo.** O custo aceito é a perda da etiqueta (a data em Hoje, a contagem em Notas).

  O avatar leva o ícone de pessoa, não iniciais: `profiles` guarda só o telefone, e tirar iniciais
  de um número seria escrever um dado que não existe.
  **Tela EMPURRADA continua com `<Stack.Title>` + large title** — lá o título e o "voltar" são a
  informação. Barra desenhada à mão dentro do `ScrollView` continua proibida: o `AppHeader` fica
  FORA dele.
- **Ponto de status não existe mais — nem piscando, nem parado** (03/09/2026, decisão do dono do
  produto). Primeiro caiu a pulsação: movimento permanente no canto do olho não tem propósito
  (§5), some do radar em um dia e custa bateria. Depois caiu o ponto inteiro, e por um motivo
  melhor: **no header ele era sempre verde** — não havia estado em que ficasse vermelho, ou seja,
  era cor decorativa no lugar mais nobre da tela, num app cuja única alavanca de cor é a
  semântica. Nos cabeçalhos de seção o rótulo já diz o que o ponto diria ("ATRASADO / ATENÇÃO"),
  e nos contadores da Hoje a cor passou para o NÚMERO — um ponto ao lado de um número é o mesmo
  dado dito duas vezes, e o número é a metade que se lê.
  O prop `dot` do `SectionHead` foi REMOVIDO para não voltar por descuido. Continuam válidos: o
  separador de 3px entre metadados (é pontuação) e a bolinha da bandeira no cartão de crédito
  (identifica o emissor).
- **Busca é `<Search>`** (`src/components/ui/search-field.tsx`), em Notas, Lançamentos e
  `/search`. Um componente, dois desenhos: no **iOS** ele renderiza o `<Stack.SearchBar>` nativo,
  que integra com o large title e some no scroll; no **Android** renderiza uma pílula
  (`SearchField`) no corpo da tela. A divisão existe porque no Android o nativo desenha uma laje
  de **canto 0** — o único elemento fora da escala `Radius`, encostado num input de raio 12 e numa
  fileira de chips em pílula — e a API expõe cor (`barTintColor`, `textColor`, `hintTextColor`,
  `headerIconColor`) e **não expõe forma**. O mesmo `<Search>` pode ficar onde o campo deve
  aparecer no Android sem abrir buraco no iOS: `Stack.SearchBar` escreve opções por hook e
  **retorna `null`**, não é filho posicional. O recuo lateral é da TELA, não do componente — cada
  uma já tem a própria calha.
- **Ação de header tem um caminho só**: `HeaderActions` (botões) e `HeaderMenu` (menu "…"), em
  `src/components/ui/header-actions.tsx`. **Nunca montar `headerRight` à mão.** No iOS 26 o header
  desenha uma pílula de vidro em volta do conteúdo do `headerRight`: entregar uma `View` própria
  faz o respiro interno ser o nosso `gap`, e cada tela escolhia um — foi assim que a pílula ficou
  com padding e raio diferentes entre telas. O primitivo usa `Stack.Toolbar` no iOS (o sistema
  resolve pílula, espaçamento e large title) e `headerRight` no Android, onde o toolbar nativo
  reclama o slot sem desenhar nada. Ação condicional passa **array vazio**, nunca
  `{cond ? <HeaderActions/> : null}`: `Stack.Screen` só chama `setOptions` e o expo-router não
  desfaz no unmount — desmontar deixaria o botão velho no header do Android. Submit de form modal
  leva `primary` (vira `variant: 'done'`, o negrito do sistema); sem ele o "Salvar" fica menos
  proeminente que o "Cancelar" ao lado.
- **Presentation é significado**: tarefa com etapas → `modal` com Cancelar/Salvar próprios;
  escolha curta → `formSheet` com detents; confirmação destrutiva → action sheet; ação de item →
  context menu nativo.
- **Porta de mão única** (login, onboarding concluído, compra) sai da pilha com `Stack.Protected`
  + `replace` — voltar nunca reentra no estado antigo.
- **Abas são pares.** Nada de slide entre abas; re-tap na aba ativa volta à raiz.
- **A tab bar tem DUAS implementações, uma por plataforma.** No iOS é a `NativeTabs`
  (`app-tabs.tsx`) em Liquid Glass, que o sistema desenha melhor do que qualquer coisa nossa —
  inclusive o encolhimento ao rolar. No Android é o `CurvedTabBar` (`app-tabs.android.tsx`): uma
  pílula com um **berço que desliza** até a aba ativa, com a bolha do ícone encaixada nele. Lá não
  existe equivalente nativo — a barra do Material 3 é uma laje reta —, e é onde um desenho próprio
  paga. O berço **anima em mola**, porque o que ele comunica é continuidade espacial; um recorte
  fixo seria só enfeite. Uma posição só governa a curva e a bolha: duas molas dessincronizariam e
  a bolha sairia do berço no meio do caminho.

  **O berço é um CÍRCULO SUBTRAÍDO, concêntrico com a bolha** (03/09/2026): raio `BUBBLE/2 + 7`,
  então a folga é a mesma em volta inteira — foi exatamente o pedido ("a borda interna atrás do
  ícone seguir o border radius do círculo"). No Skia: pinta a pílula, pinta o traço dela, e por
  cima um disco da cor do FUNDO mais o traço do berço, os dois dentro de `Group clip={pílula}`.
  O disco apaga o traço da barra onde a mordida passa (a antiga "linha em cima do ícone") e a
  metade de cima do círculo some sozinha no clip. O que anda é o `cx` do círculo, um shared value
  que o Skia aceita direto — nada é montado dentro de worklet.

  ⚠️ **Duas construções anteriores falharam, e as duas eram invisíveis na leitura do código:**
  1. `View` circular pintada da cor do fundo, com o centro em `LIFT + BUBBLE/2` enquanto o da
     bolha estava em `LIFT` — **26px fora do lugar**, a bolha empoleirada na borda de um buraco
     de 66px. O comentário dizia "concêntrico"; os números diziam outra coisa. Foi o que ficou
     "muito diferente do que eu pedi".
  2. Path único com o berço tecido no contorno e ombros tangentes. Quebrava na PRIMEIRA e na
     ÚLTIMA aba, onde o berço cai dentro do canto arredondado: o `Math.max(..., r)` punha o
     início do ombro DEPOIS do fim dele e o contorno se cruzava, apagando a mordida. (O export
     tem o mesmo defeito: `C 0 19.7 19.7 0 44 0` seguido de `L 32.7 0`, andando para trás.)

  A bolha é da **cor da barra um degrau acima** (`backgroundSelected`) com o ícone no accent, mais
  sombra — é o desenho do export. Preenchê-la de `tint` com o ícone invertido gastava o accent
  inteiro num controle tocado 100× por dia. No escuro, barra, bolha e fundo ficam todos dentro de
  20/255: **quem separa os três é o traço em `separator`**, não a diferença de superfície.
- **`backgroundColor` na `NativeTabs` é proibido no iOS.** Dar cor de fundo torna a barra opaca e
  **desliga o Liquid Glass** — o material que é diretriz do projeto. Cor de fundo, indicador e
  ripple entram por `Platform.select` só no Android; no iOS quem desenha é o sistema, mais
  `minimizeBehavior: 'onScrollDown'` (iOS 26), que é comportamento nativo, não animação nossa.
  Isso ficou meses ligado sem ninguém notar, porque a barra *parecia* certa no Android.
- **Badge de aba é contagem real ou não existe.** Mesma régua dos atalhos do painel: número que
  não muda decisão é enfeite. Hoje leva o que vence + lembrete do dia + orçamento estourado, e
  some com zero.
- **Criar item de lista é `+` no header**, nunca botão de bloco no corpo — Contas, Cartões,
  Orçamentos, Metas, Dívidas, Recorrentes, Regras e Lembretes. O botão no corpo existe só dentro
  do `EmptyState`, onde não há lista para o `+` do header explicar.

---

## 9. Marca

Monocromática: preta sobre fundo claro, branca sobre fundo escuro. Fontes em
`assets/images/brand/` (`mark-black.png` / `mark-white.png`). Nunca colorir a marca nem colocá-la
sobre fundo de baixo contraste. O lockup horizontal fica em `assets/images/logo/` e não é usado
dentro do app.

Splash e overlay animado usam **o mesmo par cor de fundo + variante da marca** (`app.json` →
plugin `expo-splash-screen` e `src/components/animated-icon.tsx`), senão aparece um flash de cor
errada na transição.

## 10. Contagem anti-slop (mecânica, antes de dar qualquer tela como pronta)

Contar, não julgar:

- accents distintos na tela: **1**
- famílias de cinza: **1**
- raios fora da escala `Radius`: **0**
- emoji na chrome: **0**
- gradiente sem razão de marca: **0**
- rótulos diferentes para a mesma intenção: **0**
- blocos de destaque na tela (`HeroPanel` **ou** `GlassCard`): **1** (+ chrome)
- hex hardcoded: **0**
- `fontSize` solto: **0**

Contagem que falha é correção, não discussão.

**Três dessas linhas agora são teste, não vistoria:** `src/lib/anti-slop.test.ts` quebra o build em
hex, `rgba()` e `fontSize` soltos fora dos dois arquivos de token. A lição é a mesma do
`icon-map.test.ts`: contagem que depende de alguém medir volta a subir sozinha — esta já foi dada
como zerada duas vezes sem estar.

## 2b. A marca é monocromática — e é ela que faz o papel do accent

**A marca não tem cor, e isso é fato verificável, não estilo:** todos os assets são preto ou
branco puro — `mark-black.png`, `mark-white.png`, os dois lockups de `assets/images/logo/` e o
ícone Android. `tint` é **tinta** (quase-preto no claro, quase-branco no escuro). Isso muda como
as coisas se comunicam:

- **Ação primária lê por superfície**, não por matiz: pílula preenchida de `tint` com rótulo em
  `onTint` (que **inverte** com o tema). Secundário leva borda; ghost é texto puro ao lado do
  preenchido, como o par Cancelar/Salvar do iOS.
- **Link é sublinhado**, nunca colorido — accent da cor do texto não distingue nada.
- **Barra de progresso separa dado de estado**: `tone="data"` (cinza) para comparação —
  categoria, proporção; `tint` para estado que o usuário resolve — orçamento, meta. Barra de dado
  em preto sólido domina a lista e come o valor que estava do lado.
- **A forma da marca é o accent que sobrou.** A espiral trabalha como spinner (`Button loading`),
  glyph de estado vazio, marcador do que veio da IA e marca d'água do `HeroPanel` — geometria em
  `src/design/mark-path.ts`, componente em `src/components/ui/mark.tsx`, a MESMA fonte usada pela
  abertura. É o que dá personalidade sem cor; sem isso o app fica "iOS bem feito" de novo.
- **Cor semântica é a única cor da tela** e por isso grita mais do que gritaria num app colorido.
  Gastar `danger`/`success`/`warning` como decoração queima a última alavanca de cor que existe.

### O roxo foi testado e devolvido (30/08/2026)

O app lia como "iOS bem feito genérico" e a queixa era legítima. Foram prototipados **roxo como
`tint` inteiro** e **roxo só no `HeroPanel`**. Os dois ficaram bonitos. Os dois voltaram, por dois
motivos independentes:

**1. Medição.** Contando matiz por pixel no conteúdo da tela Hoje (abaixo do painel, acima da tab
bar):

| | pixels coloridos | famílias de matiz |
|---|---|---|
| tinta | 1,48% | 2 — vermelho 53%, laranja 47% |
| roxo como `tint` | 1,77% | 3 — vermelho 44%, laranja 39%, roxo 16% |

O accent colorido derrubava o vermelho do "estourou o orçamento" de 53% para 44% da cor da tela, e
ia parar em **ícone de linha e tag de categoria** — que não são ação nem estado. O accent mais
forte do app gasto em ornamento.

**2. Mercado.** Roxo, em finanças no Brasil, é o Nubank: o apelido da empresa é "roxinho", o ticker
é ROXO34 e eles atendem 61% da população adulta. Um bloco roxo com o saldo do mês tinha chance real
de ler como Nubank antes de ler como ProOps. **Se um dia a cor voltar, que não seja roxo.**

### A chatice era amplitude, não matiz

O diagnóstico certo estava na escada de superfícies do tema escuro: fundo `#000000`, card
`#1C1C1E`, painel `#141416` — **três superfícies dentro de 36/255**. Não havia hierarquia porque
não havia distância. A escada agora é explícita (a tabela mora em `constants/theme.ts`), e o elo
quebrado era card → painel, que valia 8 e passou a valer 16.

As duas outras alavancas, que são as que marcas sem cor usam:

- **Tipografia carrega o peso.** É a tese da Vercel — monocromática pura, "a tinta É a marca", e
  por isso a hierarquia sai de tamanho, peso e espaço. Aqui o token `Type.meta` (12/600,
  `letterSpacing 0.8`) existia e era usado em **um** lugar; três outros reimplementavam a mesma
  etiqueta à mão em peso 400 e tracking 0,6. Todo rótulo de seção do app sai de `Type.meta` agora.
- **A forma da marca, repetida.** Os cinco papéis da lista acima estavam em três. O estado vazio
  genérico e o marcador do que veio da IA passaram a usar a espiral — `EmptyState` sem `icon`
  desenha a marca, e `icon` fica para quando o símbolo carrega a CAUSA (lixeira, busca sem
  resultado). Contraponto útil: a Linear é quase-preta e gasta **um** accent pequeno e de alto
  contraste como lanterna, para sinalizar ação — nunca como superfície grande. Se um accent
  colorido voltar a este app, é esse o modelo, não um bloco.

---

## 11. Pronto significa

- [ ] Verificada **no simulador iOS e no emulador Android**, em light **e** dark
- [ ] Loading, empty, error e conteúdo longo desenhados — não caídos no default
- [ ] Fluxo gravado em vídeo e assistido: zero frame de cor errada, zero salto de layout
- [ ] Dynamic Type XL não quebra o layout
- [ ] Alvos de toque ≥ 44pt; `accessibilityLabel` em todo botão só-ícone
- [ ] Contagem anti-slop zerada
