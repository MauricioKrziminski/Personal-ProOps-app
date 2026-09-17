# Concreto — Fase 2: Abertura, sessão e trava — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a abertura vira a cortina de azulejos (splash nativo em tinta → onda que descobre o
app), toda troca de sessão passa por essa cortina, e a trava troca aurora + disco de vidro por
campo de azulejos + azulejo azul com a espiral.

**Architecture:** um `CortinaProvider` na raiz é dono de UMA camada de azulejos (`TileField`)
e expõe `cobrir(onda)` / `revelar(onda)` como promessas. O `SessionProvider` passa a ser a fonte
única da sessão: guarda a sessão MOSTRADA, e quando o `user.id` muda ele cobre, troca, espera
dois quadros e revela — com teto de 1,5 s em cada passo (`comTeto`, que já existe). A regra de
"quando há cortina e de onde vem a onda" é pura, em `lib/session-gate.ts`. A trava é um
componente próprio com o seu campo, porque ela vive por baixo da cortina (900 < 1000) e precisa
existir mesmo sem troca de sessão.

**Tech Stack:** Expo SDK 57, React Native 0.86 (Fabric), Reanimated 4.5, Skia 2.6,
expo-splash-screen, supabase-js, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-concreto-redesign-design.md` (seções *Portão de
sessão*, *Ordem na raiz*, *Abertura*, *Trava*, *Reduce Motion*, *Erros e bordas*).
**Plano anterior:** `docs/superpowers/plans/2026-09-16-concreto-fase-1-fundacao.md` — leia a
seção *Emendas* dele: o friso virou CANTO (`corner`), e é esse o vocabulário daqui.

## Global Constraints

- Regra 0: nenhuma feature sai de tela nem muda de lugar. Trava mantém: prompt automático,
  toque para tentar de novo, frase de estado, título "App bloqueado".
- Cor só via `useTheme()`; cor nova com par claro E escuro em `src/constants/theme.ts`.
- Zero `fontSize` solto; peso é família (`Fonts.*`).
- Animação só em worklet, só `transform`/`opacity` (ou buffer do Skia).
- Reduce Motion: cortina, onda e voo viram cross-fade de 200 ms (`Motion.duration.base`).
- `ThemedText` dentro de contêiner com `entering` leva `flexShrink: 0` quando é identificador.
- `setState` síncrono dentro de `useEffect` é barrado pelo lint: ajuste de estado vai no render
  (padrão documentado do React) ou depois de um `await`.
- Camadas da raiz: trava 900 < cortina 1000, sempre com `zIndex` **e** `elevation` (no Android só
  `zIndex` deixa o app clicável por baixo).
- A cortina NUNCA prende: todo passo de animação tem teto, e o revelar que estoura o teto abre à
  força (`abrirJa`).
- Commit: uma linha, conventional, **sem** `Co-Authored-By`. Sem tag, sem produção.
- Portão por tarefa: `npx tsc --noEmit`, `npx expo lint`, `npm test` (olhar o código de saída).
- **Mudança nativa** (splash): exige build novo nos dois aparelhos, e no release um `version`
  novo no `app.json` (a política de runtime é `appVersion`, então OTA não leva o splash).
- Fora desta fase, de propósito: sem sessão, a abertura revela TUDO. Parar a onda no canto do
  login só faz sentido quando o `AuthScreen` desenhar o mesmo canto (Fase 3); antes disso os
  azulejos do canto sumiriam de uma vez ao desmontar a camada.
- Também da Fase 3: o `Button` registrando o próprio centro (`lembrarOrigem`) para a onda nascer
  nele, e o onboarding cobrindo a tela ao concluir (mesmo usuário → o portão não cobre sozinho).
  Nesta fase, entrar sem origem desce do topo.

---

## Mapa de arquivos

| arquivo | ação | responsabilidade |
|---|---|---|
| `src/design/tile-math.ts` + `.test.ts` | modificar | `waveOrder(..., invert)`; `quarterStep(t, spin)` (o degrau do spinner, agora compartilhado) |
| `src/components/motion/tile-field.tsx` | modificar | prop `invert` |
| `src/components/motion/tile-spinner.tsx` | modificar | usa `quarterStep` |
| `src/lib/session-gate.ts` + `.test.ts` | criar | pura: quando há cortina, de onde vem a onda, validade da origem, tetos |
| `src/design/mark-path.ts` | modificar | `markPathIn(x, y, w, h)` — a marca encaixada numa caixa |
| `src/components/motion/session-curtain.types.ts` | criar | contrato `CortinaApi` |
| `src/components/motion/session-curtain.tsx` | criar | provider + camada + abertura (nativo) |
| `src/components/motion/session-curtain.web.tsx` | criar | provider sem camada (web) |
| `src/components/animated-icon.tsx`, `animated-icon.web.tsx` | apagar | substituídos pela cortina |
| `src/hooks/use-session.ts` → `use-session.tsx` | reescrever | `SessionProvider` + `useSession` por contexto; portão |
| `src/app/_layout.tsx` | modificar | providers na raiz, `marcarPronto`, sai o overlay antigo |
| `src/lib/anti-slop.test.ts` | modificar | `onAuthStateChange` só em `use-session.tsx` |
| `app.json` | modificar | splash `#0D0D0C` + `mark-white.png` nos dois temas |
| `src/constants/theme.ts` | modificar | `tilePaperMuted`; saem `auroraDeep/Glow/Lift` |
| `src/components/ui/lock-overlay.tsx` | reescrever | campo de azulejos + azulejo da trava |
| `src/components/lock/aurora.tsx`, `keyhole.tsx` | apagar | substituídos |

---

### Task 1: Onda invertida e degrau de quarto de volta (`tile-math`)

**Files:**
- Modify: `src/design/tile-math.ts` (função `waveOrder`, nova `quarterStep`)
- Modify: `src/components/motion/tile-field.tsx` (prop `invert`)
- Modify: `src/components/motion/tile-spinner.tsx` (usa `quarterStep`)
- Test: `src/design/tile-math.test.ts`

**Interfaces:**
- Produces: `waveOrder(col, row, cols, rows, mode, ox?, oy?, seed?, invert?: boolean): number`;
  `quarterStep(t: number, spin?: number): number` (quartos de volta, worklet);
  `TileFieldProps.invert?: boolean`.

Por que inverter: com o progresso DESCENDO (cobrir), os azulejos de ordem alta cobrem primeiro.
Para a cobertura nascer na origem (o botão, a base da tela), a ordem perto da origem precisa ser
a mais alta — é a ordem normal invertida. Nas duas pontas (progresso 0 e 1) a ordem não aparece,
então trocar `invert` com a cortina parada é invisível.

- [ ] **Step 1: testes que falham** — acrescentar a `src/design/tile-math.test.ts` (e
  `quarterStep` ao import):

```ts
test('invertida, a onda começa onde a normal termina', () => {
  for (const [c, r] of [[0, 0], [3, 5], [7, 11], [4, 0]]) {
    for (const mode of ['diagonal', 'radial', 'up', 'down'] as const) {
      const normal = waveOrder(c, r, 8, 12, mode, 0.2, 0.7, 1952);
      const invertida = waveOrder(c, r, 8, 12, mode, 0.2, 0.7, 1952, true);
      assert.ok(Math.abs(invertida - (1 - normal)) < 1e-9, `${mode} ${c},${r}`);
    }
  }
});

test('cobrir de baixo: com "up" invertido a linha de baixo tem a ordem mais alta', () => {
  const baixo = waveOrder(3, 11, 8, 12, 'up', 0.5, 0.5, 0, true);
  const topo = waveOrder(3, 0, 8, 12, 'up', 0.5, 0.5, 0, true);
  assert.equal(baixo, 1);
  assert.equal(topo, 0);
});

test('o degrau gira na primeira parte do passo e assenta no resto', () => {
  assert.equal(quarterStep(0), 0);
  assert.ok(Math.abs(quarterStep(0.6) - 1) < 1e-9);
  assert.ok(Math.abs(quarterStep(0.99) - 1) < 1e-9);
  assert.ok(Math.abs(quarterStep(3.6) - 4) < 1e-9);
  let antes = -1;
  for (let t = 0; t <= 4; t += 0.05) {
    const v = quarterStep(t);
    assert.ok(v >= antes - 1e-9, `desceu em ${t}`);
    antes = v;
  }
});
```

