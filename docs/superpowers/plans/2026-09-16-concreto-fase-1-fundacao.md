# Concreto — Fase 1: Fundação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar a identidade do app para o mundo Concreto (paleta, fontes, raio, movimento) e
entregar os primitivos de movimento que as fases seguintes usam, sem mover nem tirar feature
nenhuma de tela.

**Architecture:** os tokens mantêm os nomes de papel, então as ~60 telas herdam os valores novos.
Os primitivos de movimento (`TileField`, `PressableScale`, `Reveal`, `SplitReveal`,
`TileSpinner`) moram em `src/components/motion/`; a geometria deles é pura e testada em
`node --test`. Os primitivos de UI existentes são redesenhados no lugar.

**Tech Stack:** Expo SDK 57, React Native 0.86, Reanimated 4.5, Skia 2.6 (`Atlas`),
`@expo-google-fonts/jost`, `@expo-google-fonts/martian-mono`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-concreto-redesign-design.md`

## Global Constraints

- Regra 0: nenhuma feature sai de tela nem muda de lugar; só pele e movimento.
- Cor só via `useTheme()`; cor nova com par claro E escuro em `src/constants/theme.ts`.
- Zero `fontSize` solto fora de `src/design/tokens.ts`; peso é família (`Fonts.*`), nunca `fontWeight`.
- `backgroundColor` com azul é `theme.tintFill` (com rótulo `onTint`); `theme.tint` é texto, ícone e progresso.
- Animação só em worklet, só `transform`/`opacity` (ou matriz/buffer do Skia).
- Reduce Motion: movimento espacial vira opacidade.
- `ThemedText` dentro de contêiner com `entering` leva `flexShrink: 0` quando é identificador.
- Commit: uma linha, conventional, **sem** `Co-Authored-By`. Sem tag, sem produção.
- Portão por tarefa: `npx tsc --noEmit`, `npx expo lint`, `npm test` (olhar o código de saída).

## Emendas feitas durante a execução (16/09/2026)

As tarefas abaixo descrevem o plano ORIGINAL. Onde o código entregue diverge, vale esta seção.

**Pedidas pelo dono do produto no meio da fase** — *"o botão pode deixar mais bonito, os
gráficos também, os inputs de texto e valor mais bonitos e animados, o segmentado também, e
usar o diagonal sem friso ou o friso bem menor no canto"*:

| era (Task) | ficou |
|---|---|
| friso em degraus no pé da tela (3, 4: `friezeDepth`, `frieze`, `friezeHeight`) | **removido**. No lugar, um aglomerado no CANTO superior direito: `cornerKeep(col, row, cols, k)` em `tile-math.ts` e `corner` + `cornerSize(width, k)` em `TileField`. O motivo dos azulejos do canto (share 0,66) só aparece entre 0,55 e 0,95 do progresso, com um quarto de volta |
| botão pílula com escala (5) | **tecla**: base (`tintDeep` / `keyBase` / `dangerDeep`) + face que afunda `depth` (sm 2, md 3, lg 4) no toque, rótulo que rola numa janela recortada (340 ms), `TileSpinner` no carregamento. Tokens novos `keyFace`, `keyBase`, `tintDeep`, `dangerDeep` |
| `Field` só com a pele nova (7) | `Field` com contexto de foco: rótulo e marcador de azulejo acendem, régua `tintFill` de 2px cresce da esquerda, tremida quando `invalid` liga. `MoneyField` com dígitos que rolam (odômetro) e cursor piscante |
| `Segmented` com indicador em mola (7) | bloco de tinta que ESTICA (borda da frente 300 ms, de trás 520 ms) e rótulo com cor interpolada pela distância. O rótulo encolhe até caber (`adjustsFontSizeToFit`, piso 0,7) — "Transferência" partia a palavra em 384dp × 1,3 |
| gráficos só recoloridos (7) | `Sparkline` desenha da esquerda, hachura na área, zero pontilhado, futuro tracejado e alfinete em losango com um pulso. `ProgressBar` em 10 peças que encaixam em mola |

**Achados no Android, todos medidos no emulador:**

- **As telas só montam depois das fontes** (`_layout.tsx`): texto medido antes de a Jost
  carregar fica com a largura da fonte do sistema para sempre ("Trocar o valor" → "Trocar o").
  O `caption` passou para `Fonts.semibold` pelo mesmo caminho.
- **Atraso dentro do relógio, não `withDelay`**, na primeira montagem (`SplitReveal`).
- **`exiting` não termina** — o odômetro do `MoneyField` usa espaços fixos, sem animação de
  layout. Texto do `TextInput` de captura escondido por `opacity: 0.01`, não `color: 'transparent'`.
- **A fonte dos símbolos é pré-carregada** no `useFonts` raiz: o `expo-symbols` carregava por
  ícone e os ícones chegavam depois da tela.
- **A `TextView` do Android 15+ quebra linha pela TINTA do glifo; o RN mede pelo avanço**
  (`plugins/with-text-advance-width.js`). O gancho do "j" da Jost fazia "já aconteceu" virar
  "já". Plugin de config nativo → exige build nativo novo e, no release, `version` novo (a
  política de runtime é `appVersion`).

---

## Mapa de arquivos

| arquivo | ação | responsabilidade |
|---|---|---|
| `package.json` | modificar | + jost, + martian-mono; − hanken-grotesk, − jetbrains-mono |
| `src/constants/theme.ts` | modificar | paleta Concreto, `tintFill`, `cardFace`, `tileInk`, `tileMotif`, `tilePaper`, `Fonts` Jost/Martian |
| `src/app/_layout.tsx` | modificar | `useFonts` com as faces novas |
| `src/design/tokens.ts` | modificar | `Radius`, `Type` (+`display`), `Motion` (+`encaixe`, `voo`, `curtain`), `pressScale` |
| `src/design/contrast.ts` + `.test.ts` | criar | WCAG e a verificação dos pares da paleta lidos do `theme.ts` |
| `src/design/tile-math.ts` + `.test.ts` | criar | grade, semente, peça, ordem da onda, fase, poses, friso |
| `src/components/motion/tile-field.tsx` | criar | campo de azulejos em Skia `Atlas` |
| `src/components/motion/tile-spinner.tsx` | criar | azulejo que gira em passos de 90° (loader) |
| `src/components/motion/pressable-scale.tsx` | criar | press-in com escala |
| `src/components/motion/reveal.tsx` | criar | `Reveal` (entrada com atraso escalonado) |
| `src/components/motion/split-reveal.tsx` | criar | texto que sobe da máscara letra a letra |
| `src/components/themed-text.tsx` | modificar | tipo `display` |
| `src/components/ui/button.tsx` | modificar | retângulo, `tintFill`, morph para quadrado com `TileSpinner` |
| `src/components/ui/card.tsx`, `row.tsx` | modificar | chapado, fio de 1px, chip de ícone quadrado |
| `src/components/ui/field.tsx` | modificar | borda de 2px animada no foco |
| `src/components/ui/segmented.tsx` | modificar | indicador-azulejo em tinta |
| `src/components/ui/hero-panel.tsx`, `quick-actions.tsx` | modificar | bloco invertido chapado |
| `src/components/ui/sparkline.tsx` | modificar | área e traço sem gradiente |
| `src/components/ui/toast.tsx`, `empty-state.tsx`, `app-header.tsx`, `skeleton.tsx` | modificar | ver tarefas |
| telas com `backgroundColor: theme.tint` | modificar | trocar por `tintFill` |
| `src/app/(tabs)/profile/index.tsx` | modificar | herói sem `GradientSurface` |
| `src/app/catalog.tsx` | modificar | vitrine dos primitivos novos |
| `src/lib/anti-slop.test.ts` | modificar | fontes antigas, `tint` como fundo |

---

### Task 0: Linha de base nos dois aparelhos

Sem isso não há como afirmar "sem regressão".

- [ ] **Step 1:** subir o emulador Android e o Metro

```bash
~/Library/Android/sdk/emulator/emulator -avd s26 -no-snapshot-save >/dev/null 2>&1 &
npx expo start --dev-client --port 8081   # em background
```

- [ ] **Step 2:** abrir o app nos dois (`xcrun simctl launch booted com.proops.personal`;
  no Android, `adb shell am start -n com.proops.personal.dev/.MainActivity` se o pacote `.dev`
  estiver instalado, senão `npx expo run:android`), entrar com "Entrar como teste (dev)".
- [ ] **Step 3:** capturar, claro e escuro, as 5 raízes (rolando), Lançamentos, uma Fatura,
  Cartões, Contas, o formulário de lançamento e o login, em
  `scratchpad/baseline/{ios,android}/<tela>-<tema>.png`. Anotar, por tela, a lista de ações
  visíveis (é o inventário da Regra 0).

### Task 1: Fontes Jost + Martian Mono

**Files:** `package.json`, `src/constants/theme.ts` (`Fonts`), `src/app/_layout.tsx`,
`src/lib/anti-slop.test.ts`

**Interfaces:** Produces `Fonts.{regular,italic,medium,semibold,bold,semiboldItalic,boldItalic,mono,monoMedium,monoSemibold}` com nomes Jost/Martian.

- [ ] **Step 1: teste que falha** — em `anti-slop.test.ts`:

```ts
test('nenhuma face do tipo antigo sobrou', () => {
  assert.deepEqual(
    offenders(/HankenGrotesk|JetBrainsMono|hanken-grotesk|jetbrains-mono/),
    [],
    'o tipo do app é Jost + Martian Mono (spec Concreto)'
  );
});

