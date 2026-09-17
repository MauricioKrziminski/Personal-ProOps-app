# Suave — Fase 4: Carteira (voo do cartão, carrossel, fatura ancorada)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tocar no cartão do Financeiro faz o cartão levantar, girar para em pé e pousar num
carrossel 3D (a Carteira); "Ver fatura" leva o cartão deitado até o topo da fatura, onde ele fica
ancorado com o total; fechar devolve o cartão à pilha.

**Architecture:** uma camada de voo na raiz (irmã do `<Stack>`, acima das telas) desenha um clone
do cartão enquanto a navegação acontece por rotas reais. Origens e destinos se registram por
chave (`useFlightAnchor`) e se escondem por chave (`useFlightHidden`). A face do cartão é UM
desenho deitado; "em pé" é esse desenho girado 90°, como no vídeo.

**Tech Stack:** Expo SDK 57, RN 0.86 (Fabric), Reanimated 4.5, Skia 2.6, RNGH, expo-router.

**Spec:** `docs/superpowers/specs/2026-09-16-concreto-redesign-design.md` (seções "Voo do cartão",
"Carteira", "Fatura", inventário da Regra 0), com a direção **Suave** do topo.

## Global Constraints

- Regra 0: nenhuma feature sai de tela nem muda de nicho. Inventário abaixo.
- Commits de uma linha, conventional, **sem co-autor**. Sem tag. Nada em produção.
- `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída) antes de cada commit.
- Toda cor via tema (zero hex fora de `theme.ts`/`card-brands.ts`), zero `fontSize` solto.
- Verificar no simulador iOS e no emulador Android antes de dar a tarefa por pronta.
- Reduce Motion: sem voo (a troca nativa em fade basta), carrossel sem giro, doca sem virar.

## Emendas à spec (decididas no início da fase)

1. **A Carteira é um `push` com `animation: 'fade'`, não `transparentModal`.** No iOS o
   `transparentModal` é um view controller APRESENTADO, desenhado acima da raiz React inteira —
   a camada de voo ficaria por baixo dele (é a mesma classe do toast atrás do `Modal`, §6 do
   design). E no `react-native-screens` toda tela empilhada depois de um modal vira modal: a
   fatura aberta da Carteira perderia o header nativo. Com `push` + `fade` a Financeiro
   esmaece por baixo do cartão que levanta (é o vídeo), a fatura é um `push` comum e a camada
   fica acima das duas. Custo: o arraste para fechar não esmaece o FUNDO (atrás de um `push`
   não há tela desenhada no iOS) — esmaece o conteúdo da Carteira e o cartão encolhe.
2. **Em pé = deitado girado 90° no sentido horário.** O desenho é um só; no vídeo o "VISA" do
   cartão em pé está de lado pelo mesmo motivo.
3. **A face escala a partir de uma largura de desenho (340).** O clone é desenhado nessa
   largura e o voo só aplica `scale`: origem e destino ficam idênticos ao clone em qualquer
   tamanho, sem salto no pouso.
4. **Proporção da face = 1,586 ÷ √fontScale** (nunca menor que 1). O cartão continua crescendo
   com a fonte do sistema (§1 do design) e origem e destino mantêm a MESMA proporção, então o
   voo continua sendo escala uniforme.
5. **O chip EMV sai da face.** Não existe nos vídeos, e o §1 do design (anatomia com chip) é da
   direção anterior — será reescrito na Fase 6. Ficam: nome, "Atrasada", contactless, fatura
   atual, botão "fecha em ›", barra de limite, vence e disponível.
6. **A face é metal na cor do emissor, com tinta escolhida por luminância** (escura sobre
   amarelo do BB, clara sobre o roxo do Nubank). Monocromática por dentro: sem verde no
   disponível, sem vermelho no "Atrasada" (a PALAVRA e o ícone dizem o estado).
7. **Giro do carrossel no meio da troca** (seno do deslocamento, pico de 50°); vizinhos em
   repouso planos, escala 0,86, opacidade 0,6. É o que o vídeo faz.

## Inventário da Regra 0

| tela | continua | muda |
|---|---|---|
| Financeiro — Cartões | "Cartões" + "Ver todos"; linha "Fatura do X" (abre a fatura); escolha do cartão da frente gravada; botão da fatura na face | tocar na pilha abre a Carteira; o leque e a alça ▾/▴ saem (trocar de cartão é deslizar na Carteira) |
| Carteira (nova) | — | ver fatura (ou ver cartões), faturas anteriores do cartão, todos os cartões; fatura atual, fecha, vence, limite, disponível, atraso |
| Fatura | pager (setas), menu "…", status, nome do cartão, contagem, total, fecha · vence, "Inclui X com data à frente", "Paga em", "Pago X · falta Y", lista por dia, rodapé com as três ações e legendas, sheet de pagamento | o card de total vira a face ancorada; as três linhas extras ficam logo abaixo dela; deslizar a face troca de fatura |
| Cartões | total a pagar, ordem por urgência, faixa de atraso, detalhes e "Paguei", "Faturas anteriores", vazio, `+` | miniatura do cartão no cabeçalho de cada bloco; tocar nela abre a Carteira |

---

### Task 1: Prova da camada (spike)

**Files:** Create `src/components/motion/flight-layer.tsx` (esqueleto), `src/app/finance/wallet.tsx`
(tela provisória); Modify `src/app/_layout.tsx`.

- [ ] Camada `absoluteFill`, `pointerEvents="none"`, `zIndex`/`elevation` 800, montada DEPOIS
      do `<Stack>`; desenha um quadrado vermelho 100×100 enquanto um estado de teste está ligado.
- [ ] Rota `finance/wallet` com `headerShown: false`, `animation: 'fade'`,
      `gestureEnabled: false` (iOS); botão no catálogo liga o quadrado e dá `push`.
- [ ] Ver nos dois aparelhos: o quadrado fica ACIMA da Carteira e a tela de baixo esmaece.
- [ ] Remover o quadrado (não commitar o spike).

### Task 2: Matemática pura

**Files:** Create `src/design/card-geometry.ts`, `src/design/flight-math.ts`,
`src/design/carousel-math.ts` e os três `.test.ts`; Modify `src/design/card-brands.ts` (+ teste).

**Interfaces (produzidas):**

```ts
// card-geometry.ts
export const PROPORCAO_DO_CARTAO = 1.586;
export const LARGURA_DE_DESENHO = 340;
export function proporcaoDoCartao(fontScale: number): number; // largura ÷ altura
export function alturaDoCartao(largura: number, fontScale: number): number;