- [ ] **Step 2:** `node --test src/design/tile-math.test.ts` → FAIL (`quarterStep` não existe;
  `invert` ignorado).

- [ ] **Step 3: implementar** — em `tile-math.ts`, a assinatura e as duas saídas de `waveOrder`:

```ts
export function waveOrder(
  col: number,
  row: number,
  cols: number,
  rows: number,
  mode: WaveMode,
  ox = 0.5,
  oy = 0.5,
  seed = 0,
  invert = false
): number {
  'worklet';
  // ... (corpo atual até `base` inalterado)
  if (seed === 0 || base <= 0 || base >= 1) return invert ? 1 - base : base;
  const ruido = seeded(row * cols + col, seed + 303) * 0.15;
  const ordem = Math.min(1, Math.max(0, base * 0.85 + ruido));
  return invert ? 1 - ordem : ordem;
}
```

e documentar o parâmetro no JSDoc da função: *"`invert` devolve `1 - ordem`: quem COBRE a
partir de um ponto passa `true`, porque com o progresso descendo quem cobre primeiro é a ordem
alta."* No fim do arquivo:

```ts
/**
 * Quartos de volta de um relógio linear: gira na fração `spin` de cada passo e assenta no resto.
 * Um relógio só e aritmética no worklet — `withSequence` encadeado acumula erro de ângulo.
 */
export function quarterStep(t: number, spin = 0.6): number {
  'worklet';
  const inteiro = Math.floor(t);
  const k = Math.min(1, (t - inteiro) / spin);
  return inteiro + (1 - Math.pow(1 - k, 3));
}
```

- [ ] **Step 4:** `tile-field.tsx` — na interface:

```ts
  /**
   * Ordem da onda ao contrário (`waveOrder(..., invert)`). Quem COBRE a partir de um ponto passa
   * `true`; quem revela, `false`. Trocar com o progresso em 0 ou 1 não aparece na tela.
   */
  invert?: boolean;
```

desestruturar `invert = false`, passar `invert` como último argumento de `waveOrder` dentro do
`useMemo` de `dados` e somá-lo às dependências desse `useMemo`.

- [ ] **Step 5:** `tile-spinner.tsx` — trocar o corpo do `useAnimatedStyle` e remover `GIRO`:

```ts
  const giro = useAnimatedStyle(() => ({
    transform: [{ rotate: `${quarterStep(relogio.get()) * 90}deg` }],
  }));
```

com `import { quarterStep } from '@/design/tile-math';`.

- [ ] **Step 6:** `node --test src/design/tile-math.test.ts` → PASS; portão (`tsc`, `lint`,
  `npm test`).

- [ ] **Step 7:** commit `feat(motion): onda invertida e degrau de quarto de volta compartilhado`

---

### Task 2: Regra do portão de sessão (`session-gate`)

**Files:**
- Create: `src/lib/session-gate.ts`
- Test: `src/lib/session-gate.test.ts`

**Interfaces:**
- Produces:
  - `type Ponto = { x: number; y: number }` (fração da tela, 0..1)
  - `type Onda = { mode: WaveMode; origin?: Ponto }`
  - `TETO_DA_TROCA_MS = 1500`, `TETO_DA_ABERTURA_MS = 2500`, `VALIDADE_DA_ORIGEM_MS = 4000`
  - `precisaDeCortina(antes: string | null | undefined, depois: string | null): boolean`
  - `ondaDaTroca(depois: string | null, origem: Ponto | null): Onda`
  - `origemValida(registro: { ponto: Ponto; em: number } | null, agora: number): Ponto | null`

- [ ] **Step 1: teste que falha** — `src/lib/session-gate.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  VALIDADE_DA_ORIGEM_MS,
  ondaDaTroca,
  origemValida,
  precisaDeCortina,
} from './session-gate.ts';

test('a primeira sessão resolvida é a abertura, não uma troca', () => {
  assert.equal(precisaDeCortina(undefined, null), false);
  assert.equal(precisaDeCortina(undefined, 'u1'), false);
});

test('mesmo usuário (refresh de token, metadados do onboarding) passa direto', () => {
  assert.equal(precisaDeCortina('u1', 'u1'), false);
  assert.equal(precisaDeCortina(null, null), false);
});

test('entrar, sair e trocar de conta passam pela cortina', () => {
  assert.equal(precisaDeCortina(null, 'u1'), true);
  assert.equal(precisaDeCortina('u1', null), true);
  assert.equal(precisaDeCortina('u1', 'u2'), true);
});

test('sair cobre de baixo, mesmo com uma origem lembrada', () => {
  assert.deepEqual(ondaDaTroca(null, null), { mode: 'up' });
  assert.deepEqual(ondaDaTroca(null, { x: 0.5, y: 0.8 }), { mode: 'up' });
});

test('entrar com botão nasce no botão; sem botão, do topo', () => {
  assert.deepEqual(ondaDaTroca('u1', { x: 0.5, y: 0.8 }), {
    mode: 'radial',
    origin: { x: 0.5, y: 0.8 },
  });
  assert.deepEqual(ondaDaTroca('u1', null), { mode: 'down' });
});

test('a origem lembrada vence depois de um tempo', () => {
  const r = { ponto: { x: 0.3, y: 0.9 }, em: 1000 };
  assert.deepEqual(origemValida(r, 1000 + VALIDADE_DA_ORIGEM_MS), r.ponto);
  assert.equal(origemValida(r, 1001 + VALIDADE_DA_ORIGEM_MS), null);
  assert.equal(origemValida(null, 1000), null);
});
```

- [ ] **Step 2:** `node --test src/lib/session-gate.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: implementar** — `src/lib/session-gate.ts`:

```ts
import type { WaveMode } from '@/design/tile-math';

/**
 * Quando uma troca de sessão passa pela cortina, e de onde a onda nasce — a regra do portão,
 * pura, fora do React (mesma razão de `lock-policy.ts`: regra que só se testa subindo a tela é
 * regra que ninguém testa).
 *
 * O `SessionProvider` guarda a sessão MOSTRADA. Evento do mesmo usuário (refresh de token,
 * `USER_UPDATED`, metadados do onboarding) é aplicado na hora; usuário diferente (entrar, sair,
 * trocar de conta) cobre a tela, troca por baixo e revela.
 */

/** Um ponto da tela em fração (0..1), no referencial da onda. */
export interface Ponto {
  x: number;
  y: number;
}

export interface Onda {
  mode: WaveMode;
  origin?: Ponto;
}

/** Teto de CADA passo da troca (cobrir, revelar). Passou disso, a troca acontece assim mesmo. */
export const TETO_DA_TROCA_MS = 1500;
/** Teto da espera da abertura por fontes e sessão. */
export const TETO_DA_ABERTURA_MS = 2500;
/**
 * Quanto a origem registrada por um botão continua valendo. O login pode levar alguns segundos
 * na rede; passado isso, o evento de sessão já não tem relação com o toque.
 */
export const VALIDADE_DA_ORIGEM_MS = 4000;

/** `antes === undefined`: a sessão ainda não tinha resolvido — é a abertura, não uma troca. */
export function precisaDeCortina(antes: string | null | undefined, depois: string | null): boolean {
  return antes !== undefined && antes !== depois;
}

/**
 * Sair cobre DE BAIXO (a tela desce como uma porta); entrar nasce no botão que disparou, e sem
 * botão (link, código colado) desce do topo. Quem inverte a ordem para cobrir é a cortina.
 */
export function ondaDaTroca(depois: string | null, origem: Ponto | null): Onda {
  if (depois === null) return { mode: 'up' };
  if (origem) return { mode: 'radial', origin: origem };
  return { mode: 'down' };
}