test('toda face de Fonts é carregada no useFonts da raiz', () => {
  const theme = readFileSync(join(SRC, 'constants', 'theme.ts'), 'utf8');
  const layout = readFileSync(join(SRC, 'app', '_layout.tsx'), 'utf8');
  const bloco = theme.slice(theme.indexOf('export const Fonts'), theme.indexOf('} as const', theme.indexOf('export const Fonts')));
  const faces = [...bloco.matchAll(/:\s*'([A-Za-z]+_\d{3}[A-Za-z_]*)'/g)].map((m) => m[1]);
  assert.ok(faces.length >= 10);
  for (const face of faces) assert.ok(layout.includes(face), `${face} não é carregada em _layout.tsx`);
});
```

- [ ] **Step 2:** `npm test` → FAIL (nomes antigos presentes).
- [ ] **Step 3:** `npx expo install @expo-google-fonts/jost @expo-google-fonts/martian-mono`;
  `Fonts` passa a:

```ts
export const Fonts = {
  regular: 'Jost_400Regular',
  italic: 'Jost_400Regular_Italic',
  medium: 'Jost_500Medium',
  semibold: 'Jost_600SemiBold',
  bold: 'Jost_700Bold',
  semiboldItalic: 'Jost_600SemiBold_Italic',
  boldItalic: 'Jost_700Bold_Italic',
  mono: 'MartianMono_400Regular',
  monoMedium: 'MartianMono_500Medium',
  monoSemibold: 'MartianMono_600SemiBold',
} as const;
```

  e o `useFonts` do `_layout.tsx` importa exatamente essas dez faces de
  `@expo-google-fonts/jost` / `@expo-google-fonts/martian-mono`. Comentários que citam as faces
  antigas passam a descrever as novas.
- [ ] **Step 4:** `npm uninstall @expo-google-fonts/hanken-grotesk @expo-google-fonts/jetbrains-mono`;
  `npm test` → PASS; `npx tsc --noEmit` limpo.
- [ ] **Step 5:** commit `feat(design): tipografia Jost + Martian Mono`

### Task 2: Paleta Concreto e tokens

**Files:** `src/constants/theme.ts`, `src/design/tokens.ts`, `src/components/themed-text.tsx`,
`src/design/contrast.ts`, `src/design/contrast.test.ts`, telas com `theme.tint` de fundo,
`src/lib/anti-slop.test.ts`

**Interfaces:** Produces `ThemeColor` com `tintFill`, `cardFace`, `tileInk`, `tileMotif`,
`tilePaper`; `Type.display`; `Motion.spring.encaixe`, `Motion.spring.voo`,
`Motion.curtain = { duration: 900, overlap: 0.6, short: 600, full: 1800 }`,
`Motion.pressScale = 0.96`; `ThemedText type="display"`.

- [ ] **Step 1: teste que falha** — `src/design/contrast.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contrast } from './contrast.ts';

