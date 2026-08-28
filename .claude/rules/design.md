# Design — fidelidade nativa iOS 26 / Material 3 (obrigatório)

O app senta na tela ao lado do Apple Wallet e do Things. É assim que ele é julgado, em segundos.
Nenhuma tela é entregue "crua", e nenhuma tela é entregue "quase nativa".

**Uma frase:** *o app é o lugar calmo onde o que o usuário jogou no WhatsApp aparece organizado —
e onde ele decide o que fazer com isso.*

---

## 1. Superfícies — glass é destaque, não papel de parede

- **Glass fica na chrome**: tab bar nativa (`NativeTabs`), header, sheet e FAB.
- **Mais um único card de destaque por tela** — o card que responde a pergunta principal daquela
  tela (sobra do mês, patrimônio líquido, total da fatura, progresso da meta).
- **Todo o resto é opaco.** Card de lista, linha, formulário: superfície sólida, hierarquia por
  **elevação e espaço**, nunca por blur.

> Dois `GlassCard` na mesma tela é erro de revisão, não questão de gosto.

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

Dark mode é automático (`userInterfaceStyle: automatic`) e **não é opcional na verificação**.

---

## 3. Tipografia

Ramp da plataforma, **uma display por tela**. `Fonts.rounded` só em dinheiro em destaque.

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

- **Header é do navegador.** `<Stack.Title>` + large title com colapso no scroll. Nada de barra
  desenhada à mão dentro do `ScrollView`.
- **Busca é nativa** — `<Stack.SearchBar>`.
- **Ação de header tem um caminho só**: `HeaderActions` (botões) e `HeaderMenu` (menu "…"), em
  `src/components/ui/header-actions.tsx`. **Nunca montar `headerRight` à mão.** No iOS 26 o header
  desenha uma pílula de vidro em volta do conteúdo do `headerRight`: entregar uma `View` própria
  faz o respiro interno ser o nosso `gap`, e cada tela escolhia um — foi assim que a pílula ficou
  com padding e raio diferentes entre telas. O primitivo usa `Stack.Toolbar` no iOS (o sistema
  resolve pílula, espaçamento e large title) e `headerRight` no Android, onde o toolbar nativo
  reclama o slot sem desenhar nada.
- **Presentation é significado**: tarefa com etapas → `modal` com Cancelar/Salvar próprios;
  escolha curta → `formSheet` com detents; confirmação destrutiva → action sheet; ação de item →
  context menu nativo.
- **Porta de mão única** (login, onboarding concluído, compra) sai da pilha com `Stack.Protected`
  + `replace` — voltar nunca reentra no estado antigo.
- **Abas são pares.** Nada de slide entre abas; re-tap na aba ativa volta à raiz.

---

## 9. Marca

Monocromática: preta sobre fundo claro, branca sobre fundo escuro. Fontes em
`assets/images/brand/` (`mark-black.png` / `mark-white.png`). Nunca colorir a marca nem colocá-la
sobre fundo de baixo contraste. O lockup horizontal fica em `assets/images/logo/` e não é usado
dentro do app.

Splash e overlay animado usam **o mesmo par cor de fundo + variante da marca** (`app.json` →
plugin `expo-splash-screen` e `src/components/animated-icon.tsx`), senão aparece um flash de cor
errada na transição.

---

## 10. Contagem anti-slop (mecânica, antes de dar qualquer tela como pronta)

Contar, não julgar:

- accents distintos na tela: **1**
- famílias de cinza: **1**
- raios fora da escala `Radius`: **0**
- emoji na chrome: **0**
- gradiente sem razão de marca: **0**
- rótulos diferentes para a mesma intenção: **0**
- `GlassCard` na tela: **1 de destaque** (+ chrome)
- hex hardcoded: **0**
- `fontSize` solto: **0**

Contagem que falha é correção, não discussão.

---

## 11. Pronto significa

- [ ] Verificada **no simulador iOS e no emulador Android**, em light **e** dark
- [ ] Loading, empty, error e conteúdo longo desenhados — não caídos no default
- [ ] Fluxo gravado em vídeo e assistido: zero frame de cor errada, zero salto de layout
- [ ] Dynamic Type XL não quebra o layout
- [ ] Alvos de toque ≥ 44pt; `accessibilityLabel` em todo botão só-ícone
- [ ] Contagem anti-slop zerada