export function origemValida(
  registro: { ponto: Ponto; em: number } | null,
  agora: number
): Ponto | null {
  if (!registro) return null;
  return agora - registro.em <= VALIDADE_DA_ORIGEM_MS ? registro.ponto : null;
}
```

- [ ] **Step 4:** `node --test src/lib/session-gate.test.ts` → PASS; portão.

- [ ] **Step 5:** commit `feat(auth): regra pura do portão de sessão`

---

### Task 3: A cortina (`CortinaProvider`) e a abertura nova

**Files:**
- Modify: `src/design/mark-path.ts` (nova `markPathIn`)
- Create: `src/components/motion/session-curtain.types.ts`
- Create: `src/components/motion/session-curtain.tsx`
- Create: `src/components/motion/session-curtain.web.tsx`
- Delete: `src/components/animated-icon.tsx`, `src/components/animated-icon.web.tsx`
- Modify: `app.json` (splash)
- Modify: `src/app/_layout.tsx` (troca do overlay; o `SessionProvider` entra na Task 4)

**Interfaces:**
- Consumes: `TileField` (`invert`, `cover`, `onReady`), `comTeto(p, ms, msg)` de
  `@/lib/com-teto`, `Onda`/`Ponto`/`TETO_DA_ABERTURA_MS`/`origemValida` da Task 2.
- Produces:
  - `CortinaProvider({ children })`
  - `useCortina(): CortinaApi`
  - `useCortinaAberta(): boolean` — `true` só depois que a abertura revelou e enquanto nada
    cobre (a Fase 5 espera isto para coreografar as raízes)
  - `CortinaApi = { cobrir(onda): Promise<void>; revelar(onda): Promise<void>; abrirJa(): void;
    lembrarOrigem(ponto): void; tomarOrigem(): Ponto | null; marcarPronto(): void }`
  - `markPathIn(x: number, y: number, w: number, h: number): SkPath`

**A abertura, quadro a quadro:**

| t | o quê |
|---|---|
| 0 | splash nativo: `#0D0D0C` + `mark-white.png` de 96 dp |
| camada pintou e o PNG carregou | `hideAsync()` — o nativo sai com a camada idêntica por cima (campo em tinta + o MESMO PNG, mesmo tamanho) |
| show (5 primeiras aberturas, 1,8 s) | um traço azul (`tintFill`) percorre o contorno da espiral e some; em volta dela, uma ondulação radial vira os azulejos até 0,16 e volta — os motivos azuis aparecem e assentam. Por trás há tinta lisa, então só os motivos se veem |
| pronto (fontes + sessão, teto 2,5 s) | a onda diagonal nasce no canto inferior esquerdo e recolhe os azulejos até o superior direito (900 ms; 600 ms na versão curta); a marca some no primeiro quarto |
| fim | a camada desmonta; `useCortinaAberta()` vira `true` |

- [ ] **Step 1: `markPathIn`** — ao fim de `src/design/mark-path.ts`:

```ts
/**
 * A marca encaixada numa caixa qualquer, pelos limites REAIS da tinta.
 *
 * Existe para o traço da abertura cair exatamente sobre o PNG do splash: o PNG tem margem
 * própria (a tinta ocupa 61..451 de 512 px), e `markPath(size)` centra pelo desenho, não por ela.
 */
export function markPathIn(x: number, y: number, w: number, h: number): SkPath {
  const path = markPath(Math.max(w, h));
  const b = path.getBounds();
  const k = Math.min(w / b.width, h / b.height);
  // Pós-concatenado: aplica da última para a primeira — volta à origem, escala, posiciona.
  const m = Skia.Matrix();
  m.translate(x + (w - b.width * k) / 2, y + (h - b.height * k) / 2);
  m.scale(k, k);
  m.translate(-b.x, -b.y);
  path.transform(m);
  return path;
}
```

- [ ] **Step 2: o contrato** — `src/components/motion/session-curtain.types.ts`:

```ts
import type { Onda, Ponto } from '@/lib/session-gate';

/**
 * A cortina de azulejos da raiz. Nativo e web implementam o MESMO contrato (frontend.md:
 * arquivo por plataforma com o tipo compartilhado).
 */
export interface CortinaApi {
  /** Cobre a tela a partir da onda; resolve quando o último azulejo assentou. */
  cobrir(onda: Onda): Promise<void>;
  /** Descobre; resolve quando o último azulejo saiu e a camada desmontou. */
  revelar(onda: Onda): Promise<void>;
  /** Abre à força, sem animação — a saída de quem estourou o teto. */
  abrirJa(): void;
  /** O centro do botão que vai disparar uma troca de sessão, em fração da tela. */
  lembrarOrigem(ponto: Ponto): void;
  /** Consome a origem lembrada, se ainda vale. */
  tomarOrigem(): Ponto | null;
  /** A raiz avisa que fontes e sessão estão prontas; a abertura só revela depois disso. */
  marcarPronto(): void;
}
```