const theme = readFileSync(join(import.meta.dirname, '..', 'constants', 'theme.ts'), 'utf8');

/** Lê `papel: '#RRGGBB'` do bloco `light:` ou `dark:` de `Colors`. */
function paleta(modo: 'light' | 'dark'): Record<string, string> {
  const ini = theme.indexOf(`  ${modo}: {`);
  const fim = theme.indexOf('\n  },', ini);
  const bloco = theme.slice(ini, fim);
  return Object.fromEntries([...bloco.matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]]));
}

const PARES: [string, string, number][] = [
  ['text', 'background', 7],
  ['text', 'surface', 7],
  ['textSecondary', 'background', 4.5],
  ['textSecondary', 'surface', 4.5],
  ['tint', 'background', 4.5],
  ['tint', 'surface', 4.5],
  ['onTint', 'tintFill', 4.5],
  ['danger', 'background', 4.5],
  ['success', 'background', 4.5],
  ['warning', 'background', 4.5],
  ['onHero', 'heroSurface', 7],
  ['onHeroDanger', 'heroSurface', 4.5],
  ['onHeroSuccess', 'heroSurface', 4.5],
  ['onHeroWarning', 'heroSurface', 4.5],
];

for (const modo of ['light', 'dark'] as const) {
  test(`contraste da paleta ${modo}`, () => {
    const p = paleta(modo);
    for (const [a, b, min] of PARES) {
      assert.ok(p[a] && p[b], `${modo}: ${a} ou ${b} ausente ou não é hex`);
      const c = contrast(p[a], p[b]);
      assert.ok(c >= min, `${modo}: ${a} sobre ${b} = ${c.toFixed(2)} (mínimo ${min})`);
    }
  });
}