// flight-math.ts
export type Caixa = { x: number; y: number; largura: number; altura: number };
export type Pose = 'deitado' | 'em-pe';
export type Quadro = { cx: number; cy: number; lado: number; giro: number };
export function quadroDaCaixa(c: Caixa, pose: Pose): Quadro;          // lado = lado longo
export function quadroNoVoo(p: number, de: Quadro, para: Quadro): Quadro; // arco + 6% no meio
export function caixaArrastada(c: Caixa, dy: number, escala: number): Caixa;

// carousel-math.ts
export function indiceNoDeslocamento(x: number, passo: number, total: number): number;
export function distanciaDoItem(x: number, passo: number, indice: number): number;
export function quadroDoItem(d: number, reduzir: boolean): { giroY: number; escala: number; opacidade: number };

// card-brands.ts
export function tintaDoCartao(hex: string): 'escura' | 'clara'; // a de maior contraste
export function clarear(hex: string, peso: number): string;     // blend com branco
export function escurecer(hex: string, peso: number): string;   // blend com preto
```

- [ ] Testes: t=0 e t=1 batem com as caixas; giro 0→90; `lado` de uma caixa em pé é a altura;
      arco nulo nas pontas; índice arredonda e prende nas pontas; `quadroDoItem(0)` é identidade,
      `quadroDoItem(±1)` dá escala 0,86 / opacidade 0,6 / giro 0; reduzir zera o giro;
      proporção cai com a fonte e nunca sobe acima de 1,586; tinta escura no amarelo do BB e
      clara no roxo do Nubank e no neutro.
- [ ] `npm test` verde → commit `feat(motion): matemática do voo e do carrossel`.

### Task 3: Face do cartão

**Files:** Create `src/components/finance/card-face.tsx`; Modify `src/constants/theme.ts`
(tokens de tinta escura do cartão), `src/design/contrast.test.ts`, `src/app/catalog.tsx`.

- `CardFace({ nome, largura, atrasada?, children? })`: caixa `largura × alturaDoCartao`, canto
  `Radius.md`, Skia `LinearGradient` (clarear → marca → escurecer) + faixa de brilho diagonal;
  conteúdo desenhado em `LARGURA_DE_DESENHO` e escalado (`transformOrigin` no canto).
  Topo: nome (+ pílula "Atrasada") e contactless. `children` é a base (cada tela decide).
- `useTintaDoCartao(nome)` → `{ tinta, suave, chip }` em nomes de token (`onHero*`/`heroChip`
  para a clara; `onCardInk`, `onCardInkMuted`, `cardInkChip` — novos, iguais nos dois temas —
  para a escura).
- `BaseDaPilha({ card, onFatura })`: fatura atual, "fecha em dd/mm ›" (botão), barra de limite,
  vence e disponível.
- Vitrine no catálogo com os emissores do mapa + neutro.
- [ ] tsc/lint/test; olhar o catálogo claro/escuro nos dois aparelhos → commit
      `feat(finance): face do cartão em metal da cor do emissor`.

### Task 4: Camada de voo

**Files:** `src/components/motion/flight-layer.tsx` (real), `_layout.tsx`.

```ts
type Voo = {
  de: string | Caixa;            // chave de âncora ou caixa já medida
  poseDe: Pose;
  para: string;                  // chave de âncora do pouso
  posePara: Pose;
  ocultar: string[];             // chaves escondidas durante o voo
  desenho: (progresso: SharedValue<number>) => React.ReactNode; // deitado, LARGURA_DE_DESENHO
};
useFlight(): { voar(v: Voo): void; temAncora(chave: string): boolean };
useFlightAnchor(chave: string | undefined): { ref; onLayout };  // registra depois do 1º layout
useFlightHidden(chave: string | undefined): AnimatedStyle;      // opacidade 0 enquanto oculto
```

- Mede a origem na hora (`measureInWindow` é síncrono no Fabric), esconde `ocultar`, monta o
  clone levantando (escala 1,03 em 160 ms), espera a âncora do pouso até 900 ms, voa com
  `Motion.spring.voo`; no fim mostra o pouso NA UI thread e desmonta o clone em seguida (um
  quadro com os dois é invisível; o contrário piscaria). Sem pouso: encolhe e esmaece no lugar.
- Subtrai o `measureInWindow` da própria camada (Android com barra translúcida).
- Um voo por vez; Reduce Motion não voa.
- [ ] commit junto da Task 5 (sem consumidor não há o que ver).

### Task 5: Pilha do Financeiro

**Files:** Create `src/hooks/use-cartao-escolhido.ts`; Modify
`src/components/finance/card-stack.tsx`, `src/app/(tabs)/finance/index.tsx`.

- Escolha gravada (cache de módulo + AsyncStorage, mesma chave `card-stack-front`) atrás de
  `useSyncExternalStore`, para a pilha montada por baixo da Carteira reordenar sozinha.
- Pilha sempre fechada: frente embaixo, até 5 atrás espiando por cima (estreitas por `scaleX`);
  reordena com `Motion.spring.encaixe`. O palco inteiro é um botão que abre a Carteira pelo
  cartão da frente (âncora `pilha`, oculto `pilha:<id>`); o "fecha em ›" continua abrindo a
  fatura. `onFrontChange` continua.
- [ ] tsc/lint/test → commit `feat(finance): pilha abre a carteira com o cartão voando`.

### Task 6: Carteira

**Files:** Create `src/components/finance/wallet-carousel.tsx`; Modify `src/app/finance/wallet.tsx`,
`src/hooks/use-finance.ts` (`invoiceQuery` exportado para pré-carregar a fatura).

- `useCardSummary()` (mesma chave do Financeiro), `card=` e `origem=` nos parâmetros.
- `TaskHeader` "Carteira" com ✕; nome do cartão grande com paralaxe e estado embaixo
  ("Fatura aberta · fecha 03/10", "Atrasada" em `danger`).
- Carrossel: `Animated.ScrollView` horizontal, `snapToInterval`, `decelerationRate="fast"`,
  `disableIntervalMomentum`, `perspective` primeiro no transform, `overflow: 'visible'`;
  moldura central fixa é a âncora `vitrine`; cada item se esconde por `vitrine:<id>`;
  háptico de seleção na troca; troca grava a escolha e pré-carrega a fatura.
- Indicador: pontos de 6, o ativo vira barra de 20 em `tintFill`.
- Números: fatura atual (`CountUpMoney` tom `text`), vence, barra de limite + usado/livre,
  faixa de atraso (abre a mais antiga).
- Ações no fim (`flexGrow` + `marginTop: 'auto'`): "Ver fatura" (ou "Ver cartões"),
  "Faturas anteriores" (`/finance/invoices?account=`), "Todos os cartões".
- Fechar: ✕ e voltar do Android caem no mesmo `beforeRemove`, que lança o voo de volta
  (`pilha` ou `miniatura:<id>`) enquanto a tela sai; arraste para baixo no carrossel
  (`activeOffsetY`/`failOffsetX`) encolhe o cartão e esmaece o conteúdo; solto além de 120 pt
  ou rápido, fecha a partir da caixa arrastada. Desligado quando a página precisa rolar.
- Erro: `ErrorCard`; sem cartões: `EmptyState` "Cadastrar cartão".
- [ ] tsc/lint/test; aparelhos → commit `feat(finance): carteira com carrossel 3D`.

### Task 7: Fatura ancorada

**Files:** Create `src/components/finance/invoice-dock.tsx`; Modify
`src/app/finance/invoice/[id].tsx`, `src/app/_layout.tsx`, `src/lib/simple-finance-ui.test.ts`.

- `InvoiceDock({ nome, status, contagem, totalCents, fecha, vence, faturas, atualId, onChange, children })`:
  a face na largura do conteúdo (âncora e oculto `doca`), base com status · contagem, total
  (`CountUpMoney`), fecha · vence; `children` (as três linhas extras) logo abaixo. Deslizar
  troca de fatura pelo mesmo `onChange` das setas; a face vira no eixo Y na troca.
- `options` da fatura como função da rota: `animation: 'fade'` quando `via=carteira`.
- "Ver fatura" na Carteira voa `vitrine → doca` desenhando a base da doca com a fatura
  pré-carregada (sem ela, só a casca).
- Teste: a doca recebe status, contagem, total, fecha e vence; as linhas extras são filhas dela.
- [ ] tsc/lint/test; aparelhos → commit `feat(finance): fatura com o cartão ancorado`.

### Task 8: Miniaturas em Cartões

**Files:** Modify `src/app/finance/cards.tsx`.

- Miniatura (face de 56) no cabeçalho de cada bloco, botão próprio que voa para a Carteira
  (âncora e oculto `miniatura:<id>`, `origem=miniatura`). O card continua abrindo a fatura.
- [ ] commit `feat(finance): miniatura do cartão abre a carteira`.

### Task 9: Verificação cruzada

- [ ] iOS e Android, claro e escuro: pilha → Carteira → troca → fechar (✕, voltar, arraste);
      Carteira → fatura → voltar; miniatura → Carteira → fechar; deslizar a doca.
- [ ] 384dp × fonte 1,3 (Android) e Dynamic Type grande (iOS): face sem corte, Carteira rola.
- [ ] Reduce Motion / `animator_duration_scale 0`: sem voo, sem giro, nada preso escondido.
- [ ] Vídeo de ida e volta conferido quadro a quadro; `dumpsys gfxinfo` no carrossel.
- [ ] Spec: registrar as emendas acima na seção da Carteira.