- [ ] **Step 3: a implementação nativa** — `src/components/motion/session-curtain.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Path } from '@shopify/react-native-skia';
import * as SplashScreen from 'expo-splash-screen';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import marcaBranca from '@/assets/images/brand/mark-white.png';
import { TileField } from '@/components/motion/tile-field';
import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { markPathIn } from '@/design/mark-path';
import { Motion } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { comTeto } from '@/lib/com-teto';
import {
  TETO_DA_ABERTURA_MS,
  origemValida,
  type Onda,
  type Ponto,
} from '@/lib/session-gate';

import type { CortinaApi } from './session-curtain.types';

/** Quantas aberturas ganham o show (a MESMA chave de antes: o contador de quem já usa continua). */
const SHOWS = 5;
const CHAVE_SHOWS = 'proops.splash.shows';
/** Lado da marca — é o `imageWidth` do `expo-splash-screen` no app.json. Os dois PRECISAM bater. */
const LADO = 96;
/** Onde a tinta começa e termina dentro do PNG de 512 px (medido: 61..451). */
const TINTA = { de: (61 / 512) * LADO, ate: (451 / 512) * LADO };
/** Nasce no canto inferior esquerdo e termina no superior direito, onde a Fase 3 põe o canto. */
const ONDA_DA_ABERTURA: Onda = { mode: 'diagonal', origin: { x: 0, y: 1 } };
const ONDA_DO_SHOW: Onda = { mode: 'radial', origin: { x: 0.5, y: 0.5 } };
const TETO_DA_TEXTURA_MS = 300;
const TETO_DO_PNG_MS = 500;

type Fase = 'abertura' | 'cobrindo' | 'coberta' | 'revelando' | 'aberta';
type Show = 'completa' | 'curta';

const doisQuadros = () =>
  new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));
const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

const CortinaContext = createContext<CortinaApi | null>(null);
const AbertaContext = createContext(false);

export function useCortina(): CortinaApi {
  const cortina = useContext(CortinaContext);
  if (!cortina) throw new Error('useCortina precisa do CortinaProvider (raiz do app)');
  return cortina;
}

/** `true` quando a abertura já revelou e nada cobre a tela. */
export function useCortinaAberta(): boolean {
  return useContext(AbertaContext);
}

/**
 * A cortina de azulejos da raiz — a abertura do app e a passagem de toda troca de sessão.
 *
 * ## Uma camada, dona de um progresso
 *
 * `progresso` vai de 0 (coberto) a 1 (revelado) e é o único valor que anda. A camada só existe
 * enquanto cobre alguma coisa: aberta, ela desmonta — um canvas do tamanho da tela por cima do
 * app custaria composição em todo quadro de todas as telas.
 *
 * ## Por que `cobrir` espera a textura
 *
 * O `TileField` cria a textura das peças na thread de UI, um ou dois quadros depois de montar.
 * Andar o progresso antes disso não desenha nada: a cortina "chegaria" já fechada, de uma vez.
 * O teto (300 ms) garante que ela anda mesmo se a textura atrasar.
 *
 * ## O hand-off com o splash nativo
 *
 * O primeiro quadro da camada é o splash: tinta lisa (o `cover` do campo enquanto não há
 * textura) e o MESMO PNG, no MESMO tamanho. `hideAsync()` só roda depois que a camada fez layout
 * E o PNG carregou — sem isso o nativo sairia um quadro antes da marca existir, e a marca
 * piscaria. `fade: false` pelo mesmo motivo: um cross-fade do sistema por cima do nosso.
 *
 * ## Reduce Motion
 *
 * Sem onda e sem show: um véu de tinta que aparece e some em 200 ms.
 */
export function CortinaProvider({ children }: { children: ReactNode }) {
  const reduzido = useReducedMotion();
  const progresso = useSharedValue(0);
  const [fase, setFase] = useState<Fase>('abertura');
  const [onda, setOnda] = useState<Onda>(ONDA_DA_ABERTURA);
  const [invert, setInvert] = useState(false);
  const [show, setShow] = useState<Show | null>(null);
  const [pintada, setPintada] = useState(false);
  const [aberturaFeita, setAberturaFeita] = useState(false);

  const textura = useRef<{ pronta: boolean; avisar: (() => void) | null }>({
    pronta: false,
    avisar: null,
  });
  const pronto = useRef<{ valor: boolean; avisar: (() => void) | null }>({
    valor: false,
    avisar: null,
  });
  const origem = useRef<{ ponto: Ponto; em: number } | null>(null);
  const splash = useRef({ layout: false, png: false, escondido: false });

  const animar = useCallback(
    (alvo: 0 | 1, duracao: number) =>
      new Promise<void>((ok) => {
        progresso.set(
          withTiming(
            alvo,
            { duration: reduzido ? Motion.duration.base : duracao, easing: Easing.linear },
            () => {
              'worklet';
              // Resolve também quando é cancelada: quem espera é o portão, e ele não pode travar.
              runOnJS(ok)();
            }
          )
        );
      }),
    [progresso, reduzido]
  );

  const esperarTextura = useCallback(() => {
    if (reduzido || textura.current.pronta) return Promise.resolve();
    const espera = new Promise<void>((ok) => {
      textura.current.avisar = ok;
    });
    return comTeto(espera, TETO_DA_TEXTURA_MS, 'textura').catch(() => {});
  }, [reduzido]);

  const aoTexturaPronta = useCallback(() => {
    textura.current.pronta = true;
    textura.current.avisar?.();
    textura.current.avisar = null;
  }, []);

  const cobrir = useCallback(
    async (o: Onda) => {
      progresso.set(1);
      setOnda(o);
      setInvert(true);
      setFase('cobrindo');
      await doisQuadros();
      await esperarTextura();
      await animar(0, Motion.curtain.duration);
      setFase('coberta');
    },
    [animar, esperarTextura, progresso]
  );

  const descobrir = useCallback(
    async (o: Onda, duracao: number) => {
      setOnda(o);
      setInvert(false);
      setFase('revelando');
      // O React precisa aplicar a onda nova antes de o progresso andar: nos primeiros quadros a
      // ordem velha revelaria outros azulejos.
      await doisQuadros();
      await animar(1, duracao);
      textura.current.pronta = false;
      setFase('aberta');
    },
    [animar]
  );

  const abrirJa = useCallback(() => {
    cancelAnimation(progresso);
    progresso.set(1);
    textura.current.pronta = false;
    setFase('aberta');
    setAberturaFeita(true);
  }, [progresso]);

  const lembrarOrigem = useCallback((ponto: Ponto) => {
    origem.current = { ponto, em: Date.now() };
  }, []);

  const tomarOrigem = useCallback(() => {
    const ponto = origemValida(origem.current, Date.now());
    origem.current = null;
    return ponto;
  }, []);

  const marcarPronto = useCallback(() => {
    if (pronto.current.valor) return;
    pronto.current.valor = true;
    pronto.current.avisar?.();
  }, []);

  const esconderSplash = useCallback(() => {
    const s = splash.current;
    if (!s.layout || !s.png || s.escondido) return;
    s.escondido = true;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setPintada(true));
  }, []);

  useEffect(() => {
    SplashScreen.setOptions({ duration: 0, fade: false });
    // PNG que não carrega não pode segurar o app no splash.
    const t = setTimeout(() => {
      splash.current.png = true;
      esconderSplash();
    }, TETO_DO_PNG_MS);
    return () => clearTimeout(t);
  }, [esconderSplash]);

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(CHAVE_SHOWS)
      .then((v) => {
        const n = Number(v ?? 0);
        if (vivo) setShow(n < SHOWS ? 'completa' : 'curta');
        AsyncStorage.setItem(CHAVE_SHOWS, String(n + 1)).catch(() => {});
      })
      // Sem contador legível, a versão curta: errar para o lado de ser rápido.
      .catch(() => {
        if (vivo) setShow('curta');
      });
    return () => {
      vivo = false;
    };
  }, []);

  /*
    A abertura roda UMA vez, quando a camada pintou e o contador voltou do disco. O teto conta
    daqui: com o app pronto antes do show acabar, o show termina; com o app atrasado, o teto
    abre assim mesmo — tela de login atrasada é melhor que splash eterno.
  */
  const comecou = useRef(false);
  useEffect(() => {
    if (!pintada || show === null || comecou.current) return;
    comecou.current = true;
    const prontoOuTeto = comTeto(
      new Promise<void>((ok) => {
        if (pronto.current.valor) ok();
        else pronto.current.avisar = ok;
      }),
      TETO_DA_ABERTURA_MS,
      'abertura'
    ).catch(() => {});

    void (async () => {
      if (show === 'completa' && !reduzido) {
        await esperarTextura();
        setOnda(ONDA_DO_SHOW);
        await doisQuadros();
        progresso.set(
          withSequence(
            withTiming(0.16, { duration: 700, easing: Motion.easing.out }),
            withTiming(0, { duration: 700, easing: Motion.easing.inOut })
          )
        );
        await dormir(Motion.curtain.full);
      }
      await prontoOuTeto;
      await descobrir(
        ONDA_DA_ABERTURA,
        show === 'completa' ? Motion.curtain.duration : Motion.curtain.short
      );
      setAberturaFeita(true);
    })();
  }, [pintada, show, reduzido, esperarTextura, descobrir, progresso]);

  const api = useMemo<CortinaApi>(
    () => ({
      cobrir,
      revelar: (o) => descobrir(o, Motion.curtain.duration),
      abrirJa,
      lembrarOrigem,
      tomarOrigem,
      marcarPronto,
    }),
    [cobrir, descobrir, abrirJa, lembrarOrigem, tomarOrigem, marcarPronto]
  );

  return (
    <CortinaContext.Provider value={api}>
      <AbertaContext.Provider value={aberturaFeita && fase === 'aberta'}>
        {children}
        {fase === 'aberta' ? null : (
          <Camada
            fase={fase}
            onda={onda}
            invert={invert}
            progresso={progresso}
            reduzido={reduzido}
            show={aberturaFeita ? null : show}
            comMarca={!aberturaFeita}
            onTextura={aoTexturaPronta}
            onLayout={() => {
              splash.current.layout = true;
              esconderSplash();
            }}
            onPng={() => {
              splash.current.png = true;
              esconderSplash();
            }}
          />
        )}
      </AbertaContext.Provider>
    </CortinaContext.Provider>
  );
}

function Camada({
  fase,
  onda,
  invert,
  progresso,
  reduzido,
  show,
  comMarca,
  onTextura,
  onLayout,
  onPng,
}: {
  fase: Fase;
  onda: Onda;
  invert: boolean;
  progresso: SharedValue<number>;
  reduzido: boolean;
  show: Show | null;
  comMarca: boolean;
  onTextura: () => void;
  onLayout: () => void;
  onPng: () => void;
}) {
  const theme = useTheme();
  const veu = useAnimatedStyle(() => ({ opacity: 1 - progresso.get() }));

  return (
    <View
      onLayout={onLayout}
      // Enquanto cobre, a camada engole o toque (ela é o alvo, e não tem responder). Revelando,
      // o app de baixo já é o destino.
      pointerEvents={fase === 'revelando' ? 'none' : 'auto'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.camada}>
      {reduzido ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.tileInk }, veu]}
        />
      ) : (
        <>
          {/*
            Durante a abertura há tinta lisa POR TRÁS do campo: a ondulação do show vira os
            azulejos, e sem este fundo o app apareceria pelas frestas antes da hora.
          */}
          {fase === 'abertura' ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.tileInk }]} />
          ) : null}
          <TileField
            progress={progresso}
            mode={onda.mode}
            origin={onda.origin}
            invert={invert}
            cover
            onReady={onTextura}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}
      {comMarca ? (
        <MarcaDaAbertura progresso={progresso} show={show} onPng={onPng} reduzido={reduzido} />
      ) : null}
    </View>
  );
}

function MarcaDaAbertura({
  progresso,
  show,
  onPng,
  reduzido,
}: {
  progresso: SharedValue<number>;
  show: Show | null;
  onPng: () => void;
  reduzido: boolean;
}) {
  const theme = useTheme();
  const tracado = useSharedValue(0);
  const contorno = useMemo(
    () => markPathIn(TINTA.de, TINTA.de, TINTA.ate - TINTA.de, TINTA.ate - TINTA.de),
    []
  );

  useEffect(() => {
    if (show !== 'completa' || reduzido) return;
    tracado.set(withTiming(1, { duration: 1100, easing: Motion.easing.inOut }));
  }, [show, reduzido, tracado]);

  // O traço aparece inteiro e some no último terço — ele é um gesto, não um estado.
  const brilho = useDerivedValue(() => 1 - Math.max(0, (tracado.get() - 0.7) / 0.3));

  const sai = useAnimatedStyle(() => {
    const k = Math.min(1, progresso.get() / 0.25);
    return { opacity: 1 - k, transform: [{ scale: 1 - k * 0.08 }] };
  });

  return (
    <Animated.View style={[styles.marca, sai]} pointerEvents="none">
      <Image source={marcaBranca} onLoad={onPng} fadeDuration={0} style={styles.marca} />
      {show === 'completa' && !reduzido ? (
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          <Path
            path={contorno}
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
            color={theme.tintFill}
            start={0}
            end={tracado}
            opacity={brilho}
          />
        </SkiaCanvas>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  camada: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Acima da trava (900). `elevation` é o que ordena de verdade no Android.
    zIndex: 1000,
    elevation: 1000,
  },
  marca: { width: LADO, height: LADO },
});
```