test('contrast() confere com a referência WCAG', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(Math.round(contrast('#777777', '#FFFFFF') * 100) / 100, 4.48);
});
```

  e em `anti-slop.test.ts`:

```ts
test('azul como FUNDO é tintFill, nunca tint', () => {
  assert.deepEqual(
    offenders(/backgroundColor:[^,}\n]*theme\.tint\b/),
    [],
    'fundo azul usa theme.tintFill (rótulo onTint); theme.tint é texto, ícone e progresso'
  );
});
```

- [ ] **Step 2:** `npm test` → FAIL (`contrast.ts` não existe).
- [ ] **Step 3: implementar** `src/design/contrast.ts`:

```ts
/** Contraste WCAG 2.x entre duas cores `#RRGGBB`. Puro, para `node --test`. */
function luminancia(hex: string): number {
  const h = hex.replace('#', '');
  const canal = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
```

  Em `theme.ts`, os blocos `light`/`dark` recebem os valores da tabela "Cor" da spec, mais:

```ts
// light
tintFill: '#2A45F0', cardFace: '#141413', tileInk: '#0D0D0C', tileMotif: '#2A45F0', tilePaper: '#F2F3F1',
heroTop: '#0D0D0C', heroBottom: '#0D0D0C', // aliases de heroSurface até a Fase 4 remover os usos
// dark
tintFill: '#4B63FF', cardFace: '#141413', tileInk: '#0D0D0C', tileMotif: '#4B63FF', tilePaper: '#F2F3F1',
heroTop: '#F2F3F1', heroBottom: '#F2F3F1',
```

  `auroraDeep/Glow/Lift` ficam com valores neutros até a Fase 2 remover a aurora
  (`rgba(13,13,12,0.06)`, `rgba(42,69,240,0.18)`, `rgba(242,243,241,0.9)` no claro;
  `rgba(242,243,241,0.05)`, `rgba(75,99,255,0.18)`, `rgba(242,243,241,0.04)` no escuro).
  O comentário de `Colors` é reescrito para o Concreto (herói = negativo da página; um azul só,
  em dois tokens; semânticas só como semântica).

  Em `tokens.ts`:

```ts
export const Radius = { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, pill: 999 } as const;
```

```ts
spring: {
  sheet: { duration: 300, dampingRatio: 0.8 },
  settle: { duration: 400, dampingRatio: 1 },
  snap: { duration: 340, dampingRatio: 0.78 },
  tab: { duration: 1000, dampingRatio: 0.62 },
  /** Assentar no grid: chega firme, sem quicar. */
  encaixe: { duration: 420, dampingRatio: 0.86 },
  /** O cartão atravessando telas. */
  voo: { duration: 620, dampingRatio: 0.9 },
},
/** A onda de azulejos: duração, sobreposição das janelas e as duas versões da abertura. */
curtain: { duration: 900, overlap: 0.6, short: 600, full: 1800 },
stagger: { step: 30, cap: 400 },
pressScale: 0.96,
```

```ts
export const Type = {
  display: { fontFamily: Fonts.semibold, fontSize: 52, lineHeight: 50, letterSpacing: -2 },
  largeTitle: { fontFamily: Fonts.semibold, fontSize: 34, lineHeight: 38, letterSpacing: -1 },
  title: { fontFamily: Fonts.semibold, fontSize: 26, lineHeight: 30, letterSpacing: -0.6 },
  title2: { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  headline: { fontFamily: Fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: Fonts.regular, fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  callout: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 20, letterSpacing: 0 },
  subhead: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 20, letterSpacing: 0 },
  footnote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 15, letterSpacing: 0.2 },
  money: { fontFamily: Fonts.semibold, fontSize: 32, lineHeight: 36, letterSpacing: -0.8 },
  heroMoney: { fontFamily: Fonts.semibold, fontSize: 48, lineHeight: 50, letterSpacing: -1.6 },
  meta: { fontFamily: Fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.6 },
  code: { fontFamily: Fonts.monoMedium, fontSize: 12, lineHeight: 16, letterSpacing: -0.2 },
  ticker: { fontFamily: Fonts.monoMedium, fontSize: 13, lineHeight: 18, letterSpacing: -0.3 },
} as const;
```

  `ThemedText` ganha `'display'` na união e `display: Type.display` nos estilos.
  Trocar `theme.tint` por `theme.tintFill` em todo **fundo** (lista de
  `grep -rn "backgroundColor:[^,}]*theme\.tint\b" src`) e nas props de cor de barra
  (`BarTrack color={... theme.tint ...}` em `invoices.tsx`, `installments.tsx`, `catalog.tsx`).
- [ ] **Step 4:** `npm test` → PASS; `npx tsc --noEmit`; `npx expo lint`.
- [ ] **Step 5:** commit `feat(design): paleta Concreto e tokens de forma e movimento`

### Task 3: Geometria dos azulejos (`tile-math`)

**Files:** criar `src/design/tile-math.ts`, `src/design/tile-math.test.ts`

**Interfaces:** Produces:
`tileGrid(width, height, target?) → { cols, rows, size, count }`;
`seeded(i, seed) → number ∈ [0,1)`; `tilePiece(i, seed) → 0|1|2|3`;
`tileTurns(i, seed) → 0|1|2|3`;
`waveOrder(col, row, cols, rows, mode, ox?, oy?, seed?) → [0,1]` com
`mode: 'diagonal'|'radial'|'up'|'down'`;
`tilePhase(progress, order, overlap?) → [0,1]`;
`inkPose(t) → { scale, angle }`; `motifPose(t) → { scale, angle }`;
`friezeDepth(col, cols, depth, seed) → inteiro`; `patterned(i, seed) → boolean`.
Todas com `'worklet'`.

- [ ] **Step 1: teste que falha:**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  friezeDepth, inkPose, motifPose, patterned, seeded, tileGrid, tilePhase, tilePiece, waveOrder,
} from './tile-math.ts';

test('a grade cobre a largura sem sobra e a altura inteira', () => {
  const g = tileGrid(402, 874);
  assert.equal(g.cols, 8);
  assert.ok(Math.abs(g.cols * g.size - 402) < 1e-9);
  assert.ok(g.rows * g.size >= 874);
  assert.equal(g.count, g.cols * g.rows);
});

test('a semente é determinística e espalhada', () => {
  assert.equal(seeded(5, 42), seeded(5, 42));
  assert.notEqual(seeded(5, 42), seeded(6, 42));
  const pecas = new Set(Array.from({ length: 64 }, (_, i) => tilePiece(i, 42)));
  assert.equal(pecas.size, 4);
  for (let i = 0; i < 200; i++) {
    const v = seeded(i, 7);
    assert.ok(v >= 0 && v < 1);
  }
});

test('a onda diagonal começa no canto da origem e termina no oposto', () => {
  assert.equal(waveOrder(0, 0, 8, 18, 'diagonal', 0, 0), 0);
  assert.equal(waveOrder(7, 17, 8, 18, 'diagonal', 0, 0), 1);
  assert.equal(waveOrder(7, 17, 8, 18, 'diagonal', 1, 1), 0);
});

test('a onda radial nasce na origem e cresce com a distância', () => {
  const centro = waveOrder(4, 9, 9, 19, 'radial', 0.5, 0.5);
  const canto = waveOrder(0, 0, 9, 19, 'radial', 0.5, 0.5);
  assert.equal(centro, 0);
  assert.ok(canto > 0.9 && canto <= 1);
});

test('up começa embaixo, down começa em cima', () => {
  assert.equal(waveOrder(3, 17, 8, 18, 'up'), 0);
  assert.equal(waveOrder(3, 0, 8, 18, 'down'), 0);
});

test('a fase é 0 antes da janela, 1 depois, e toda janela cabe em [0,1]', () => {
  for (const order of [0, 0.3, 1]) {
    assert.equal(tilePhase(0, order), 0);
    assert.equal(tilePhase(1, order), 1);
  }
  assert.ok(tilePhase(0.2, 0) > 0);
  assert.equal(tilePhase(0.2, 1), 0);
});

test('a tinta some na metade e o motivo floresce e some', () => {
  assert.deepEqual(inkPose(0), { scale: 1, angle: 0 });
  assert.equal(inkPose(0.5).scale, 0);
  assert.equal(motifPose(0).scale, 0);
  assert.equal(motifPose(0.5).scale, 1);
  assert.equal(motifPose(1).scale, 0);
  assert.ok(Math.abs(motifPose(0.999).angle - Math.PI / 2) < 0.01);
});

test('o friso fica entre 1 e depth, e é igual para a mesma semente', () => {
  for (let c = 0; c < 8; c++) {
    const d = friezeDepth(c, 8, 3, 11);
    assert.ok(d >= 1 && d <= 3, `coluna ${c}: ${d}`);
    assert.equal(d, friezeDepth(c, 8, 3, 11));
  }
  assert.equal(friezeDepth(0, 8, 0, 11), 0);
});

test('cerca de um terço dos azulejos do friso mostra o motivo', () => {
  const n = Array.from({ length: 300 }, (_, i) => patterned(i, 3)).filter(Boolean).length;
  assert.ok(n > 60 && n < 150, String(n));
});
```

- [ ] **Step 2:** `node --test src/design/tile-math.test.ts` → FAIL (módulo ausente).
- [ ] **Step 3: implementar** `src/design/tile-math.ts`:

```ts
/**
 * A geometria do campo de azulejos. Pura: roda em `node --test` e, com `'worklet'`, dentro do
 * `useRSXformBuffer` na thread de UI.
 *
 * O azulejo tem quatro peças (0 quadrado, 1 quarto de círculo, 2 meio círculo, 3 triângulo) e
 * gira em quartos de volta. A escolha é por SEMENTE, não por `Math.random`: o friso do login e a
 * cortina da abertura precisam desenhar os mesmos azulejos no mesmo lugar para a troca ser
 * invisível — é a história dos azulejos do Athos Bulcão assentados "ao acaso", só que o acaso é
 * reproduzível.
 */

export type WaveMode = 'diagonal' | 'radial' | 'up' | 'down';

export interface TileGrid {
  cols: number;
  rows: number;
  size: number;
  count: number;
}

export function tileGrid(width: number, height: number, target = 48): TileGrid {
  'worklet';
  const cols = Math.max(1, Math.round(width / target));
  const size = width / cols;
  const rows = Math.max(1, Math.ceil(height / size));
  return { cols, rows, size, count: cols * rows };
}

export function seeded(i: number, seed: number): number {
  'worklet';
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export function tilePiece(i: number, seed: number): number {
  'worklet';
  return Math.floor(seeded(i, seed) * 4);
}

export function tileTurns(i: number, seed: number): number {
  'worklet';
  return Math.floor(seeded(i, seed + 101) * 4);
}

/** Um terço dos azulejos parados mostra o motivo; o resto é tinta lisa. */
export function patterned(i: number, seed: number): boolean {
  'worklet';
  return seeded(i, seed + 202) < 0.34;
}

/**
 * Em que ponto da onda o azulejo entra: 0 é o primeiro, 1 o último. `ox`/`oy` são a origem em
 * fração da área. Um fio de ruído (15%) quebra a régua para a onda não parecer uma persiana.
 */
export function waveOrder(
  col: number,
  row: number,
  cols: number,
  rows: number,
  mode: WaveMode,
  ox = 0.5,
  oy = 0.5,
  seed = 0
): number {
  'worklet';
  const x = cols > 1 ? col / (cols - 1) : 0.5;
  const y = rows > 1 ? row / (rows - 1) : 0.5;
  let base: number;
  if (mode === 'up') base = 1 - y;
  else if (mode === 'down') base = y;
  else if (mode === 'radial') {
    const far = Math.max(
      Math.hypot(ox, oy),
      Math.hypot(1 - ox, oy),
      Math.hypot(ox, 1 - oy),
      Math.hypot(1 - ox, 1 - oy)
    );
    base = far > 0 ? Math.min(1, Math.hypot(x - ox, y - oy) / far) : 0;
  } else {
    const sx = ox <= 0.5 ? x : 1 - x;
    const sy = oy <= 0.5 ? y : 1 - y;
    base = (sx + sy) / 2;
  }
  if (base <= 0 || base >= 1 || seed === 0) return base;
  const ruido = seeded(row * cols + col, seed + 303) * 0.15;
  return Math.min(1, Math.max(0, base * 0.85 + ruido));
}

/** Progresso local do azulejo. Cada janela tem largura `1 - overlap` e todas cabem em [0, 1]. */
export function tilePhase(progress: number, order: number, overlap = 0.6): number {
  'worklet';
  const w = 1 - overlap;
  const start = order * (1 - w);
  return Math.min(1, Math.max(0, (progress - start) / w));
}

function easeInOut(t: number): number {
  'worklet';
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A tinta encolhe e gira até 45° na primeira metade da janela. */
export function inkPose(t: number): { scale: number; angle: number } {
  'worklet';
  const e = easeInOut(Math.min(1, t / 0.5));
  return { scale: 1 - e, angle: e * (Math.PI / 4) };
}

/** O motivo floresce de 0,15 a 0,5 e some de 0,5 a 1, girando de 45° a 90°. */
export function motifPose(t: number): { scale: number; angle: number } {
  'worklet';
  if (t <= 0.15 || t >= 1) return { scale: 0, angle: t >= 1 ? Math.PI / 2 : 0 };
  if (t < 0.5) {
    const e = easeInOut((t - 0.15) / 0.35);
    return { scale: e, angle: (Math.PI / 4) * e };
  }
  const e = easeInOut((t - 0.5) / 0.5);
  return { scale: 1 - e, angle: Math.PI / 4 + (Math.PI / 4) * e };
}

/** Quantas linhas ficam no friso nesta coluna: um perfil em degraus que desce para a direita. */
export function friezeDepth(col: number, cols: number, depth: number, seed: number): number {
  'worklet';
  if (depth <= 0) return 0;
  const queda = Math.floor((col / Math.max(1, cols - 1)) * (depth - 1) * 0.6);
  const salto = seeded(col, seed + 7) < 0.35 ? 1 : 0;
  return Math.max(1, Math.min(depth, depth - queda - salto));
}
```

  Ajuste do teste: `motifPose(0.999).angle` passa porque o ramo `t < 1` cai no segundo trecho.
- [ ] **Step 4:** `node --test src/design/tile-math.test.ts` → PASS; `npm test` → PASS.
- [ ] **Step 5:** commit `feat(motion): geometria do campo de azulejos`

### Task 4: `TileField` (Skia Atlas)

**Files:** criar `src/components/motion/tile-field.tsx`; modificar `src/app/catalog.tsx`

**Interfaces:**
- Consumes: `tile-math` (Task 3), tokens `tileInk`, `tileMotif`, `tilePaper` (Task 2).
- Produces:

```ts
export interface TileFieldProps {
  /** 0 = tudo coberto, 1 = revelado (o que sobra é o friso). */
  progress: SharedValue<number>;
  mode?: WaveMode;
  /** origem da onda em fração da área (0..1) */
  origin?: { x: number; y: number };
  /** linhas máximas do friso que ficam depois de revelar; 0 limpa tudo */
  frieze?: number;
  seed?: number;
  style?: StyleProp<ViewStyle>;
}
export const TILE_SEED = 1952; // Noigandres
export function TileField(props: TileFieldProps): JSX.Element;
export function friezeHeight(width: number, depth: number, seed?: number): number;
```

- [ ] **Step 1:** implementar:

```tsx
import { useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Atlas, Circle, Group, Path, Rect, Skia, rect, useRSXformBuffer, useTexture } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { Motion } from '@/design/tokens';
import {
  friezeDepth, inkPose, motifPose, patterned, tileGrid, tilePhase, tilePiece, tileTurns, waveOrder,
  type WaveMode,
} from '@/design/tile-math';
import { useTheme } from '@/hooks/use-theme';

export const TILE_SEED = 1952;
const PR = PixelRatio.get();

export function friezeHeight(width: number, depth: number, seed = TILE_SEED): number {
  const g = tileGrid(width, 1);
  let max = 0;
  for (let c = 0; c < g.cols; c++) max = Math.max(max, friezeDepth(c, g.cols, depth, seed));
  return max * g.size;
}

/** As quatro peças lado a lado, em branco — a cor vem de `colors` + `modulate`. */
function Pecas({ s }: { s: number }) {
  const tri = useMemo(() => {
    const p = Skia.PathBuilder.Make();
    p.moveTo(3 * s, 0); p.lineTo(4 * s, 0); p.lineTo(3 * s, s); p.close();
    return p.detach();
  }, [s]);
  return (
    <Group>
      <Rect x={0} y={0} width={s} height={s} color="white" />
      <Group clip={rect(s, 0, s, s)}>
        <Circle cx={s} cy={0} r={s} color="white" />
      </Group>
      <Group clip={rect(2 * s, 0, s, s)}>
        <Circle cx={2.5 * s} cy={0} r={s / 2} color="white" />
      </Group>
      <Path path={tri} color="white" />
    </Group>
  );
}

export function TileField({ progress, mode = 'diagonal', origin, frieze = 0, seed = TILE_SEED, style }: TileFieldProps) {
  const theme = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  };

  const g = useMemo(() => tileGrid(box.w || 1, box.h || 1), [box.w, box.h]);
  const S = Math.max(1, Math.ceil(g.size * PR)); // lado do sprite na textura, em pixels
  const k = g.size / S; // escala do sprite de volta a dp
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;

  const textura = useTexture(<Pecas s={S} />, { width: S * 4, height: S }, [S]);

  const ordens = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < g.count; i++) {
      const c = i % g.cols, r = Math.floor(i / g.cols);
      const fica = r < friezeDepth(c, g.cols, frieze, seed);
      out.push(fica ? -1 : waveOrder(c, r, g.cols, g.rows, mode, ox, oy, seed));
    }
    return out;
  }, [g, frieze, seed, mode, ox, oy]);

  const spritesTinta = useMemo(() => Array.from({ length: g.count }, () => rect(0, 0, S, S)), [g.count, S]);
  const spritesMotivo = useMemo(
    () => Array.from({ length: g.count }, (_, i) => rect(tilePiece(i, seed) * S, 0, S, S)),
    [g.count, S, seed]
  );
  const coresTinta = useMemo(() => Array.from({ length: g.count }, () => Skia.Color(theme.tileInk)), [g.count, theme.tileInk]);
  const coresMotivo = useMemo(
    () => Array.from({ length: g.count }, (_, i) => Skia.Color(i % 5 === 0 ? theme.tilePaper : theme.tileMotif)),
    [g.count, theme.tilePaper, theme.tileMotif]
  );
  const giros = useMemo(() => Array.from({ length: g.count }, (_, i) => tileTurns(i, seed)), [g.count, seed]);
  const comMotivo = useMemo(() => Array.from({ length: g.count }, (_, i) => patterned(i, seed)), [g.count, seed]);
  const overlap = Motion.curtain.overlap;

  const tinta = useRSXformBuffer(g.count, (val, i) => {
    'worklet';
    const ordem = ordens[i];
    const t = ordem < 0 ? 0 : tilePhase(progress.value, ordem, overlap);
    const pose = inkPose(t);
    const sc = pose.scale * k;
    const cx = ((i % g.cols) + 0.5) * g.size;
    const cy = (Math.floor(i / g.cols) + 0.5) * g.size;
    const cos = sc * Math.cos(pose.angle), sin = sc * Math.sin(pose.angle);
    const h = S / 2;
    val.set(cos, sin, cx - (cos * h - sin * h), cy - (sin * h + cos * h));
  });

  const motivo = useRSXformBuffer(g.count, (val, i) => {
    'worklet';
    const ordem = ordens[i];
    let scale: number, angle: number;
    if (ordem < 0) {
      scale = comMotivo[i] ? 1 : 0;
      angle = 0;
    } else {
      const pose = motifPose(tilePhase(progress.value, ordem, overlap));
      scale = pose.scale;
      angle = pose.angle;
    }
    angle += giros[i] * (Math.PI / 2);
    const sc = scale * k;
    const cx = ((i % g.cols) + 0.5) * g.size;
    const cy = (Math.floor(i / g.cols) + 0.5) * g.size;
    const cos = sc * Math.cos(angle), sin = sc * Math.sin(angle);
    const h = S / 2;
    val.set(cos, sin, cx - (cos * h - sin * h), cy - (sin * h + cos * h));
  });

  return (
    <View style={style} onLayout={onLayout} pointerEvents="none">
      {box.w > 0 ? (
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          <Atlas image={textura} sprites={spritesTinta} transforms={tinta} colors={coresTinta} colorBlendMode="modulate" />
          <Atlas image={textura} sprites={spritesMotivo} transforms={motivo} colors={coresMotivo} colorBlendMode="modulate" />
        </SkiaCanvas>
      ) : null}
    </View>
  );
}
```

  Observação de execução: se o giro do motivo por semente fizer a peça "pular" ao florescer,
  o giro de semente vale só para os azulejos parados (`ordem < 0`) — ajuste medido no aparelho.
- [ ] **Step 2:** vitrine em `catalog.tsx`: seção "Campo de azulejos" com um `TileField` de
  320pt de altura, um slider-botão que anima `progress` 0 ↔ 1 (`withTiming` de
  `Motion.curtain.duration`), e um segmento para `mode` (diagonal/radial/up/down) e outro para
  `frieze` (0/3).
- [ ] **Step 3:** abrir `/catalog` no iOS e no Android, gravar vídeo da onda nos quatro modos,
  conferir quadro a quadro: sem sprite borrado, sem salto, friso estável.
  `adb shell dumpsys gfxinfo com.proops.personal.dev framestats` — janky frames < 5%.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx expo lint`, `npm test`.
- [ ] **Step 5:** commit `feat(motion): TileField em Skia Atlas`

### Task 5: `PressableScale`, `TileSpinner` e o `Button` Concreto

**Files:** criar `src/components/motion/pressable-scale.tsx`,
`src/components/motion/tile-spinner.tsx`; modificar `src/components/ui/button.tsx`,
`src/components/ui/quick-actions.tsx`, `src/app/finance/cards.tsx` (`PressCard`),
`src/components/ui/hero-panel.tsx` (press do corpo)

**Interfaces:**

```ts
export function PressableScale(props: PressableProps & {
  scaleTo?: number;               // default Motion.pressScale
  haptic?: 'selection' | 'light'; // default nenhum
  style?: StyleProp<ViewStyle>;   // estilo estático (não aceita função)
}): JSX.Element;