Nota de verificação para o Step 9: se o `SkiaCanvas` exigir filhos só no primeiro render ou o
`Image` não aceitar `onLoad` com `fadeDuration`, a correção é na chamada, não no desenho.
`StyleSheet.absoluteFillObject` existe na 0.86 (`absoluteFill` é o registrado); se o `tsc`
recusar, use `...StyleSheet.absoluteFill`, como o resto do repo.

- [ ] **Step 4: web** — `src/components/motion/session-curtain.web.tsx`:

```tsx
import type { ReactNode } from 'react';

import type { CortinaApi } from './session-curtain.types';

/** No web não há splash nativo nem troca que precise esconder: a cortina é transparente. */
const SEM_CORTINA: CortinaApi = {
  cobrir: async () => {},
  revelar: async () => {},
  abrirJa: () => {},
  lembrarOrigem: () => {},
  tomarOrigem: () => null,
  marcarPronto: () => {},
};

export function CortinaProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useCortina(): CortinaApi {
  return SEM_CORTINA;
}

export function useCortinaAberta(): boolean {
  return true;
}
```

- [ ] **Step 5: splash nativo** — em `app.json`, o bloco do `expo-splash-screen` vira:

```json
      [
        "expo-splash-screen",
        {
          "backgroundColor": "#0D0D0C",
          "image": "./assets/images/brand/mark-white.png",
          "imageWidth": 96,
          "dark": {
            "backgroundColor": "#0D0D0C",
            "image": "./assets/images/brand/mark-white.png"
          }
        }
      ],
```

- [ ] **Step 6: raiz** — em `src/app/_layout.tsx`:
  - trocar `import { AnimatedSplashOverlay } from '@/components/animated-icon';` por
    `import { CortinaProvider, useCortina } from '@/components/motion/session-curtain';`;
  - em `RootLayout`, envolver `<AppTree />` com `<CortinaProvider>` (dentro do
    `AppThemeProvider`: a camada usa tema);
  - em `AppTree`, logo depois do `useSession()`:

```tsx
  /*
    A abertura revela quando fontes e sessão estão prontas (com teto dentro da cortina). A raiz
    só avisa; quem decide o tempo é a cortina.
  */
  const cortina = useCortina();
  const pronto = !loading && (fontsLoaded || !!fontError);
  useEffect(() => {
    if (pronto) cortina.marcarPronto();
  }, [pronto, cortina]);
```

  - apagar `<AnimatedSplashOverlay ready={!loading && fontsLoaded} />` e ajustar o comentário da
    trava ("Irmã do `AnimatedSplashOverlay`" → "abaixo da cortina de sessão, que é a camada 1000").

- [ ] **Step 7:** `git rm src/components/animated-icon.tsx src/components/animated-icon.web.tsx`
  e `grep -rn "animated-icon\|AnimatedSplashOverlay" src` → vazio (ajustar comentários que
  citem o nome antigo).

- [ ] **Step 8:** portão (`tsc`, `lint`, `npm test`).

- [ ] **Step 9: aparelho, JS primeiro** — com o build ANTIGO ainda instalado (splash branco/preto
  do tema), recarregar e conferir que a abertura curta revela o app e que nada fica preso por
  cima (tocar numa aba). O hand-off com o splash só é conferido depois do build nativo (Task 6).

- [ ] **Step 10:** commit `feat(motion): cortina de azulejos na abertura`

---

### Task 4: Sessão com fonte única e portão pela cortina

**Files:**
- Delete: `src/hooks/use-session.ts`
- Create: `src/hooks/use-session.tsx`
- Modify: `src/app/_layout.tsx` (`SessionProvider` na raiz)
- Modify: `src/lib/anti-slop.test.ts`

**Interfaces:**
- Consumes: `useCortina()` (Task 3), `precisaDeCortina`, `ondaDaTroca`, `TETO_DA_TROCA_MS`
  (Task 2), `comTeto`.
- Produces: `SessionProvider({ children })`; `useSession(): { session: Session | null; loading:
  boolean }` — MESMA forma de antes, agora a sessão MOSTRADA. Os sete consumidores
  (`index.tsx`, `_layout.tsx`, `link-email`, `link-phone`, `onboarding`, Hoje, Perfil,
  `profile/members`) não mudam.

- [ ] **Step 1: teste que falha** — em `src/lib/anti-slop.test.ts`, perto dos outros testes de
  arquitetura:

```ts
/**
 * A sessão tem UMA assinatura, e ela mora em `use-session.tsx`.
 *
 * Cada `useSession()` abria a própria assinatura do Supabase, e o portão de sessão depende de
 * que toda a árvore leia a sessão MOSTRADA — uma segunda assinatura trocaria a tela antes de a
 * cortina cobrir, e `accept_pending_invites` rodava uma vez por instância.
 */
test('nenhum onAuthStateChange fora de hooks/use-session.tsx', () => {
  const fora = offenders(/\bonAuthStateChange\s*\(/).filter(
    (achado) => !achado.startsWith('src/hooks/use-session.tsx:')
  );
  assert.deepEqual(fora, [], 'leia a sessão por useSession(): uma assinatura só, a do provider');
});
```

- [ ] **Step 2:** `node --test src/lib/anti-slop.test.ts` → FAIL (a assinatura ainda está em
  `use-session.ts`).