export function TileSpinner(props: { size?: number; color?: ThemeColor }): JSX.Element;
```

- [ ] **Step 1:** `pressable-scale.tsx`:

```tsx
import * as Haptics from 'expo-haptics';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Motion } from '@/design/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  scaleTo = Motion.pressScale,
  haptic,
  style,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: Omit<PressableProps, 'style'> & {
  scaleTo?: number;
  haptic?: 'selection' | 'light';
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useSharedValue(1);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        scale.set(withTiming(scaleTo, { duration: Motion.duration.fast, easing: Motion.easing.out }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: Motion.duration.base, easing: Motion.easing.out }));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic === 'selection') Haptics.selectionAsync();
        if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={[style, animado]}
    />
  );
}
```

- [ ] **Step 2:** `tile-spinner.tsx` — quarto de círculo que gira em passos de 90° com
  assentamento (um relógio linear, degrau suavizado dentro do worklet):

```tsx
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PASSO_MS = 420;

export function TileSpinner({ size = 16, color = 'onTint' }: { size?: number; color?: ThemeColor }) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const relogio = useSharedValue(0);
  useEffect(() => {
    relogio.set(withRepeat(withTiming(4, { duration: PASSO_MS * 4, easing: Easing.linear }), -1, false));
  }, [relogio]);
  const giro = useAnimatedStyle(() => {
    const t = relogio.get();
    const inteiro = Math.floor(t);
    const f = t - inteiro;
    // os primeiros 60% do passo giram, o resto assenta parado — lê como azulejo encaixando
    const k = Math.min(1, f / 0.6);
    const e = reduzido ? 0 : 1 - Math.pow(1 - k, 3);
    return { transform: [{ rotate: `${(inteiro + e) * 90}deg` }] };
  });
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <Animated.View
        style={[
          { width: size, height: size, backgroundColor: theme[color], borderTopLeftRadius: size, borderCurve: 'continuous' },
          giro,
        ]}
      />
    </View>
  );
}
```

- [ ] **Step 3:** `Button`: retângulo `Radius.sm`; primário/destrutivo em `tintFill`/`danger`;
  press por `PressableScale` (háptico `light`); **morph**: uma camada de fundo
  (`Animated.View` absoluta) que, com `loading`, anima `scaleX` até `altura/largura`
  (mola `encaixe`) enquanto o rótulo esmaece e o `TileSpinner` (cor do rótulo) aparece no centro;
  a largura vem de `onLayout`. O wrapper externo mantém a largura (layout não pula). Com Reduce
  Motion, sem `scaleX`: só troca rótulo ↔ spinner. Web continua com `ActivityIndicator`.
  `accessibilityState.busy` continua.
- [ ] **Step 4:** trocar o press copiado por `PressableScale` em `QuickActions.Tile`,
  `cards.tsx#PressCard` e no corpo do `HeroPanel` (mantendo `accessibilityRole`/`Label` e o
  comportamento de cada um).
- [ ] **Step 5:** vitrine: seção "Botão" no catálogo com um botão que alterna `loading` a cada
  toque; conferir nos dois aparelhos (vídeo): a pílula não existe mais, o retângulo encolhe
  para quadrado sem esticar o texto, o azulejo gira em degraus.
- [ ] **Step 6:** portão (`tsc`, `lint`, `npm test`) e commit
  `feat(motion): PressableScale, TileSpinner e botão com morph`

### Task 6: `Reveal` e `SplitReveal`

**Files:** criar `src/components/motion/reveal.tsx`, `src/components/motion/split-reveal.tsx`;
modificar `src/app/catalog.tsx`

**Interfaces:**

```ts
export function staggerDelay(index: number): number; // min(index*step, cap)
export function Reveal(props: {
  index?: number;          // posição na cascata
  delay?: number;          // atraso extra
  from?: 'up' | 'fade';    // default 'up' (12pt)
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): JSX.Element;

export function SplitReveal(props: {
  text: string;
  type?: ThemedTextProps['type'];
  themeColor?: ThemeColor;
  tabular?: boolean;
  /** começa quando fica true (default true) */
  play?: boolean;
  delay?: number;
  style?: StyleProp<TextStyle>;
}): JSX.Element;
```

- [ ] **Step 1:** `reveal.tsx` — builders do Reanimated (estáveis, com `ReduceMotion.System`):

```tsx
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { Motion } from '@/design/tokens';

export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index) * Motion.stagger.step, Motion.stagger.cap);
}

export function Reveal({ index = 0, delay = 0, from = 'up', children, style }: {
  index?: number; delay?: number; from?: 'up' | 'fade'; children: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const atraso = staggerDelay(index) + delay;
  const entering =
    from === 'fade'
      ? FadeIn.duration(180).delay(atraso).reduceMotion(ReduceMotion.System)
      : FadeInDown.withInitialValues({ transform: [{ translateY: 12 }] })
          .duration(Motion.duration.slow)
          .easing(Motion.easing.out)
          .delay(atraso)
          .reduceMotion(ReduceMotion.System);
  return <Animated.View entering={entering} style={style}>{children}</Animated.View>;
}
```

- [ ] **Step 2:** `split-reveal.tsx` — um relógio para a palavra inteira; cada caractere num
  recorte (`overflow: 'hidden'`) sobe de 100% da altura da linha; palavras não quebram no meio;
  leitor de tela lê o texto inteiro:

```tsx
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import type { ThemeColor } from '@/constants/theme';
import { Motion, Type, tabular as tab } from '@/design/tokens';

const PASSO = 18;   // ms entre caracteres
const SUBIDA = 420; // ms de cada caractere

function Letra({ ch, i, clock, altura }: { ch: string; i: number; clock: SharedValue<number>; altura: number }) {
  const estilo = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (clock.get() - i * PASSO) / SUBIDA));
    const e = 1 - Math.pow(1 - t, 4);
    return { transform: [{ translateY: (1 - e) * altura }], opacity: t > 0 ? 1 : 0 };
  });
  return <Animated.View style={estilo}>{ch}</Animated.View>;
}
```

  (O `ch` renderizado é um `ThemedText` com o estilo do tipo e `flexShrink: 0`; a altura do
  recorte vem de `Type[...].lineHeight`.) O componente monta palavras como `View` em linha com
  `flexWrap: 'wrap'`, dispara `clock` com
  `withDelay(delay, withTiming(n * PASSO + SUBIDA, { duration: n * PASSO + SUBIDA }))` quando
  `play` vira `true`, e com Reduce Motion desenha um `ThemedText` só, com `FadeIn`. O contêiner
  externo tem `accessible` e `accessibilityLabel={text}`; as letras são
  `importantForAccessibility="no-hide-descendants"`.
- [ ] **Step 3:** vitrine: "bom dia, gabriel" em `display` e "R$ 2.450,00" em `heroMoney` com
  `tabular`, botão para repetir; conferir que nenhuma letra aparece fora do recorte, que a
  quebra respeita palavras a fonte 1,3 e que o leitor de tela lê a frase.
- [ ] **Step 4:** portão e commit `feat(motion): Reveal e SplitReveal`

### Task 7: Primitivos Concreto

**Files:** `card.tsx`, `row.tsx`, `field.tsx`, `segmented.tsx`, `hero-panel.tsx`,
`quick-actions.tsx`, `sparkline.tsx`, `toast.tsx`, `empty-state.tsx`, `app-header.tsx`,
`skeleton.tsx`, `src/app/(tabs)/profile/index.tsx`, `src/components/finance/chip.tsx`,
`select-field.tsx`, `calendar.tsx`, `cycle-day-picker.tsx`, `month-picker.tsx`

Cada item abaixo é uma mudança de pele; nenhuma prop pública muda e nenhum filho sai.

- [ ] **Step 1: `Card` e `Section`** — `borderWidth: 1` (`cardBorder`), `Radius.md`,
  elevação padrão `'none'`; `Section` troca a sombra por borda de 1px.
- [ ] **Step 2: `Row`** — `iconChip` quadrado (`Radius.sm`), resto igual.
- [ ] **Step 3: `Field`** — `TextField` e `MoneyField` com `borderWidth: 2` constante; cor da
  borda animada (`interpolateColor` num `useSharedValue` de foco, 160 ms): transparente →
  `tint` no foco; `danger` quando `invalid` (ganha do foco). `Animated.createAnimatedComponent(TextInput)`
  com `forwardRef` preservado. `onFocus`/`onBlur` do chamador continuam sendo chamados.
- [ ] **Step 4: `Segmented`** — trilho `Radius.sm`; indicador preenchido de `text`
  (tinta no claro, papel no escuro), sem sombra; rótulo selecionado em `background`.
- [ ] **Step 5: `HeroPanel` + `QuickActions`** — sem `GradientSurface` e sem fio especular;
  fundo `heroSurface`, sem borda; chips `…`/olho quadrados (`Radius.sm`); `QuickActions` com
  `Radius.sm`. Mesmos filhos, mesma ordem, mesmo menu, mesmo olho.
- [ ] **Step 6: `Sparkline`** — área chapada (`${color}26`) em vez de gradiente, traço de uma cor
  só (`theme.text` no passado continua cinza); miolo do alfinete em `heroSurface`.
- [ ] **Step 7: `Toast`** — bloco `heroSurface` com texto `onHero`, faixa de 3px à esquerda na
  cor do tom (`onHeroSuccess`/`onHeroDanger`/`tilePaper` para info), ícone na cor do tom,
  ação em `onHero` sublinhada; `Radius.sm`; entrada `FadeInDown` mantida.
- [ ] **Step 8: `EmptyState`** — sem `icon`, desenha um bloco 2×2 de azulejos estáticos
  (`TileGlyph`, quatro `View` de 22pt com as peças da semente, cor `textSecondary`) no lugar da
  espiral. Com `icon`, igual.
- [ ] **Step 9: `AppHeader`** — o `title` passa a aparecer na faixa, ao lado da marca, em
  `title2` minúsculo (`title.toLocaleLowerCase('pt-BR')`), com `flexShrink: 1`; `HeaderIconButton`
  quadrado (`Radius.sm`); avatar continua redondo. `stackHeaderFonts` segue `Fonts`.
- [ ] **Step 10: `Skeleton`** — sem pisca; um relógio de módulo (`makeMutable(0)`, iniciado no
  primeiro esqueleto montado, parado quando o último desmonta) move uma faixa chapada
  (`backgroundSelected`, 40% da largura da tela, `skewX: '-12deg'`) da esquerda para a direita
  em 1400 ms, com a posição horizontal do bloco na janela (`measureInWindow` uma vez no
  `onLayout`) descontada — todos os blocos varrem em sincronia. Reduce Motion: bloco parado.
- [ ] **Step 11: Perfil** — herói sem `GradientSurface` (fundo `heroSurface`); selo em
  `tintFill` com borda `heroSurface`.
- [ ] **Step 12: controles de escolha** — `chip.tsx`, `select-field.tsx`, `calendar.tsx`,
  `cycle-day-picker.tsx`, `month-picker.tsx`: pílulas de chip ficam (`Radius.pill`), células e
  marcas quadradas (`Radius.sm`), fundo azul em `tintFill` (já trocado na Task 2).
- [ ] **Step 13:** portão e commit `feat(design): primitivos no mundo Concreto`

### Task 8: Verificação da fase nos dois aparelhos

- [ ] **Step 1:** recarregar de verdade (menu de dev → Reload) e provar que recarregou (a fonte
  Jost é o marcador: o "g" de dois andares da Hanken some).
- [ ] **Step 2:** repetir as capturas da Task 0, claro e escuro, iOS e Android, em
  `scratchpad/fase1/{ios,android}/`. Comparar com a linha de base **tela a tela**: toda ação do
  inventário continua visível no mesmo lugar.
- [ ] **Step 3:** `adb shell wm density 560 && adb shell settings put system font_scale 1.30`;
  capturar Hoje, Financeiro, Fatura e o formulário de lançamento; devolver `480` / `1.0`.
- [ ] **Step 4:** anti-slop manual: um azul por tela, nenhum gradiente, nenhuma pílula em botão,
  nenhum texto cortado.
- [ ] **Step 5:** corrigir o que aparecer em um lote, repetir as capturas uma vez, commit
  `fix(design): ajustes da verificação da fase 1` se houver mudança.