- [ ] **Step 3: o provider** — `git rm src/hooks/use-session.ts` e criar
  `src/hooks/use-session.tsx`:

```tsx
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useCortina } from '@/components/motion/session-curtain';
import { comTeto } from '@/lib/com-teto';
import { TETO_DA_TROCA_MS, ondaDaTroca, precisaDeCortina } from '@/lib/session-gate';
import { supabase } from '@/lib/supabase';

interface SessaoMostrada {
  session: Session | null;
  loading: boolean;
}

const SessionContext = createContext<SessaoMostrada | null>(null);

const doisQuadros = () =>
  new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));

/**
 * A sessão do app — uma assinatura só, e a sessão que ela entrega é a MOSTRADA.
 *
 * ## O portão
 *
 * O Supabase troca a sessão na hora; a tela não. Evento do mesmo usuário (refresh de token,
 * `USER_UPDATED`, os metadados que o onboarding grava) vale na hora. Usuário diferente — entrar,
 * sair, trocar de conta — cobre a tela, troca a sessão mostrada POR BAIXO da cortina (é aí que o
 * `Stack.Protected` desmonta uma pilha e monta a outra, e que o cache do TanStack é limpo), espera
 * dois quadros para a tela nova existir, e revela. A regra mora em `lib/session-gate.ts`.
 *
 * ## Nunca prende
 *
 * Cada passo tem teto de 1,5 s. A troca acontece mesmo se a animação falhar, e o revelar que
 * estoura o teto abre a cortina à força. As trocas entram numa fila: um segundo evento no meio
 * de uma troca espera a primeira terminar, em vez de mostrar a tela nova antes da hora.
 *
 * ## Convites
 *
 * `accept_pending_invites` roda na sessão inicial e em `SIGNED_IN` — uma vez, aqui. Quando cada
 * `useSession()` assinava por conta própria, ele rodava uma vez por tela montada.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const cortina = useCortina();
  const [estado, setEstado] = useState<SessaoMostrada>({ session: null, loading: true });
  /** O `user.id` da sessão mostrada (ou reservada para mostrar). `undefined` = ainda não resolveu. */
  const mostrado = useRef<string | null | undefined>(undefined);
  const fila = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let vivo = true;

    // Convite feito para o telefone de quem entrou vira acesso na hora do login. Best-effort.
    const aceitarConvites = () => {
      supabase.rpc('accept_pending_invites').then(({ error }) => {
        if (error) console.warn('accept_pending_invites:', error.message);
      });
    };

    const trocar = async (next: Session | null, depois: string | null) => {
      const onda = ondaDaTroca(depois, cortina.tomarOrigem());
      await comTeto(cortina.cobrir(onda), TETO_DA_TROCA_MS, 'cortina').catch(() => {});
      if (!vivo) return;
      setEstado({ session: next, loading: false });
      await doisQuadros();
      await comTeto(cortina.revelar(onda), TETO_DA_TROCA_MS, 'cortina').catch(() =>
        cortina.abrirJa()
      );
    };

    const receber = (next: Session | null) => {
      const depois = next?.user.id ?? null;
      const comCortina = precisaDeCortina(mostrado.current, depois);
      mostrado.current = depois;
      fila.current = fila.current
        .then(async () => {
          if (comCortina) await trocar(next, depois);
          else if (vivo) setEstado({ session: next, loading: false });
        })
        .catch(() => {});
    };

    supabase.auth.getSession().then(({ data }) => {
      receber(data.session);
      if (data.session) aceitarConvites();
    });
    const { data: assinatura } = supabase.auth.onAuthStateChange((event, next) => {
      receber(next);
      if (event === 'SIGNED_IN' && next) aceitarConvites();
    });
    return () => {
      vivo = false;
      assinatura.subscription.unsubscribe();
    };
  }, [cortina]);

  return <SessionContext.Provider value={estado}>{children}</SessionContext.Provider>;
}

export function useSession(): SessaoMostrada {
  const sessao = useContext(SessionContext);
  if (!sessao) throw new Error('useSession precisa do SessionProvider (raiz do app)');
  return sessao;
}
```

  Notas para quem implementa:
  - `receber` é chamado pelo `getSession` E pelo `INITIAL_SESSION` do `onAuthStateChange`. O
    primeiro a chegar resolve a abertura (`undefined` → direto); o segundo é o mesmo usuário e
    também passa direto. Não "otimize" tirando um dos dois: é o `getSession` que garante o
    `loading: false` em versões do supabase-js que não emitem `INITIAL_SESSION`.
  - `mostrado.current` é atualizado JÁ na chegada do evento, não no fim da troca: um
    `TOKEN_REFRESHED` que chega durante a cortina é do mesmo usuário e entra na fila sem abrir
    outra cortina.
  - O callback do `onAuthStateChange` não pode `await` nada (o supabase-js segura um lock ali):
    ele só enfileira.

- [ ] **Step 4: raiz** — em `src/app/_layout.tsx`, `import { SessionProvider } from
  '@/hooks/use-session';` (junto do `useSession`) e:

```tsx
    <GestureHandlerRootView>
      <AppThemeProvider>
        <CortinaProvider>
          <SessionProvider>
            <AppTree />
          </SessionProvider>
        </CortinaProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
```

  Atualizar o comentário do `RootLayout`: a ordem é tema → cortina (a camada usa tema) → sessão
  (o portão usa a cortina) → árvore. O efeito que limpa o `queryClient` na troca de usuário fica
  como está: ele lê a sessão MOSTRADA, que só muda com a cortina fechada.

- [ ] **Step 5:** `grep -rn "hooks/use-session" src` — conferir que todo import continua
  `@/hooks/use-session` (sem extensão) e que o dublê de `src/lib/refresh-consistency.test.ts`
  (`useSession: () => ({ session: null })`) segue válido.

- [ ] **Step 6:** portão → PASS (o teste do Step 1 fica verde).

- [ ] **Step 7:** commit `feat(auth): sessão com fonte única e troca pela cortina`

---

### Task 5: Trava em azulejos

**Files:**
- Modify: `src/constants/theme.ts` (`tilePaperMuted`; saem `auroraDeep`, `auroraGlow`,
  `auroraLift` e a menção a eles no comentário do topo)
- Rewrite: `src/components/ui/lock-overlay.tsx`
- Delete: `src/components/lock/aurora.tsx`, `src/components/lock/keyhole.tsx`

**Interfaces:**
- Consumes: `useLock()` (`locked`, `autenticar`, `comoAutentica`, `estado`), `TileField`,
  `quarterStep` (Task 1), `Mark`.
- Produces: `LockOverlay()` — mesma exportação, mesmo lugar na raiz.

**O desenho:** tinta de azulejos em tela cheia nos dois temas; no terço ótico, um azulejo azul
(`tintFill`, 112 dp, `Radius.sm`) com a espiral em `onTint`; abaixo, "App bloqueado" e a frase de
estado em papel. Autenticando: o azulejo gira em quartos de volta. Falhou: tranco lateral e um
fio de 2 px em `danger` em volta do azulejo (estado não é só movimento). Destravou: o conteúdo
some no primeiro terço e a onda radial sai do centro; ao terminar, a trava desmonta. Voltar a
trancar no meio da saída cobre de novo.

- [ ] **Step 1: tokens** — em `src/constants/theme.ts`, nos dois blocos, logo depois de
  `tilePaper`:

```ts
    /** O texto secundário SOBRE a tinta dos azulejos — a trava é tinta nos dois temas. */
    tilePaperMuted: 'rgba(242, 243, 241, 0.64)',
```

  e apagar as três linhas `aurora*` de cada bloco. `node --test src/design/contrast.test.ts`
  continua verde (as chaves seguem iguais nos dois temas).

- [ ] **Step 2: a trava** — reescrever `src/components/ui/lock-overlay.tsx`:

```tsx
/**
 * A cortina de bloqueio — abaixo da cortina de sessão (900 < 1000), acima de todo o resto.
 *
 * ⚠️ **Ela fica DEPOIS do `Stack.Protected` do `useSession`**: sem sessão não há o que trancar, e
 * a porta de entrada continua sendo o login. Esta trava protege quem já entrou.
 *
 * ⚠️ **Não há teclado aqui, e isso é o ponto.** Quem pede a senha é o SISTEMA, no prompt dele —
 * esta tela é a cortina que esconde o conteúdo enquanto isso, o objeto que conta em que ponto a
 * autenticação está, e o caminho de volta se a pessoa cancelar.
 *
 * ## O mundo Concreto
 *
 * Campo de azulejos em tinta nos dois temas e UM azulejo azul com a espiral: é o mesmo gesto da
 * abertura, parado. O azulejo é a ação (132 → 112 dp, ainda duas vezes e meia o alvo mínimo) e
 * conta o estado sozinho — gira enquanto o sistema confere, treme e ganha um fio vermelho quando
 * falha. Destravar abre a onda a partir dele.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TileField } from '@/components/motion/tile-field';
import { ThemedText } from '@/components/themed-text';
import { Mark } from '@/components/ui/mark';
import { quarterStep } from '@/design/tile-math';
import { Motion, Radius, Space } from '@/design/tokens';
import { useLock } from '@/hooks/use-lock';
import { useTheme } from '@/hooks/use-theme';

type EstadoDaTrava = ReturnType<typeof useLock>['estado'];

const CENTRO = { x: 0.5, y: 0.5 };
const AZULEJO = 112;
const MARCA = 52;
/** Um quarto de volta a cada passo enquanto o sistema confere. */
const PASSO_MS = 520;

/**
 * Casca de montagem. A trava fica montada enquanto está trancada E enquanto sai — a onda de
 * saída precisa da cortina viva. Montar é ajuste de estado no render (padrão do React), não
 * efeito: o lint barra `setState` síncrono em `useEffect`, e com razão.
 */
export function LockOverlay() {
  const { locked } = useLock();
  const [montada, setMontada] = useState(locked);
  if (locked && !montada) setMontada(true);
  const aoSair = useCallback(() => setMontada(false), []);
  if (!montada) return null;
  return <Cortina saindo={!locked} onSaiu={aoSair} />;
}

/**
 * A frase conta o ESTADO e diz o que fazer; o título fica parado (design §7: identificador é
 * estável). Ela é a única coisa que ensina o gesto — por isso o verbo "Toque".
 */
const FRASES = {
  trancado: (como: string) => `Toque para usar ${como}.`,
  autenticando: () => 'Confirmando…',
  falhou: (como: string) => `Não reconheci. Toque para tentar de novo com ${como}.`,
} as const;

function Cortina({ saindo, onSaiu }: { saindo: boolean; onSaiu: () => void }) {
  const { autenticar, comoAutentica, estado } = useLock();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduzido = useReducedMotion();
  const progresso = useSharedValue(0);

  /*
    O prompt é pedido assim que a cortina aparece. A guarda de reentrância mora no HOOK
    (`autenticar` recusa a segunda chamada em voo) — é o que torna isto seguro sob o StrictMode.
  */
  useEffect(() => {
    void autenticar();
  }, [autenticar]);

  useEffect(() => {
    if (!saindo) {
      progresso.set(withTiming(0, { duration: Motion.duration.base }));
      return;
    }
    const duracao = reduzido ? Motion.duration.base : Motion.curtain.duration;
    progresso.set(
      withTiming(1, { duration: duracao, easing: Easing.linear }, (fim) => {
        'worklet';
        if (fim) runOnJS(onSaiu)();
      })
    );
    // Se o callback da animação não vier, a trava sai do mesmo jeito: modal preso é pior que corte.
    const teto = setTimeout(onSaiu, duracao + 400);
    return () => clearTimeout(teto);
  }, [saindo, reduzido, progresso, onSaiu]);

  const conteudo = useAnimatedStyle(() => {
    const k = Math.min(1, progresso.get() / 0.3);
    return { opacity: 1 - k, transform: [{ scale: 1 - k * 0.12 }] };
  });
  const veu = useAnimatedStyle(() => ({ opacity: 1 - progresso.get() }));

  return (
    <View
      accessibilityViewIsModal={!saindo}
      pointerEvents={saindo ? 'none' : 'auto'}
      style={[
        styles.tudo,
        {
          paddingTop: insets.top + Space.xl,
          // `Math.max`, não soma: com navegação por gestos o inset do Android volta 0.
          paddingBottom: Math.max(insets.bottom, Space.xxl),
        },
      ]}>
      {reduzido ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.tileInk }, veu]}
        />
      ) : (
        <TileField
          progress={progresso}
          mode="radial"
          origin={CENTRO}
          cover
          style={StyleSheet.absoluteFill}
        />
      )}

      <View style={styles.folga} />

      {/* Terço ótico: 2 em cima, 3 embaixo — o centro geométrico lê baixo demais. */}
      <Animated.View style={[styles.centro, conteudo]}>
        <AzulejoDaTrava estado={estado} onPress={() => void autenticar()} />
        <Animated.View
          entering={FadeIn.delay(140).duration(Motion.duration.slow)}
          style={styles.dizeres}>
          <ThemedText type="title" themeColor="tilePaper" style={styles.titulo}>
            App bloqueado
          </ThemedText>
          {/* `key={estado}`: a troca de frase é um corte com fade, não texto mudando sob o olho. */}
          <Animated.View key={estado} entering={FadeIn.duration(Motion.duration.base)}>
            <ThemedText type="footnote" themeColor="tilePaperMuted" style={styles.centrado}>
              {FRASES[estado](comoAutentica)}
            </ThemedText>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      <View style={styles.folgaBaixa} />
    </View>
  );
}

/** O que o leitor de tela anuncia. A tela escreve a instrução; aqui fica o VERBO. */
const ROTULO: Record<EstadoDaTrava, string> = {
  trancado: 'Desbloquear',
  autenticando: 'Confirmando',
  falhou: 'Tentar de novo',
};

function AzulejoDaTrava({ estado, onPress }: { estado: EstadoDaTrava; onPress: () => void }) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const relogio = useSharedValue(0);
  const tranco = useSharedValue(0);
  const alerta = useSharedValue(0);
  const toque = useSharedValue(1);

  useEffect(() => {
    if (estado !== 'autenticando' || reduzido) {
      cancelAnimation(relogio);
      // Assenta no quarto de volta mais próximo: o azulejo nunca para torto.
      relogio.set(withTiming(Math.round(relogio.get()), { duration: Motion.duration.base }));
      return;
    }
    const inicio = Math.round(relogio.get());
    relogio.set(inicio);
    relogio.set(
      withRepeat(
        withTiming(inicio + 4, { duration: PASSO_MS * 4, easing: Easing.linear }),
        -1,
        false
      )
    );
    return () => cancelAnimation(relogio);
  }, [estado, reduzido, relogio]);

  useEffect(() => {
    alerta.set(
      withTiming(estado === 'falhou' ? 1 : 0, {
        duration: estado === 'falhou' ? Motion.duration.fast : Motion.duration.base,
      })
    );
    if (estado !== 'falhou' || reduzido) return;
    // Amplitude decrescente: lê como "bateu e voltou", a física de uma porta que não abriu.
    tranco.set(
      withSequence(
        withTiming(-9, { duration: 48 }),
        withTiming(6, { duration: 60 }),
        withTiming(-3, { duration: 56 }),
        withTiming(0, { duration: 72, easing: Motion.easing.out })
      )
    );
  }, [estado, reduzido, alerta, tranco]);

  const azulejo = useAnimatedStyle(() => ({
    transform: [
      { translateX: tranco.get() },
      { scale: toque.get() },
      { rotate: `${quarterStep(relogio.get()) * 90}deg` },
    ],
  }));
  const fio = useAnimatedStyle(() => ({ opacity: alerta.get() }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ROTULO[estado]}
      accessibilityState={{ busy: estado === 'autenticando' }}
      disabled={estado === 'autenticando'}
      hitSlop={Space.md}
      onPressIn={() => toque.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
      onPressOut={() => toque.set(withTiming(1, { duration: Motion.duration.fast }))}
      onPress={onPress}
      style={styles.palco}>
      <Animated.View
        pointerEvents="none"
        style={[styles.fio, { borderColor: theme.danger }, fio]}
      />
      <Animated.View style={[styles.azulejo, { backgroundColor: theme.tintFill }, azulejo]}>
        <Mark size={MARCA} color="onTint" />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tudo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    /*
      ⚠️ `zIndex` sozinho NÃO cobre a pilha nativa no Android (medido em 14/09/2026: o app
      continuava clicável por baixo). `elevation` ordena de verdade; 900 fica abaixo da cortina
      de sessão (1000), que precisa cobrir a abertura.
    */
    zIndex: 900,
    elevation: 900,
    alignItems: 'center',
    paddingHorizontal: Space.lg,
  },
  folga: { flex: 2 },
  folgaBaixa: { flex: 3 },
  centro: { alignItems: 'center', gap: Space.xl },
  dizeres: { alignItems: 'center', gap: Space.xs, maxWidth: 320 },
  centrado: { textAlign: 'center' },
  /*
    ⚠️ `flexShrink: 0`, MEDIDO no APK de release (15/09/2026): dentro de contêiner com
    `entering`, o título saía "App" — o texto medido enquanto o bloco chega encolhe e não se
    remede. Título é identificador: quem cede é o layout.
  */
  titulo: { textAlign: 'center', flexShrink: 0 },
  palco: {
    width: AZULEJO + Space.md * 2,
    height: AZULEJO + Space.md * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  azulejo: {
    width: AZULEJO,
    height: AZULEJO,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** O fio de falha fica PARADO enquanto o azulejo treme: o estado não depende do movimento. */
  fio: {
    position: 'absolute',
    width: AZULEJO + Space.md,
    height: AZULEJO + Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 2,
  },
});
```

- [ ] **Step 3:** `git rm src/components/lock/aurora.tsx src/components/lock/keyhole.tsx`;
  `grep -rn "lock/aurora\|lock/keyhole\|Keyhole\|Aurora\b\|aurora" src` → só comentários
  históricos fora de código (ajustar os que apontarem para arquivo que não existe mais, como o
  de `hero-panel.tsx`/`theme.ts`).

- [ ] **Step 4:** portão (`tsc`, `lint`, `npm test`).

- [ ] **Step 5:** commit `feat(lock): trava em azulejos com o azulejo da marca`

---

### Task 6: Builds nativos e verificação nos dois aparelhos

O splash é nativo: sem build novo, o primeiro quadro ainda é o fundo do tema, e o hand-off não
pode ser julgado.

- [ ] **Step 1: Android** — `npx expo prebuild -p android --no-install` → conferir
  `android/app/src/main/res/values/colors.xml` (`splashscreen_background` = `#0D0D0C`) e o
  `values-night` igual; `npx expo run:android --no-bundler` (o Metro já roda). Provar o pacote:
  `adb shell dumpsys activity activities | grep topResumedActivity` →
  `com.proops.personal.dev`.

- [ ] **Step 2: iOS** — conferir qual bundle está no simulador
  (`xcrun simctl listapps booted | grep -o 'com.proops.personal[a-z.]*'`) e qual o prebuild gera
  (`grep PRODUCT_BUNDLE_IDENTIFIER ios/*.xcodeproj/project.pbxproj | head -2`). `pod` vem do
  Homebrew; se o build morrer em "[Hermes] Replace Hermes", `ios/.xcode.env.local` precisa de
  `export NODE_BINARY=/opt/homebrew/bin/node`. `npx expo prebuild -p ios --no-install`,
  `npx expo run:ios --no-bundler`. Com dois apps no simulador, abrir por
  `xcrun simctl launch booted <bundle>`, nunca por `openurl` (o scheme é o mesmo).

- [ ] **Step 3: abertura completa** — zerar o contador e gravar a abertura a frio nos dois:
  - iOS: app fechado; em `$(xcrun simctl get_app_container booted <bundle> data)/Library/Application Support/<bundle>/RCTAsyncLocalStorage_V1/manifest.json`
    gravar `"proops.splash.shows": "0"` (string crua).
  - Android: `adb shell am force-stop com.proops.personal.dev`;
    `adb exec-out run-as com.proops.personal.dev cat databases/RKStorage > rk.db`;
    `sqlite3 rk.db "update catalystLocalStorage set value='0' where key='proops.splash.shows'"`;
    `cat rk.db | adb shell run-as com.proops.personal.dev sh -c 'cat > databases/RKStorage'`.
  - gravar (`dev.sh rec`), extrair quadros (`dev.sh frames`) e conferir: **nenhum quadro de cor
    errada** entre o splash nativo e a camada; a marca não pisca nem salta de tamanho; o traço
    azul corre por cima do contorno do PNG; a ondulação mostra motivos em volta sem abrir frestas
    para o app; a onda diagonal nasce embaixo à esquerda.
  - Se a marca saltar no hand-off, medir o salto no quadro e corrigir `LADO`/`TINTA` (não o
    desenho).

- [ ] **Step 4: abertura curta** — contador em `9`; a frio: a onda sai assim que o app está
  pronto, em 600 ms; nada fica por cima (tocar numa aba responde).

- [ ] **Step 5: sair e entrar** (conta de teste do staging, `dev@proops.local` pelo botão "Entrar
  como teste (dev)"): Perfil → Sair → a cortina sobe de baixo, o login aparece por baixo dela e
  ela revela subindo. Entrar como teste → a cortina desce do topo e revela a Hoje. Gravar os dois
  nos dois aparelhos; nenhum quadro da Hoje antes de cobrir, nenhum quadro do login depois de
  revelar. `adb shell dumpsys gfxinfo com.proops.personal.dev reset` antes e o relatório depois:
  quadros atrasados abaixo de 10%.

- [ ] **Step 6: trava** — Android: `adb shell locksettings set-pin --old 1234 1234` (ou sem
  `--old` se não houver credencial); ligar a trava no Perfil; ir para o fundo e voltar →
  prompt do sistema aparece sozinho; cancelar → a frase vira "Não reconheci…", o azulejo treme e
  ganha o fio vermelho; tocar no azulejo → prompt de novo; digitar o PIN
  (`adb shell input text 1234 && adb shell input keyevent 66`) → a onda sai do centro e o app
  responde ao toque logo depois. iOS: *Features → Face ID → Enrolled* e
  `xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit_Sim.pearl.match` (ou
  `.nomatch`). Conferir o inventário da Regra 0 da trava: prompt automático, toque para tentar de
  novo, frase de estado, título inteiro "App bloqueado".

- [ ] **Step 7: abrir com a trava ligada** — a frio, com a trava ligada: a cortina de abertura
  revela e por baixo já está a trava (tinta sobre tinta, sem salto); o prompt aparece.

- [ ] **Step 8: Reduce Motion** — Android `adb shell settings put global
  animator_duration_scale 0`; iOS `xcrun simctl spawn booted defaults write
  com.apple.Accessibility ReduceMotionEnabled -bool true` e reabrir o app. Abertura, sair/entrar
  e trava viram véu de 200 ms, sem onda e sem giro; nada fica preso. Devolver os dois.

- [ ] **Step 9: claro e escuro, 384dp × 1,3** — a trava em claro e escuro (é tinta nos dois);
  `adb shell wm density 560 && adb shell settings put system font_scale 1.30`, reabrir A FRIO,
  conferir a trava inteira (título sem corte, frase quebrando linha); devolver com
  `adb shell wm density reset && adb shell settings put system font_scale 1.0`.

- [ ] **Step 10:** corrigir o que aparecer num lote, repetir as capturas afetadas uma vez,
  portão, commit `fix(motion): ajustes da verificação da fase 2` se houver mudança.
