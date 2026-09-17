# Hoje e Financeiro — "Conversa organizada" — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refazer a Hoje e o Financeiro na estrutura "Conversa organizada", com um kit de cards e gráficos reaproveitável pelas outras raízes, e o balão com o texto real que a pessoa mandou.

**Architecture:** Primitivos novos em `src/components/ui/` (cards e gráficos) e `src/components/feed/` (conversa e agenda); aritmética pura em `src/lib/` e `src/design/` com `node --test`; as telas só compõem. O balão lê `public.agent_activity` (migration nova no staging), alimentada pelo agente, que passa a gravar dono e texto de origem em `executed_actions`. A Pista lê `public.spendable_path`, a mesma lista de eventos que produz o número "livre".

**Tech Stack:** Expo SDK 57, expo-router, React Native 0.86, Reanimated 4.5, Gesture Handler 2.32, Skia 2.6, TanStack Query 5, Supabase Postgres, FastAPI/LangGraph (Python 3.12).

**Spec:** `docs/superpowers/specs/2026-09-17-hoje-financeiro-conversa-design.md`

## Global Constraints

- Nenhuma biblioteca nova.
- Cor só por `useTheme()`; token novo nasce em `src/constants/theme.ts` com par `light` e `dark`. Zero hex/`rgba` fora de `theme.ts` e `card-brands.ts`.
- Texto só por `ThemedText type=…`; zero `fontSize` e zero `fontWeight` soltos.
- Raio só por `Radius`, espaço só por `Space`, movimento só por `Motion`. `borderCurve: 'continuous'` em todo canto.
- Canvas do Skia só por `SkiaCanvas` (`src/components/ui/skia-canvas.tsx`); `Canvas` não aceita `onLayout` — quem mede é uma `View` em volta.
- Dinheiro visível só por `Money` / `CountUpMoney` / `useBRL()`; sempre centavos inteiros.
- Nada trunca (`numberOfLines` proibido fora da allowlist); o texto quebra e o layout cede. Texto dentro de `Animated.View` com `entering` leva `flexShrink: 0`.
- `withSpring`/`withTiming` só como valor DIRETO da propriedade (nunca `withSpring(a) * b`).
- `createAnimatedComponent(Pressable)` só com estilo estático (usar `PressableScale`).
- Barra/anel nasce no valor real e anima só quando o valor muda. Reduzir Movimento: sem trajeto.
- Animação presa a chegada nova NUNCA toca no mount.
- `useTelaPronta` só recebe consultas (nunca `.pronto`, `true`, `false`, `!x`).
- Ícone novo = entrada no mapa `MATERIAL` de `src/components/ui/icon.tsx` (o `icon-map.test.ts` quebra).
- Supabase: só STAGING (`--project-ref utkqoiigimqzeenxkxdl`). Produção nunca. Antes de `db push`: `./scripts/supabase-target.sh`.
- Commits: conventional, UMA linha, SEM `Co-Authored-By`. Sem tag. Sem push.
- Portão antes de cada commit: `npx tsc --noEmit`, `npx expo lint`, `npm test` (olhar o código de saída). Tocou `agent/`: `cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest`.
- Cada fase fecha no simulador iOS (iPhone 17 Pro, `F0BDF23C-0286-4183-97E3-3BCC61D4267D`) e no emulador Android (`s26`), claro e escuro, e em 384dp × fonte 1,3 no Android (`adb shell wm density 560 && adb shell settings put system font_scale 1.30`; devolver `480`/`1.0` depois). Login `dev@proops.local` (botão "Entrar como teste (dev)").

## Mapa de arquivos

| arquivo | fase | responsabilidade |
|---|---|---|
| `src/constants/theme.ts` | 1 | tokens `bubble`, `onBubble`, `rail`, `heroGlow`, `heroGlowClear`, `chart1..6` |
| `src/lib/dates.ts` | 1 | `diaCurtoBR`, `rotuloDoDia`, `horaBR`, `emQuantoTempo` |
| `src/lib/setup-steps.ts` | 1 | passos de configuração a partir de dado real |
| `src/lib/runway.ts` | 1 | a Pista: entalhes, identidade com o herói, fração, entalhe mais próximo |
| `src/lib/today-sections.ts` | 1 | agenda da Hoje: Agora × Próximos dias, texto e tom de cada item |
| `src/lib/budget-tight.ts` | 1 | orçamentos no limite (régua única das duas raízes) |
| `src/lib/agent-prompts.ts` | 1 | frases de exemplo do agente (Hoje e aba Agente) |
| `src/components/ui/screen-scroll.tsx` | 1 | contexto com o deslocamento da rolagem da tela |
| `src/components/ui/screen.tsx` | 1 | provê a rolagem; prop `overlay` |
| `src/components/ui/ink-surface.tsx` | 1 | tinta viva (luz que segue a rolagem + grão) |
| `src/components/ui/hero-panel.tsx` | 1 | `surface="live"`; gráfico fora da área tocável |
| `src/components/ui/block-header.tsx` | 1 | cabeçalho de bloco |
| `src/components/ui/tile.tsx` | 1 | `Tile`, `TileRow`, `TileGrid` |
| `src/components/ui/ring-gauge.tsx` | 1 | anel |
| `src/components/ui/runway-bar.tsx` | 1 | a Pista, arrastável |
| `src/components/ui/day-rail.tsx` | 1 | trilho por dia |
| `src/components/feed/agenda-item.tsx` | 1 | card de conta/entrada/compra com ação |
| `src/components/feed/setup-checklist.tsx` | 1 | Primeiros passos |
| `src/components/feed/agent-prompt.tsx` | 1 | "Diga ao agente…" |
| `src/components/feed/reminder-timeline.tsx` | 1 | lembretes em linha do tempo |
| `src/components/finance/budget-rings.tsx` | 1 | anéis de orçamento |
| `src/hooks/use-setup-progress.ts` | 1 | compõe perfil, contas e lançamento |
| `src/app/(tabs)/today/index.tsx` | 1, 2 | a Hoje |
| `src/lib/simple-finance-ui.test.ts` | 1, 2, 3 | harness + testes das raízes |
| `supabase/migrations/20260918120000_a_conversa_que_virou_registro.sql` | 2 | colunas, retropreenchimento, `agent_activity`, `spendable_path` |
| `supabase/tests/agent_activity.sql` | 2 | isolamento, apagado, lote, identidade da Pista |
| `agent/app/db.py`, `agent/app/tools/registry.py` | 2 | reserva grava dono e origem |
| `src/lib/activity-feed.ts` | 2 | linhas do RPC → pares balão→card |
| `src/hooks/use-agent-activity.ts` | 2 | `useAgentActivity` |
| `src/hooks/use-finance.ts` | 2 | `useSpendablePath` |
| `src/components/feed/message-bubble.tsx` | 2 | balão |
| `src/components/feed/record-card.tsx` | 2 | registro que a fala virou |
| `src/components/feed/conversation-feed.tsx` | 2 | pares + fio + encaixe |
| `src/design/sparkline-geometry.ts` | 3 | escala da série compartilhada |
| `src/components/ui/scrub-chart.tsx` | 3 | gráfico arrastável |
| `src/design/donut-math.ts` | 3 | fatias da rosca |
| `src/components/ui/donut-chart.tsx` | 3 | rosca |
| `src/components/ui/ledger-row.tsx` | 3 | linha de lançamento |
| `src/components/ui/extended-fab.tsx` | 3 | FAB que recolhe |
| `src/components/finance/trend-card.tsx` | 3 | tendência com seleção |
| `src/components/finance/spending-donut.tsx` | 3 | "Para onde foi" |
| `src/components/finance/month-picker.tsx`, `period-bar.tsx` | 3 | variante `bare` |
| `src/app/(tabs)/finance/index.tsx` | 3 | o Financeiro |
| `src/components/ui/row.tsx` | 4 | `Section heading="block"` |
| `src/app/(tabs)/notes/index.tsx`, `profile/index.tsx`, `agent/index.tsx` | 4 | adotam o kit |

---

# Fase 1 — Kit base e a Hoje

### Task 1: Tokens e datas

**Files:**
- Modify: `src/constants/theme.ts` (blocos `light` e `dark` de `Colors`)
- Modify: `src/design/contrast.test.ts` (lista `PARES`)
- Modify: `src/lib/dates.ts` (fim do arquivo)
- Test: `src/lib/dates.test.ts`

**Interfaces:**
- Produces: tokens `bubble`, `onBubble`, `rail`, `heroGlow`, `heroGlowClear`, `chart1`…`chart6`; `diaCurtoBR(iso: string): string`, `rotuloDoDia(iso: string, hoje?: string): string`, `horaBR(iso: string | null | undefined): string`, `emQuantoTempo(iso: string, agora: number): string`.

- [ ] **Step 1: Escrever os testes que falham** — acrescentar ao fim de `src/lib/dates.test.ts` (e os quatro nomes no `import { … } from './dates.ts'` do topo):

```ts
test('diaCurtoBR escreve o dia da semana e o mês abreviados', () => {
  assert.equal(diaCurtoBR('2026-09-17'), 'qui, 17 set');
  assert.equal(diaCurtoBR('2026-01-04'), 'dom, 4 jan');
});

test('rotuloDoDia usa palavra perto de hoje e a data curta longe', () => {
  assert.equal(rotuloDoDia('2026-09-17', '2026-09-17'), 'hoje');
  assert.equal(rotuloDoDia('2026-09-18', '2026-09-17'), 'amanhã');
  assert.equal(rotuloDoDia('2026-09-16', '2026-09-17'), 'ontem');
  assert.equal(rotuloDoDia('2026-09-19', '2026-09-17'), 'sáb, 19 set');
});

test('horaBR não inventa hora', () => {
  assert.equal(horaBR(null), '—');
  assert.equal(horaBR('lixo'), '—');
  const d = new Date(2026, 8, 17, 9, 5);
  assert.equal(horaBR(d.toISOString()), '09:05');
});

test('emQuantoTempo fala em minutos até uma hora e em horas depois', () => {
  const agora = new Date(2026, 8, 17, 9, 0).getTime();
  assert.equal(emQuantoTempo(new Date(2026, 8, 17, 9, 20).toISOString(), agora), 'em 20 min');
  assert.equal(emQuantoTempo(new Date(2026, 8, 17, 9, 0, 20).toISOString(), agora), 'em 1 min');
  assert.equal(emQuantoTempo(new Date(2026, 8, 17, 11, 40).toISOString(), agora), 'em 3 h');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/dates.test.ts`
Expected: FAIL — `diaCurtoBR is not a function` (ou erro de import).

- [ ] **Step 3: Implementar** — acrescentar ao fim de `src/lib/dates.ts`:

```ts
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

/**
 * `2026-09-17` → `qui, 17 set`.
 *
 * Calendário puro, sem `Intl`: o Hermes não garante o locale pt-BR em todo Android, e a data
 * da agenda não pode sair em inglês num aparelho e em português no outro.
 */
export function diaCurtoBR(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const semana = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS_CURTOS[semana]}, ${d} ${MESES_CURTOS[m - 1]}`;
}

/** Como a agenda chama um dia: `hoje`, `amanhã`, `ontem` ou a data curta. */
export function rotuloDoDia(iso: string, hoje = localISODate()): string {
  const delta = diasAte(iso, hoje);
  if (delta === 0) return 'hoje';
  if (delta === 1) return 'amanhã';
  if (delta === -1) return 'ontem';
  return diaCurtoBR(iso);
}

/** `HH:MM` local de um timestamp ISO. Vazio ou inválido vira travessão, nunca "NaN:NaN". */
export function horaBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return timeBR(d);
}

/** "em 20 min" / "em 3 h" — a distância até o próximo lembrete, sem fingir precisão de segundos. */
export function emQuantoTempo(iso: string, agora: number): string {
  const minutos = Math.round((new Date(iso).getTime() - agora) / 60000);
  if (minutos < 60) return `em ${Math.max(1, minutos)} min`;
  return `em ${Math.round(minutos / 60)} h`;
}
```

- [ ] **Step 4: Tokens** — em `src/constants/theme.ts`, no FIM do bloco `light` (antes do `},` que fecha `light`):

```ts
    /** O balão de fala da pessoa na Hoje: tinta cheia, texto invertido. */
    bubble: '#0B0B0C',
    onBubble: '#F4F4F2',
    /** O trilho vertical das agendas e da linha do tempo. */
    rail: 'rgba(11, 11, 12, 0.10)',
    /** A luz da tinta viva do herói, e o mesmo branco sem opacidade para o degradê. */
    heroGlow: 'rgba(255, 255, 255, 0.16)',
    heroGlowClear: 'rgba(255, 255, 255, 0)',
    /** Escala tonal de tinta para parte-do-todo (a rosca). Do mais forte ao mais leve. */
    chart1: '#0B0B0C',
    chart2: '#3A3A3E',
    chart3: '#6B6B70',
    chart4: '#9B9BA0',
    chart5: '#C7C6C0',
    chart6: '#DDDCD7',
```

e no FIM do bloco `dark`:

```ts
    bubble: '#F4F4F2',
    onBubble: '#0B0B0C',
    rail: 'rgba(244, 244, 242, 0.12)',
    heroGlow: 'rgba(255, 255, 255, 0.11)',
    heroGlowClear: 'rgba(255, 255, 255, 0)',
    chart1: '#F4F4F2',
    chart2: '#C7C6C0',
    chart3: '#9B9BA0',
    chart4: '#6B6B70',
    chart5: '#4A4A4F',
    chart6: '#303034',
```

Em `src/design/contrast.test.ts`, acrescentar à lista `PARES`:

```ts
  ['onBubble', 'bubble', 7],
```

- [ ] **Step 5: Rodar**

Run: `node --test src/lib/dates.test.ts src/design/contrast.test.ts && npx tsc --noEmit`
Expected: PASS, tsc limpo.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts src/constants/theme.ts src/design/contrast.test.ts
git commit -m "feat(design): tokens da conversa e datas curtas da agenda"
```

---

### Task 2: Passos de configuração, orçamentos no limite e exemplos do agente

**Files:**
- Create: `src/lib/setup-steps.ts`, `src/lib/setup-steps.test.ts`
- Create: `src/lib/budget-tight.ts`, `src/lib/budget-tight.test.ts`
- Create: `src/lib/agent-prompts.ts`
- Modify: `src/app/(tabs)/agent/index.tsx:33-37` (troca `PROMPTS` pelo import)

**Interfaces:**
- Produces:
  - `type PassoId = 'whatsapp' | 'conta' | 'lancamento'`; `type Passo = { id: PassoId; titulo: string; feito: boolean; href: '/link-phone' | '/finance/accounts' | '/agent/new' }`
  - `passosDeConfiguracao(i: { telefone: string | null | undefined; contas: number; temLancamento: boolean }): Passo[]`
  - `progresso(passos: readonly Passo[]): { feitos: number; total: number; completo: boolean }`
  - `type OrcamentoLinha = { category: string; limit_cents: number | string; spent_cents: number | string; committed_cents?: number | string | null }`
  - `type OrcamentoApertado = { categoria: string; limite: number; gasto: number; fracaoGasta: number; restante: number; estourou: boolean }`
  - `orcamentosApertados(linhas: readonly OrcamentoLinha[], limiar?: number): OrcamentoApertado[]`
  - `EXEMPLOS_DO_AGENTE: readonly string[]`

- [ ] **Step 1: Testes que falham** — `src/lib/setup-steps.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passosDeConfiguracao, progresso } from './setup-steps.ts';

test('usuário novo tem os três passos abertos', () => {
  const passos = passosDeConfiguracao({ telefone: null, contas: 0, temLancamento: false });
  assert.deepEqual(passos.map((p) => p.id), ['whatsapp', 'conta', 'lancamento']);
  assert.deepEqual(progresso(passos), { feitos: 0, total: 3, completo: false });
});

test('telefone em branco não conta como WhatsApp ligado', () => {
  const [whatsapp] = passosDeConfiguracao({ telefone: '   ', contas: 0, temLancamento: false });
  assert.equal(whatsapp.feito, false);
});

test('com tudo feito o progresso é completo', () => {
  const passos = passosDeConfiguracao({ telefone: '+5511999999999', contas: 2, temLancamento: true });
  assert.deepEqual(progresso(passos), { feitos: 3, total: 3, completo: true });
});
```

`src/lib/budget-tight.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orcamentosApertados } from './budget-tight.ts';

test('o aviso conta o comprometido, o número mostrado é só o gasto', () => {
  const [a] = orcamentosApertados([
    { category: 'alimentação', limit_cents: 200000, spent_cents: 150000, committed_cents: 30000 },
  ]);
  assert.equal(a.categoria, 'alimentação');
  assert.equal(a.fracaoGasta, 0.75);
  assert.equal(a.restante, 50000);
  assert.equal(a.estourou, false);
});

test('abaixo do limiar não entra; sem limite não entra', () => {
  assert.deepEqual(
    orcamentosApertados([
      { category: 'lazer', limit_cents: 100000, spent_cents: 10000, committed_cents: 0 },
      { category: 'casa', limit_cents: 0, spent_cents: 90000 },
    ]),
    []
  );
});

test('gasto mais comprometido acima do limite marca estouro, com números em string', () => {
  const [a] = orcamentosApertados([
    { category: 'mercado', limit_cents: '100000', spent_cents: '90000', committed_cents: '20000' },
  ]);
  assert.equal(a.estourou, true);
  assert.equal(a.restante, 10000);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/setup-steps.test.ts src/lib/budget-tight.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar** — `src/lib/setup-steps.ts`:

```ts
/**
 * Os Primeiros passos da Hoje, a partir de DADO REAL — nunca de uma flag "já vi o tutorial".
 *
 * Cada passo está feito quando o banco diz que está: o telefone verificado mora em
 * `profiles.phone` (só entra por OTP), conta é linha em `accounts`, lançamento é linha em
 * `transactions`. Assim o card some sozinho quando a pessoa faz a coisa por qualquer caminho —
 * pelo app, pelo agente ou pelo WhatsApp.
 */
export type PassoId = 'whatsapp' | 'conta' | 'lancamento';

export type Passo = {
  id: PassoId;
  titulo: string;
  feito: boolean;
  href: '/link-phone' | '/finance/accounts' | '/agent/new';
};

export function passosDeConfiguracao(i: {
  telefone: string | null | undefined;
  contas: number;
  temLancamento: boolean;
}): Passo[] {
  return [
    { id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: Boolean(i.telefone?.trim()), href: '/link-phone' },
    { id: 'conta', titulo: 'Cadastrar conta ou cartão', feito: i.contas > 0, href: '/finance/accounts' },
    { id: 'lancamento', titulo: 'Fazer o primeiro lançamento', feito: i.temLancamento, href: '/agent/new' },
  ];
}

export function progresso(passos: readonly Passo[]): { feitos: number; total: number; completo: boolean } {
  const feitos = passos.filter((p) => p.feito).length;
  return { feitos, total: passos.length, completo: feitos === passos.length };
}
```

`src/lib/budget-tight.ts`:

```ts
/**
 * Orçamentos "no limite" — a régua ÚNICA das duas raízes.
 *
 * Hoje e Financeiro filtravam cada um do seu jeito, e mostravam percentuais diferentes para a
 * mesma categoria. A regra é a de `finance.md`: **o aviso conta gasto + comprometido; o número
 * exibido é só o gasto** (o destaque amarelo do YNAB traduzido).
 */
export type OrcamentoLinha = {
  category: string;
  limit_cents: number | string;
  spent_cents: number | string;
  committed_cents?: number | string | null;
};

export type OrcamentoApertado = {
  categoria: string;
  limite: number;
  gasto: number;
  /** Só o gasto sobre o limite — é o número que a tela escreve. */
  fracaoGasta: number;
  /** Limite − gasto. Negativo quando já passou. */
  restante: number;
  /** Gasto + comprometido chegou no limite. */
  estourou: boolean;
};

export function orcamentosApertados(linhas: readonly OrcamentoLinha[], limiar = 0.8): OrcamentoApertado[] {
  return linhas.flatMap((l) => {
    const limite = Number(l.limit_cents);
    if (!(limite > 0)) return [];
    const gasto = Number(l.spent_cents);
    const comprometido = Number(l.committed_cents ?? 0);
    const aviso = (gasto + comprometido) / limite;
    if (aviso < limiar) return [];
    return [{
      categoria: l.category,
      limite,
      gasto,
      fracaoGasta: gasto / limite,
      restante: limite - gasto,
      estourou: aviso >= 1,
    }];
  });
}
```

`src/lib/agent-prompts.ts`:

```ts
/**
 * Frases de exemplo para começar uma conversa com o agente.
 *
 * Uma lista só: a Hoje ("Diga ao agente…") e a aba Agente (conversa vazia) ensinam com as MESMAS
 * frases. Duas listas divergiriam — e a pessoa leria um exemplo numa tela que a outra não conhece.
 */
export const EXEMPLOS_DO_AGENTE = [
  'Gastei 45 no mercado',
  'Me lembra do aluguel todo dia 5',
  'Quanto gastei este mês?',
  'O que vence esta semana?',
] as const;
```

Em `src/app/(tabs)/agent/index.tsx`, apagar o `const PROMPTS = [...] as const;` (linhas 33–37), acrescentar `import { EXEMPLOS_DO_AGENTE } from '@/lib/agent-prompts';` aos imports e trocar `PROMPTS.map` por `EXEMPLOS_DO_AGENTE.map`.

- [ ] **Step 4: Rodar**

Run: `node --test src/lib/setup-steps.test.ts src/lib/budget-tight.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setup-steps.ts src/lib/setup-steps.test.ts src/lib/budget-tight.ts src/lib/budget-tight.test.ts src/lib/agent-prompts.ts "src/app/(tabs)/agent/index.tsx"
git commit -m "feat(hoje): passos de configuração, régua única de orçamento e exemplos do agente"
```

---

### Task 3: A Pista (aritmética)

**Files:**
- Create: `src/lib/runway.ts`
- Test: `src/lib/runway.test.ts`

**Interfaces:**
- Consumes: `diasAte` de `src/lib/dates.ts`.
- Produces:
  - `type EventoDaPista = { day: string; out_cents: number | string }`
  - `type Entalhe = { day: string; posicao: number; saida: number; livreDepois: number }`
  - `type Pista = { caixa: number; comprometido: number; livre: number; entalhes: Entalhe[]; confere: boolean }`
  - `montarPista(caixa: number, comprometido: number, eventos: readonly EventoDaPista[], hoje: string, ate: string): Pista`
  - `fracaoComprometida(p: Pista): number`
  - `entalheMaisProximo(posicoes: readonly number[], p: number): number` (worklet)

- [ ] **Step 1: Teste que falha** — `src/lib/runway.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entalheMaisProximo, fracaoComprometida, montarPista } from './runway.ts';

test('com a soma batendo, os entalhes descem até o número do herói', () => {
  const p = montarPista(
    100000,
    60000,
    [
      { day: '2026-09-17', out_cents: 10000 },
      { day: '2026-09-20', out_cents: 30000 },
      { day: '2026-09-20', out_cents: '20000' },
    ],
    '2026-09-17',
    '2026-09-27'
  );
  assert.equal(p.confere, true);
  assert.equal(p.livre, 40000);
  assert.deepEqual(p.entalhes.map((e) => e.day), ['2026-09-17', '2026-09-20']);
  assert.equal(p.entalhes[0].posicao, 0);
  assert.equal(p.entalhes[1].posicao, 0.3);
  assert.equal(p.entalhes[1].saida, 50000);
  assert.equal(p.entalhes.at(-1)!.livreDepois, p.livre);
});

test('soma que não bate não desenha entalhe nenhum — nunca contradiz o herói', () => {
  const p = montarPista(100000, 60000, [{ day: '2026-09-20', out_cents: 10000 }], '2026-09-17', '2026-09-27');
  assert.equal(p.confere, false);
  assert.deepEqual(p.entalhes, []);
  assert.equal(p.livre, 40000);
});

test('sem eventos não há o que conferir', () => {
  const p = montarPista(100000, 0, [], '2026-09-17', '2026-09-27');
  assert.equal(p.confere, false);
  assert.deepEqual(p.entalhes, []);
});

test('evento além da ponta fica preso na ponta', () => {
  const p = montarPista(0, 500, [{ day: '2026-10-30', out_cents: 500 }], '2026-09-17', '2026-09-27');
  assert.equal(p.entalhes[0].posicao, 1);
});

test('fração comprometida', () => {
  const base = { entalhes: [], confere: false, livre: 0 };
  assert.equal(fracaoComprometida({ ...base, caixa: 100, comprometido: 0 }), 0);
  assert.equal(fracaoComprometida({ ...base, caixa: 0, comprometido: 10 }), 1);
  assert.equal(fracaoComprometida({ ...base, caixa: 100, comprometido: 25 }), 0.25);
  assert.equal(fracaoComprometida({ ...base, caixa: 100, comprometido: 300 }), 1);
});

test('entalhe mais próximo do dedo', () => {
  assert.equal(entalheMaisProximo([], 0.5), -1);
  assert.equal(entalheMaisProximo([0, 0.3, 0.9], 0.5), 1);
  assert.equal(entalheMaisProximo([0, 0.3, 0.9], 0.7), 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/runway.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar** — `src/lib/runway.ts`:

```ts
import { diasAte } from './dates.ts';

/**
 * A Pista do herói da Hoje: de hoje até a próxima entrada, com um entalhe em cada saída.
 *
 * ⚠️ **Ela lê a MESMA lista que produz o número grande.** O herói escreve
 * `caixa − comprometido_ate_entrada`, e `comprometido_ate_entrada` é a soma dos eventos que
 * `spendable_path` devolve. Se a soma dos eventos não bater com o comprometido (duas consultas
 * em idades diferentes do cache), a Pista não desenha entalhe nenhum: um "livre depois" que
 * contradiz o herói é pior que nenhum.
 */
export type EventoDaPista = { day: string; out_cents: number | string };
export type Entalhe = { day: string; posicao: number; saida: number; livreDepois: number };
export type Pista = {
  caixa: number;
  comprometido: number;
  livre: number;
  entalhes: Entalhe[];
  confere: boolean;
};

export function montarPista(
  caixa: number,
  comprometido: number,
  eventos: readonly EventoDaPista[],
  hoje: string,
  ate: string
): Pista {
  const janela = Math.max(0, diasAte(ate, hoje));
  const porDia = new Map<string, number>();
  for (const e of eventos) {
    const valor = Number(e.out_cents);
    if (valor > 0) porDia.set(e.day, (porDia.get(e.day) ?? 0) + valor);
  }
  let acumulado = 0;
  const entalhes = [...porDia.keys()].sort().map((day) => {
    const saida = porDia.get(day) ?? 0;
    acumulado += saida;
    const dia = diasAte(day, hoje);
    return {
      day,
      posicao: janela > 0 ? Math.min(1, Math.max(0, dia / janela)) : 0,
      saida,
      livreDepois: caixa - acumulado,
    };
  });
  const confere = porDia.size > 0 && acumulado === comprometido;
  return { caixa, comprometido, livre: caixa - comprometido, entalhes: confere ? entalhes : [], confere };
}

/** Quanto do caixa já está prometido antes da entrada. Sem caixa e com saída, a pista está cheia. */
export function fracaoComprometida(p: Pista): number {
  if (p.comprometido <= 0) return 0;
  if (p.caixa <= 0) return 1;
  return Math.min(1, p.comprometido / p.caixa);
}

/** O entalhe mais perto de uma posição 0..1. Roda na UI thread durante o arraste. */
export function entalheMaisProximo(posicoes: readonly number[], p: number): number {
  'worklet';
  let melhor = -1;
  let distancia = Infinity;
  for (let i = 0; i < posicoes.length; i++) {
    const d = Math.abs(posicoes[i] - p);
    if (d < distancia) {
      distancia = d;
      melhor = i;
    }
  }
  return melhor;
}
```

- [ ] **Step 4: Rodar**

Run: `node --test src/lib/runway.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runway.ts src/lib/runway.test.ts
git commit -m "feat(hoje): aritmética da pista presa à identidade do livre"
```

---

### Task 4: A agenda da Hoje (aritmética)

**Files:**
- Create: `src/lib/today-sections.ts`
- Test: `src/lib/today-sections.test.ts`

**Interfaces:**
- Consumes: `diasAte`, `isoToBR` de `src/lib/dates.ts`.
- Produces:
  - `type ContaPrevista = { ref_id: string; title: string; due_date: string; amount_cents: number | string; kind: 'invoice' | 'transaction' | 'debt' | 'income'; overdue: boolean }`
  - `type CompraNoCartao = { id: string; title: string; occurred_at: string; amount_cents: number | string; card: string; invoice_id: string }`
  - `type ItemDaAgenda = { chave: string; ref_id: string; kind: 'invoice' | 'transaction' | 'debt' | 'income' | 'card'; title: string; day: string; cents: number; atrasado: boolean; cartao: string | null; faturaId: string | null }`
  - `type Tom = 'danger' | 'warning' | 'success' | 'neutral'`
  - `agendaDoDia(contas, compras, hoje, janela?): { agora: ItemDaAgenda[]; proximos: { day: string; itens: ItemDaAgenda[] }[] }`
  - `metaDoItem(i: ItemDaAgenda, onde: 'agora' | 'proximos'): { texto: string; tom: Tom }`
  - `iconeDoItem(i: ItemDaAgenda): 'creditcard' | 'banknote' | 'arrow.down.left' | 'calendar'`

- [ ] **Step 1: Teste que falha** — `src/lib/today-sections.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agendaDoDia, iconeDoItem, metaDoItem, type ContaPrevista } from './today-sections.ts';

const HOJE = '2026-09-17';
const conta = (o: Partial<ContaPrevista>): ContaPrevista => ({
  ref_id: 'x', title: 'Conta', due_date: HOJE, amount_cents: 1000, kind: 'transaction', overdue: false, ...o,
});

test('Agora tem o atrasado, o que vence hoje e o que chega hoje; atrasado primeiro', () => {
  const { agora } = agendaDoDia(
    [
      conta({ ref_id: 'luz', title: 'Luz', due_date: HOJE }),
      conta({ ref_id: 'fatura', kind: 'invoice', title: 'Fatura', due_date: '2026-09-10', overdue: true }),
      conta({ ref_id: 'pix', kind: 'income', title: 'Pix', due_date: HOJE }),
      conta({ ref_id: 'agua', title: 'Água', due_date: '2026-09-19' }),
    ],
    [],
    HOJE
  );
  assert.deepEqual(agora.map((i) => i.ref_id), ['fatura', 'luz', 'pix']);
});

test('Próximos dias agrupa por dia, respeita a janela e nunca repete o que está em Agora', () => {
  const { proximos } = agendaDoDia(
    [
      conta({ ref_id: 'agua', title: 'Água', due_date: '2026-09-19' }),
      conta({ ref_id: 'salario', kind: 'income', title: 'Salário', due_date: '2026-09-19', amount_cents: 500000 }),
      conta({ ref_id: 'longe', due_date: '2026-10-30' }),
      conta({ ref_id: 'luz', due_date: HOJE }),
    ],
    [{ id: 'c1', title: 'DAS', occurred_at: '2026-09-18', amount_cents: 7000, card: 'Nubank', invoice_id: 'f1' }],
    HOJE
  );
  assert.deepEqual(proximos.map((g) => g.day), ['2026-09-18', '2026-09-19']);
  assert.deepEqual(proximos[1].itens.map((i) => i.ref_id), ['agua', 'salario']);
  assert.equal(proximos[0].itens[0].kind, 'card');
  assert.equal(proximos[0].itens[0].faturaId, 'f1');
});

test('compra no cartão de hoje não vira pendência', () => {
  const { agora, proximos } = agendaDoDia(
    [],
    [{ id: 'c1', title: 'Uber', occurred_at: HOJE, amount_cents: 2000, card: 'Inter', invoice_id: 'f2' }],
    HOJE
  );
  assert.equal(agora.length, 0);
  assert.equal(proximos[0].day, HOJE);
});

test('o texto e o tom de cada item dizem o que aconteceu', () => {
  const [atrasada] = agendaDoDia([conta({ kind: 'invoice', due_date: '2026-09-10', overdue: true })], [], HOJE).agora;
  assert.deepEqual(metaDoItem(atrasada, 'agora'), { texto: 'venceu 10/09', tom: 'danger' });
  const [pix] = agendaDoDia([conta({ kind: 'income', due_date: '2026-09-15', overdue: true })], [], HOJE).agora;
  assert.deepEqual(metaDoItem(pix, 'agora'), { texto: 'não caiu 15/09', tom: 'warning' });
  const [hoje] = agendaDoDia([conta({})], [], HOJE).agora;
  assert.deepEqual(metaDoItem(hoje, 'agora'), { texto: 'vence hoje', tom: 'neutral' });
  assert.equal(iconeDoItem(atrasada), 'creditcard');
  assert.equal(iconeDoItem(pix), 'arrow.down.left');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/today-sections.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar** — `src/lib/today-sections.ts`:

```ts
import { diasAte, isoToBR } from './dates.ts';

/**
 * A agenda da Hoje, fora da tela: o que exige ação AGORA e o que vem nos próximos dias.
 *
 * Tipos locais de propósito — este arquivo roda em `node --test` e não importa hooks. As
 * formas são as de `upcoming_bills` e de `useUpcomingCardCharges`.
 *
 * ⚠️ **Compra no cartão nunca é pendência.** Ela não vence: vai POSTAR na fatura. Fica fora do
 * Agora, do contador "Vencendo" e do badge da aba (design.md §8), mesmo quando é de hoje.
 */
export type ContaPrevista = {
  ref_id: string;
  title: string;
  due_date: string;
  amount_cents: number | string;
  kind: 'invoice' | 'transaction' | 'debt' | 'income';
  overdue: boolean;
};

export type CompraNoCartao = {
  id: string;
  title: string;
  occurred_at: string;
  amount_cents: number | string;
  card: string;
  invoice_id: string;
};

export type ItemDaAgenda = {
  chave: string;
  ref_id: string;
  kind: 'invoice' | 'transaction' | 'debt' | 'income' | 'card';
  title: string;
  day: string;
  cents: number;
  atrasado: boolean;
  cartao: string | null;
  faturaId: string | null;
};

export type Tom = 'danger' | 'warning' | 'success' | 'neutral';

const PESO_DO_TIPO: Record<ItemDaAgenda['kind'], number> = {
  invoice: 0, transaction: 0, debt: 0, card: 1, income: 2,
};

function ordemDeAgora(a: ItemDaAgenda, b: ItemDaAgenda): number {
  if (a.atrasado !== b.atrasado) return a.atrasado ? -1 : 1;
  const tipo = PESO_DO_TIPO[a.kind] - PESO_DO_TIPO[b.kind];
  if (tipo !== 0) return tipo;
  return a.day.localeCompare(b.day) || b.cents - a.cents;
}

function ordemDoDia(a: ItemDaAgenda, b: ItemDaAgenda): number {
  return PESO_DO_TIPO[a.kind] - PESO_DO_TIPO[b.kind] || b.cents - a.cents;
}

export function agendaDoDia(
  contas: readonly ContaPrevista[],
  compras: readonly CompraNoCartao[],
  hoje: string,
  janela = 7
): { agora: ItemDaAgenda[]; proximos: { day: string; itens: ItemDaAgenda[] }[] } {
  const itens: ItemDaAgenda[] = [
    ...contas.map((c) => ({
      // `debt` repete o `ref_id` (é o id da DÍVIDA) em cada prestação: a data entra na chave.
      chave: `${c.kind}:${c.ref_id}:${c.due_date}`,
      ref_id: c.ref_id,
      kind: c.kind,
      title: c.title,
      day: c.due_date,
      cents: Number(c.amount_cents),
      atrasado: c.overdue,
      cartao: null,
      faturaId: null,
    })),
    ...compras.map((c) => ({
      chave: `card:${c.id}`,
      ref_id: c.id,
      kind: 'card' as const,
      title: c.title,
      day: c.occurred_at,
      cents: Number(c.amount_cents),
      atrasado: false,
      cartao: c.card,
      faturaId: c.invoice_id,
    })),
  ];

  const agora = itens
    .filter((i) => i.kind !== 'card' && (i.atrasado || i.day <= hoje))
    .sort(ordemDeAgora);
  const naAgora = new Set(agora.map((i) => i.chave));

  const grupos = new Map<string, ItemDaAgenda[]>();
  for (const i of itens) {
    if (naAgora.has(i.chave)) continue;
    const distancia = diasAte(i.day, hoje);
    if (distancia < 0 || distancia > janela) continue;
    grupos.set(i.day, [...(grupos.get(i.day) ?? []), i]);
  }
  const proximos = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, lista]) => ({ day, itens: lista.sort(ordemDoDia) }));

  return { agora, proximos };
}

/** A linha pequena embaixo do título: o que aconteceu, na palavra do dia a dia. */
export function metaDoItem(i: ItemDaAgenda, onde: 'agora' | 'proximos'): { texto: string; tom: Tom } {
  const data = isoToBR(i.day).slice(0, 5);
  if (onde === 'agora') {
    if (i.kind === 'income') {
      return i.atrasado ? { texto: `não caiu ${data}`, tom: 'warning' } : { texto: 'chega hoje', tom: 'success' };
    }
    return i.atrasado ? { texto: `venceu ${data}`, tom: 'danger' } : { texto: 'vence hoje', tom: 'neutral' };
  }
  if (i.kind === 'card') return { texto: i.cartao ?? 'cartão', tom: 'neutral' };
  if (i.kind === 'income') return { texto: 'a receber', tom: 'success' };
  if (i.kind === 'invoice') return { texto: 'fatura', tom: 'neutral' };
  if (i.kind === 'debt') return { texto: 'financiamento', tom: 'neutral' };
  return { texto: 'conta', tom: 'neutral' };
}

export function iconeDoItem(i: ItemDaAgenda): 'creditcard' | 'banknote' | 'arrow.down.left' | 'calendar' {
  if (i.kind === 'invoice' || i.kind === 'card') return 'creditcard';
  if (i.kind === 'debt') return 'banknote';
  if (i.kind === 'income') return 'arrow.down.left';
  return 'calendar';
}
```

- [ ] **Step 4: Rodar**

Run: `node --test src/lib/today-sections.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/today-sections.ts src/lib/today-sections.test.ts
git commit -m "feat(hoje): agenda separa o que é agora do que vem nos próximos dias"
```

---

### Task 5: A rolagem da tela vira valor compartilhado

**Files:**
- Create: `src/components/ui/screen-scroll.tsx`
- Modify: `src/components/ui/screen.tsx`

**Interfaces:**
- Produces: `RolagemDaTela` (contexto), `useRolagemDaTela(): SharedValue<number>` (0 fora de um `Screen`); `Screen` ganha `overlay?: ReactNode` (desenhado por cima do scroll, dentro do provider; só com `topBar`).

- [ ] **Step 1: Criar `src/components/ui/screen-scroll.tsx`**

```tsx
import { createContext, useContext } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * O deslocamento vertical da rolagem da tela, na UI thread.
 *
 * Existe para a luz do herói e o FAB reagirem à rolagem SEM passar pelo JS: um `onScroll`
 * comum custaria um render por quadro. Quem está fora de um `Screen` lê um valor parado em 0.
 */
export const RolagemDaTela = createContext<SharedValue<number> | null>(null);

export function useRolagemDaTela(): SharedValue<number> {
  const daTela = useContext(RolagemDaTela);
  const parado = useSharedValue(0);
  return daTela ?? parado;
}
```

- [ ] **Step 2: Ligar no `Screen`** — em `src/components/ui/screen.tsx`:

1. Imports: trocar a linha do Reanimated por
```tsx
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
```
e acrescentar `import type { ScrollViewProps } from 'react-native';` e `import { RolagemDaTela } from '@/components/ui/screen-scroll';`.

2. Em `ScreenProps`, depois de `topBar`:
```tsx
  /**
   * Camada por cima do conteúdo — o FAB do Financeiro. Mora aqui para ler a rolagem da tela
   * (`useRolagemDaTela`). Só vale com `topBar`: tela empurrada não tem FAB.
   */
  overlay?: React.ReactNode;
```
e `overlay,` na desestruturação de `Screen`.

3. Logo depois de `const headerHeight = useAppHeaderHeight();`:
```tsx
  const rolagem = useSharedValue(0);
  const aoRolar = useAnimatedScrollHandler((e) => {
    rolagem.set(e.contentOffset.y);
  });
```

4. No `<KeyboardAwareScrollView …>`, acrescentar a prop (o scroll por dentro é o `Reanimated.ScrollView`, que aceita o handler; o tipo público é o do `ScrollView` da RN):
```tsx
      onScroll={aoRolar as unknown as ScrollViewProps['onScroll']}
```

5. Envolver as três saídas com o provider:
```tsx
  if (!topBar) return <RolagemDaTela.Provider value={rolagem}>{conteudo}</RolagemDaTela.Provider>;

  return (
    <RolagemDaTela.Provider value={rolagem}>
      <View style={[styles.root, { backgroundColor: background }]}>
        {conteudo}
        {/* Depois do scroll na árvore: ele precisa desenhar POR CIMA para o desfoque existir. */}
        {topBar}
        {overlay}
      </View>
    </RolagemDaTela.Provider>
  );
```
(o ramo `!scroll` com `topBar` também ganha `{overlay}` depois de `{topBar}`).

- [ ] **Step 3: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: limpo e verde (nenhuma tela usa `overlay` ainda).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/screen-scroll.tsx src/components/ui/screen.tsx
git commit -m "feat(ui): a rolagem da tela fica disponível na UI thread"
```

---

### Task 6: Tinta viva no herói

**Files:**
- Create: `src/components/ui/ink-surface.tsx`
- Modify: `src/components/ui/hero-panel.tsx`

**Interfaces:**
- Consumes: `useRolagemDaTela` (Task 5), tokens `heroGlow`, `heroGlowClear` (Task 1).
- Produces: `InkSurface()`; `HeroPanel` ganha `surface?: 'flat' | 'live'` (padrão `flat`) e passa a desenhar `chart` FORA da área tocável.

- [ ] **Step 1: Criar `src/components/ui/ink-surface.tsx`**

```tsx
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FractalNoise, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion } from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { useRolagemDaTela } from '@/components/ui/screen-scroll';
import { useTheme } from '@/hooks/use-theme';

/** Quanto a luz anda por dp rolado — devagar, para ler como reflexo e não como objeto. */
const PARALAXE_X = 0.35;
const PARALAXE_Y = 0.2;

/**
 * A "tinta viva" do bloco de destaque: a tinta chapada, uma luz larga que acompanha a rolagem e
 * um grão fino por cima.
 *
 * Liberado pelo dono do produto em 17/09/2026 ("sem degradê/brilho em conteúdo" deixou de valer
 * nas raízes). Dois canvases de propósito: o grão é estático e nunca redesenha; só a luz,
 * que é um degradê radial barato, redesenha quando a rolagem muda. Parado, custo zero.
 *
 * Com Reduzir Movimento a luz fica onde nasceu.
 */
export function InkSurface() {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const rolagem = useRolagemDaTela();
  const [tam, setTam] = useState({ w: 0, h: 0 });

  const centro = useDerivedValue(() => {
    const d = reduzido ? 0 : Math.max(-120, Math.min(240, rolagem.get()));
    return vec(tam.w * 0.82 - d * PARALAXE_X, -tam.h * 0.15 + d * PARALAXE_Y);
  }, [tam.w, tam.h, reduzido]);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.heroSurface }]}
      onLayout={(e) => setTam({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {tam.w > 0 ? (
        <>
          <SkiaCanvas style={StyleSheet.absoluteFill}>
            <Rect x={0} y={0} width={tam.w} height={tam.h}>
              <RadialGradient
                c={centro}
                r={Math.max(tam.w, tam.h) * 0.9}
                colors={[theme.heroGlow, theme.heroGlowClear]}
              />
            </Rect>
          </SkiaCanvas>
          <SkiaCanvas style={StyleSheet.absoluteFill}>
            <Rect x={0} y={0} width={tam.w} height={tam.h} opacity={0.06}>
              <FractalNoise freqX={0.85} freqY={0.85} octaves={3} seed={7} />
            </Rect>
          </SkiaCanvas>
        </>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: `HeroPanel`** — em `src/components/ui/hero-panel.tsx`:

1. `import { InkSurface } from '@/components/ui/ink-surface';`
2. Na interface, depois de `onPress`:
```tsx
  /** `live` desenha a tinta viva por baixo do conteúdo (raízes). `flat` é a tinta chapada. */
  surface?: 'flat' | 'live';
```
e `surface = 'flat',` na desestruturação.
3. Primeiro filho do `Animated.View` do painel: `{surface === 'live' ? <InkSurface /> : null}`.
4. Tirar `{chart ? <View style={styles.chart}>{chart}</View> : null}` de DENTRO do `Pressable` e colocá-lo logo DEPOIS do `</Pressable>` (antes de `{actions ? …}`), com este comentário:
```tsx
        {/*
          O gráfico mora FORA da área tocável: ele agora se arrasta (a Pista, a curva do ciclo),
          e um arraste dentro do `Pressable` abria o menu do herói ao soltar o dedo.
        */}
```

- [ ] **Step 3: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: limpo e verde.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ink-surface.tsx src/components/ui/hero-panel.tsx
git commit -m "feat(ui): tinta viva no herói e gráfico fora da área tocável"
```

---

### Task 7: `BlockHeader`, `Tile`, `RingGauge`, `DayRail`

**Files:**
- Create: `src/components/ui/block-header.tsx`, `src/components/ui/tile.tsx`, `src/components/ui/ring-gauge.tsx`, `src/components/ui/day-rail.tsx`

**Interfaces:**
- Produces:
  - `BlockHeader({ title, count?, action?: { label; onPress; accessibilityLabel? }, tag?, voice?: 'app', trailing? })`
  - `Tile({ layout?: 'fill' | 'half' | 'wide', compact?, icon?, label, value?, caption?, visual?, footer?, onPress?, accessibilityLabel? })`, `TileRow({ children })`, `TileGrid({ children })`
  - `RingGauge({ value: number /*0..1*/, size?, stroke?, tone?: ThemeColor, track?: ThemeColor, children?, accessibilityLabel? })`
  - `DayRail({ label, tone?: 'neutral' | 'danger' | 'success', last?, children })`

- [ ] **Step 1: `src/components/ui/block-header.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const ALTURA_DA_ACAO = 30;

export interface BlockHeaderProps {
  title: string;
  /** Contagem ao lado do título. Zero ou ausente não desenha nada (badge é contagem real, §8). */
  count?: number;
  /** A ação do bloco, em pílula ("Ver todos"). */
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** Etiqueta neutra quando não há ação — a LENTE do número ("por data da compra"). */
  tag?: string;
  /** `app`: o selo da marca antes do título — é o app falando (Conversa organizada). */
  voice?: 'app';
  /** Controle próprio à direita. Vence `action` e `tag`. */
  trailing?: ReactNode;
}

/**
 * O cabeçalho de bloco das raízes.
 *
 * Substitui o `SectionHead` de 14px + "Ver todos" em texto azul-tinta solto: o título ganha
 * escala (`title2`), a contagem vira pílula e a ação vira um alvo de verdade, com fundo e seta —
 * a queixa de 17/09/2026 foi exatamente o "Cartões" e o "Ver todos" do Financeiro.
 */
export function BlockHeader({ title, count, action, tag, voice, trailing }: BlockHeaderProps) {
  const theme = useTheme();
  const direita =
    trailing ??
    (action ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel ?? action.label}
        hitSlop={(HitTarget - ALTURA_DA_ACAO) / 2}
        onPress={() => {
          Haptics.selectionAsync();
          action.onPress();
        }}
        style={({ pressed }) => [
          styles.pilula,
          { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        <ThemedText type="caption" style={styles.semEncolher}>
          {action.label}
        </ThemedText>
        <Icon name="chevron.right" size="xs" color="text" />
      </Pressable>
    ) : tag ? (
      <View style={[styles.pilula, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.semEncolher}>
          {tag}
        </ThemedText>
      </View>
    ) : null);

  return (
    <View style={styles.cabeca}>
      <View style={styles.esquerda}>
        {voice === 'app' ? (
          <View style={[styles.selo, { backgroundColor: theme.heroSurface }]}>
            <Mark size={12} color="onHero" />
          </View>
        ) : null}
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.titulo}>
          {title}
        </ThemedText>
        {count ? (
          <View style={[styles.contagem, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="code" themeColor="textSecondary" style={tabular}>
              {count}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {direita}
    </View>
  );
}

const styles = StyleSheet.create({
  cabeca: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  esquerda: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm, flexShrink: 1 },
  // Identificador: quebra a linha inteira, nunca encolhe até sumir (§3).
  titulo: { flexShrink: 0, maxWidth: '100%' },
  semEncolher: { flexShrink: 0 },
  selo: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contagem: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: ALTURA_DA_ACAO,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
});
```

- [ ] **Step 2: `src/components/ui/tile.tsx`**

```tsx
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

export interface TileProps {
  /** `fill` divide uma `TileRow`; `half` e `wide` são células da `TileGrid`. */
  layout?: 'fill' | 'half' | 'wide';
  /** Ladrilho baixo, só rótulo e valor (os contadores da Hoje). */
  compact?: boolean;
  icon?: IconName;
  label: string;
  value?: ReactNode;
  caption?: string;
  /** Minigráfico no canto (anel, minicurva). Toma o lugar da seta. */
  visual?: ReactNode;
  /** Faixa embaixo do valor (a barra do "já caiu"). */
  footer?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

const LAYOUT: Record<NonNullable<TileProps['layout']>, ViewStyle> = {
  fill: { flex: 1, minWidth: 0 },
  // `flexBasis` 40% + `flexGrow`: duas por linha repartindo o `gap`, e a última ímpar ocupa a linha.
  half: { flexGrow: 1, flexBasis: '40%', minWidth: 0 },
  wide: { flexBasis: '100%' },
};

/**
 * O ladrilho do mosaico: superfície branca, canto 18, ícone num selo, rótulo, valor e um slot de
 * minigráfico. Press em escala (é bloco, não linha — §5).
 */
export function Tile({
  layout = 'fill',
  compact = false,
  icon,
  label,
  value,
  caption,
  visual,
  footer,
  onPress,
  accessibilityLabel,
}: TileProps) {
  const theme = useTheme();
  const scheme = useScheme();

  const corpo = (
    <View
      style={[
        styles.tile,
        compact && styles.compacto,
        { backgroundColor: theme.surface, borderColor: theme.cardBorder, boxShadow: Elevation[scheme].raised },
      ]}>
      {compact ? null : (
        <View style={styles.topo}>
          {icon ? (
            <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
              <Icon name={icon} size="sm" color="text" />
            </View>
          ) : (
            <View />
          )}
          {visual ?? (onPress ? <Icon name="arrow.up.right" size="xs" color="textSecondary" /> : null)}
        </View>
      )}
      <View style={styles.base}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {label}
        </ThemedText>
        {value}
        {caption ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {caption}
          </ThemedText>
        ) : null}
      </View>
      {footer}
    </View>
  );

  if (!onPress) return <View style={LAYOUT[layout]}>{corpo}</View>;
  return (
    <PressableScale
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={LAYOUT[layout]}>
      {corpo}
    </PressableScale>
  );
}

/** Ladrilhos lado a lado, repartindo a largura. */
export function TileRow({ children }: { children: ReactNode }) {
  return <View style={styles.linha}>{children}</View>;
}

/** O mosaico: duas colunas, `wide` ocupa a linha. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grade}>{children}</View>;
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    gap: Space.md,
    padding: Space.lg,
    minHeight: 112,
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  compacto: { minHeight: 0, paddingVertical: Space.md, gap: Space.xs },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  selo: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  base: { gap: Space.half },
  linha: { flexDirection: 'row', gap: Space.md },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
});
```

`IconName` já é exportado por `icon.tsx` (`export type IconName`).

- [ ] **Step 3: `src/components/ui/ring-gauge.tsx`**

```tsx
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Path, Skia, rect } from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import type { ThemeColor } from '@/constants/theme';
import { Motion } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Anel de progresso. Nasce no valor real e só anima quando ele muda — a mesma regra da
 * `ProgressBar` (uma mola parada no Android deixou uma barra em 0% que não existia).
 */
export function RingGauge({
  value,
  size = 56,
  stroke = 6,
  tone = 'text',
  track = 'backgroundElement',
  children,
  accessibilityLabel,
}: {
  /** 0..1. Acima de 1 o anel fica cheio. */
  value: number;
  size?: number;
  stroke?: number;
  tone?: ThemeColor;
  track?: ThemeColor;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const alvo = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const fim = useSharedValue(alvo);
  const anterior = useRef(alvo);

  useEffect(() => {
    if (anterior.current === alvo) return;
    anterior.current = alvo;
    fim.set(reduzido ? alvo : withSpring(alvo, Motion.spring.encaixe));
  }, [alvo, fim, reduzido]);

  // Com o traço arredondado, um arco de tamanho zero desenha um ponto: some com o valor.
  const visivel = useDerivedValue(() => (fim.get() > 0.001 ? 1 : 0));

  const arco = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    b.addArc(rect(stroke / 2, stroke / 2, size - stroke, size - stroke), -90, 359.9);
    return b.detach();
  }, [size, stroke]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(alvo * 100) }}
      style={{ width: size, height: size }}>
      <SkiaCanvas style={StyleSheet.absoluteFill}>
        <Path path={arco} color={theme[track]} style="stroke" strokeWidth={stroke} />
        <Path
          path={arco}
          color={theme[tone]}
          style="stroke"
          strokeWidth={stroke}
          strokeCap="round"
          start={0}
          end={fim}
          opacity={visivel}
        />
      </SkiaCanvas>
      {children ? <View style={styles.centro}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centro: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 4: `src/components/ui/day-rail.tsx`**

```tsx
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Um grupo da agenda preso a um trilho vertical: o nó marca o dia, o fio liga ao próximo.
 *
 * O tom do nó é semântico (tijolo para atraso, verde para dinheiro que entra); o fio é sempre
 * `rail`. `last` corta o fio no último grupo.
 */
export function DayRail({
  label,
  tone = 'neutral',
  last = false,
  children,
}: {
  label: string;
  tone?: 'neutral' | 'danger' | 'success';
  last?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const cor = tone === 'danger' ? theme.danger : tone === 'success' ? theme.success : theme.text;
  return (
    <View style={styles.linha}>
      <View style={styles.coluna}>
        <View style={[styles.no, { borderColor: cor, backgroundColor: theme.background }]} />
        {last ? null : <View style={[styles.fio, { backgroundColor: theme.rail }]} />}
      </View>
      <View style={[styles.corpo, last && styles.ultimo]}>
        <ThemedText type="caption" themeColor={tone === 'neutral' ? 'textSecondary' : tone}>
          {label}
        </ThemedText>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', gap: Space.md },
  coluna: { width: 12, alignItems: 'center' },
  no: { width: 12, height: 12, marginTop: 2, borderRadius: Radius.pill, borderWidth: 2 },
  fio: { width: 2, flex: 1, marginTop: Space.xs, borderRadius: Radius.pill },
  corpo: { flex: 1, minWidth: 0, gap: Space.sm, paddingBottom: Space.lg },
  ultimo: { paddingBottom: 0 },
});
```

- [ ] **Step 5: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: limpo e verde (o `icon-map.test.ts` já conhece `arrow.up.right`, `chevron.right`).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/block-header.tsx src/components/ui/tile.tsx src/components/ui/ring-gauge.tsx src/components/ui/day-rail.tsx
git commit -m "feat(ui): cabeçalho de bloco, ladrilho, anel e trilho da agenda"
```

---

### Task 8: `RunwayBar` — a Pista

**Files:**
- Create: `src/components/ui/runway-bar.tsx`

**Interfaces:**
- Consumes: `Pista`, `fracaoComprometida`, `entalheMaisProximo` (Task 3); `useBRL`; `isoToBR`.
- Produces: `RunwayBar({ pista: Pista; ate: string; entrada: string | null })` — desenhada DENTRO do herói (tokens `onHero*`).

- [ ] **Step 1: Criar o arquivo**

```tsx
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useBRL } from '@/components/ui/conceal';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isoToBR } from '@/lib/dates';
import { entalheMaisProximo, fracaoComprometida, type Pista } from '@/lib/runway';

const ALTURA = 8;
/** O alvo do dedo é bem maior que o trilho: arrastar um fio de 8dp é impossível. */
const ALVO = 32;

function ddmm(iso: string): string {
  return isoToBR(iso).slice(0, 5);
}

/**
 * A Pista: de hoje até a próxima entrada, com um entalhe em cada saída. Arrastar o dedo mostra
 * quanto fica livre depois de cada dia, com um toque háptico ao cruzar um entalhe.
 *
 * O preenchimento é quanto do caixa já está prometido antes da entrada. Sem entalhes (usuário
 * novo, ou a soma não conferiu com o herói — ver `montarPista`), ela é só a barra, sem arraste.
 */
export function RunwayBar({ pista, ate, entrada }: { pista: Pista; ate: string; entrada: string | null }) {
  const theme = useTheme();
  const brl = useBRL();
  const reduzido = useReducedMotion();
  const [largura, setLargura] = useState(0);
  const [ativo, setAtivo] = useState(-1);

  const fracao = fracaoComprometida(pista);
  const cheio = useSharedValue(fracao);
  const anterior = useRef(fracao);
  useEffect(() => {
    if (anterior.current === fracao) return;
    anterior.current = fracao;
    cheio.set(reduzido ? fracao : withSpring(fracao, Motion.spring.encaixe));
  }, [fracao, cheio, reduzido]);
  const estiloCheio = useAnimatedStyle(() => ({ transform: [{ scaleX: cheio.get() }] }));

  const posicoes = useMemo(() => pista.entalhes.map((e) => e.posicao), [pista.entalhes]);
  const dedo = useSharedValue(-1);
  const ultimo = useSharedValue(-1);
  const estiloCursor = useAnimatedStyle(() => ({
    opacity: dedo.get() >= 0 ? 1 : 0,
    transform: [{ translateX: Math.max(0, dedo.get()) - 1 }],
  }));

  const gesto = useMemo(
    () =>
      Gesture.Pan()
        .enabled(posicoes.length > 0 && largura > 0)
        .activeOffsetX([-6, 6])
        .failOffsetY([-10, 10])
        .onUpdate((e) => {
          const x = Math.min(largura, Math.max(0, e.x));
          dedo.set(x);
          const i = entalheMaisProximo(posicoes, x / largura);
          if (i !== ultimo.get()) {
            ultimo.set(i);
            runOnJS(setAtivo)(i);
            runOnJS(Haptics.selectionAsync)();
          }
        })
        .onFinalize(() => {
          dedo.set(-1);
          ultimo.set(-1);
          runOnJS(setAtivo)(-1);
        }),
    [posicoes, largura, dedo, ultimo]
  );

  const atual = ativo >= 0 ? pista.entalhes[ativo] : null;
  const fim = entrada ? `entra ${ddmm(entrada)}` : `até ${ddmm(ate)}`;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Pista até ${fim}`}
      accessibilityValue={{
        text: atual ? `${ddmm(atual.day)}, livre ${brl(atual.livreDepois)}` : `${Math.round(fracao * 100)}% comprometido`,
      }}
      accessibilityActions={posicoes.length ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
      onAccessibilityAction={(e) => {
        const n = posicoes.length;
        if (!n) return;
        setAtivo((i) =>
          e.nativeEvent.actionName === 'increment' ? Math.min(n - 1, i + 1) : Math.max(0, i - 1)
        );
      }}>
      <GestureDetector gesture={gesto}>
        <View style={styles.alvo} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
          <View style={[styles.trilho, { backgroundColor: theme.heroChip }]}>
            <Animated.View
              style={[
                styles.cheio,
                { backgroundColor: fracao >= 1 ? theme.onHeroDanger : theme.onHeroWarning },
                estiloCheio,
              ]}
            />
          </View>
          {pista.entalhes.map((e, i) => (
            <View
              key={e.day}
              pointerEvents="none"
              style={[
                styles.entalhe,
                { left: `${e.posicao * 100}%`, backgroundColor: i === ativo ? theme.onHero : theme.onHeroMuted },
              ]}
            />
          ))}
          <View
            pointerEvents="none"
            style={[
              styles.ponta,
              { backgroundColor: entrada ? theme.onHeroSuccess : theme.onHeroMuted, borderColor: theme.heroSurface },
            ]}
          />
          <Animated.View pointerEvents="none" style={[styles.cursor, { backgroundColor: theme.onHero }, estiloCursor]} />
        </View>
      </GestureDetector>
      <View style={styles.legenda}>
        {atual ? (
          <ThemedText type="code" themeColor={atual.livreDepois < 0 ? 'onHeroDanger' : 'onHero'}>
            {`${ddmm(atual.day)} · livre ${brl(atual.livreDepois)}`}
          </ThemedText>
        ) : (
          <>
            <ThemedText type="code" themeColor="onHeroMuted">
              hoje
            </ThemedText>
            <ThemedText type="code" themeColor={entrada ? 'onHeroSuccess' : 'onHeroMuted'}>
              {fim}
            </ThemedText>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  alvo: { height: ALVO, justifyContent: 'center' },
  trilho: { height: ALTURA, borderRadius: Radius.pill, overflow: 'hidden' },
  cheio: { width: '100%', height: '100%', borderRadius: Radius.pill, transformOrigin: 'left' },
  entalhe: {
    position: 'absolute',
    top: (ALVO - 16) / 2,
    width: 2,
    height: 16,
    marginLeft: -1,
    borderRadius: Radius.pill,
  },
  ponta: {
    position: 'absolute',
    right: -2,
    top: (ALVO - 16) / 2,
    width: 16,
    height: 16,
    borderRadius: Radius.pill,
    borderWidth: 3,
  },
  cursor: { position: 'absolute', left: 0, top: 2, width: 2, height: ALVO - 4, borderRadius: Radius.pill },
  legenda: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
});
```

- [ ] **Step 2: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: limpo e verde.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/runway-bar.tsx
git commit -m "feat(ui): pista arrastável do dinheiro livre"
```

---

### Task 9: Peças da agenda — `AgendaItem`, `ReminderTimeline`, `BudgetRings`

**Files:**
- Create: `src/components/feed/agenda-item.tsx`, `src/components/feed/reminder-timeline.tsx`, `src/components/finance/budget-rings.tsx`

**Interfaces:**
- Consumes: `Tom` (Task 4), `OrcamentoApertado` (Task 2), `RingGauge` (Task 7), `horaBR`, `emQuantoTempo` (Task 1), `CardFace`, `PressableScale`, `Button`, `Money`.
- Produces:
  - `AgendaItem({ title, meta, metaTone: Tom, cents, valueTone: 'danger' | 'success' | 'text', icon: IconName, cartao?: string | null, action?: { label; icon: IconName; onPress }, onPress? })`
  - `type LembreteDoDia = { id: string; title: string; next_run_at: string; channel: string; recurrence: string | null }`
  - `ReminderTimeline({ lembretes: readonly LembreteDoDia[]; agora: number; onOpen: (id: string) => void })`
  - `BudgetRings({ itens: readonly OrcamentoApertado[]; onPress: () => void })`

- [ ] **Step 1: `src/components/feed/agenda-item.tsx`**

```tsx
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { CardFace } from '@/components/finance/card-face';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import type { ThemeColor } from '@/constants/theme';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { Tom } from '@/lib/today-sections';

const COR_DA_META: Record<Tom, ThemeColor> = {
  danger: 'danger',
  warning: 'warning',
  success: 'success',
  neutral: 'textSecondary',
};

/** Uma instância só: `LinearTransition` recriado a cada render remonta a animação. */
const linear = LinearTransition.duration(Motion.duration.base);

export interface AgendaItemProps {
  title: string;
  meta: string;
  metaTone: Tom;
  cents: number;
  valueTone: 'danger' | 'success' | 'text';
  icon: IconName;
  /** Compra no cartão: a minifase do emissor no lugar do ícone (cor do banco DENTRO do cartão). */
  cartao?: string | null;
  action?: { label: string; icon: IconName; onPress: () => void };
  onPress?: () => void;
}

/**
 * Um compromisso da agenda: conta, fatura, prestação, entrada ou compra que vai postar.
 *
 * ⚠️ **`Animated.View` POR FORA do tocável** — `createAnimatedComponent(Pressable)` não aplica
 * estilo em função, e a linha já virou coluna por isso (ver o histórico da Hoje).
 *
 * ⚠️ **Botão dentro de card tocável vira ação de acessibilidade do card**: o leitor de tela não
 * alcança botão dentro de botão.
 */
export function AgendaItem({ title, meta, metaTone, cents, valueTone, icon, cartao, action, onPress }: AgendaItemProps) {
  const theme = useTheme();

  const corpo = (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.linha}>
        {cartao ? (
          <CardFace nome={cartao} largura={36} style={styles.mini} />
        ) : (
          <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
            <Icon name={icon} size="sm" color="text" />
          </View>
        )}
        <View style={styles.textos}>
          <ThemedText type="headline">{title}</ThemedText>
          <ThemedText type="caption" themeColor={COR_DA_META[metaTone]}>
            {meta}
          </ThemedText>
        </View>
        <Money cents={cents} variant="ticker" tone={valueTone} />
      </View>
      {action ? (
        <View style={styles.acao}>
          <Button label={action.label} icon={action.icon} size="sm" variant="secondary" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Animated.View layout={linear} exiting={FadeOut.duration(Motion.duration.exit)}>
      {onPress ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${meta}`}
          accessibilityActions={action ? [{ name: 'activate' }, { name: 'acao', label: action.label }] : undefined}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'acao') action?.onPress();
            else onPress();
          }}
          onPress={onPress}>
          {corpo}
        </PressableScale>
      ) : (
        corpo
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  // `flexWrap` + `minWidth` nos textos: o valor desce de linha antes de o título partir (lição do `Row`).
  linha: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.md },
  selo: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mini: { flexShrink: 0 },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: Space.half },
  acao: { flexDirection: 'row', justifyContent: 'flex-end' },
});
```

- [ ] **Step 2: `src/components/feed/reminder-timeline.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { emQuantoTempo, horaBR } from '@/lib/dates';

export type LembreteDoDia = {
  id: string;
  title: string;
  next_run_at: string;
  channel: string;
  recurrence: string | null;
};

/**
 * Os lembretes de hoje numa linha do tempo: a hora à esquerda, o eixo no meio, o título à
 * direita. O que já passou esmaece; o próximo acende com "em 2 h".
 *
 * Linha de lista: highlight de fundo no toque, nunca escala (§5).
 */
export function ReminderTimeline({
  lembretes,
  agora,
  onOpen,
}: {
  lembretes: readonly LembreteDoDia[];
  agora: number;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const proximo = lembretes.find((r) => new Date(r.next_run_at).getTime() >= agora)?.id;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      {lembretes.map((r, i) => {
        const passou = new Date(r.next_run_at).getTime() < agora;
        const destaque = r.id === proximo;
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={`${r.title}, ${horaBR(r.next_run_at)}`}
            onPress={() => onOpen(r.id)}>
            {({ pressed }) => (
              <View style={[styles.linha, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
                <View style={styles.hora}>
                  <ThemedText type="ticker" themeColor={passou ? 'textSecondary' : 'text'} style={tabular}>
                    {horaBR(r.next_run_at)}
                  </ThemedText>
                  {destaque ? (
                    <ThemedText type="caption" themeColor="success">
                      {emQuantoTempo(r.next_run_at, agora)}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.eixo}>
                  <View
                    style={[
                      styles.ponto,
                      { backgroundColor: destaque ? theme.success : passou ? theme.separator : theme.text },
                    ]}
                  />
                  {i < lembretes.length - 1 ? <View style={[styles.fio, { backgroundColor: theme.rail }]} /> : null}
                </View>
                <View style={styles.textos}>
                  <ThemedText type="default" themeColor={passou ? 'textSecondary' : 'text'}>
                    {r.title}
                  </ThemedText>
                  {r.channel === 'whatsapp' || r.recurrence ? (
                    <View style={styles.meta}>
                      {r.channel === 'whatsapp' ? (
                        <>
                          <Icon name="bubble.left" size="xs" color="textSecondary" />
                          <ThemedText type="caption" themeColor="textSecondary">
                            WhatsApp
                          </ThemedText>
                        </>
                      ) : null}
                      {r.recurrence ? <Icon name="arrow.clockwise" size="xs" color="textSecondary" /> : null}
                    </View>
                  ) : null}
                </View>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  linha: { flexDirection: 'row', gap: Space.md, paddingHorizontal: Space.lg, minHeight: 56 },
  hora: { width: 56, paddingVertical: Space.md, gap: Space.half },
  eixo: { width: 10, alignItems: 'center', paddingTop: Space.md + 5 },
  ponto: { width: 10, height: 10, borderRadius: Radius.pill },
  fio: { width: 2, flex: 1, marginTop: Space.xs, borderRadius: Radius.pill },
  textos: { flex: 1, minWidth: 0, paddingVertical: Space.md, gap: Space.half },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
});
```

- [ ] **Step 3: `src/components/finance/budget-rings.tsx`**

```tsx
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { useBRL } from '@/components/ui/conceal';
import { RingGauge } from '@/components/ui/ring-gauge';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { OrcamentoApertado } from '@/lib/budget-tight';

/**
 * Orçamentos no limite como anéis numa fileira que rola na horizontal — Hoje e Financeiro.
 *
 * O anel mostra o GASTO (o número da tela); a cor mostra o AVISO, que conta o comprometido
 * (`finance.md`). Um toque abre Orçamentos.
 */
export function BudgetRings({ itens, onPress }: { itens: readonly OrcamentoApertado[]; onPress: () => void }) {
  const theme = useTheme();
  const brl = useBRL();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fileira}>
      {itens.map((o) => {
        const pct = Math.round(o.fracaoGasta * 100);
        return (
          <PressableScale
            key={o.categoria}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={`${o.categoria}, ${pct}% do limite de ${brl(o.limite)}`}
            onPress={onPress}
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
            <RingGauge value={o.fracaoGasta} size={64} stroke={7} tone={o.estourou ? 'danger' : 'warning'}>
              <ThemedText type="code" style={tabular}>{`${pct}%`}</ThemedText>
            </RingGauge>
            <View style={styles.textos}>
              <ThemedText type="headline">{o.categoria}</ThemedText>
              <ThemedText type="caption" themeColor={o.restante < 0 ? 'danger' : 'textSecondary'}>
                {o.restante < 0 ? `${brl(-o.restante)} acima` : `${brl(o.restante)} restantes`}
              </ThemedText>
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fileira: { gap: Space.md, paddingRight: Space.lg },
  card: {
    width: 148,
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  textos: { gap: Space.half },
});
```

`ScrollView` horizontal dentro do `Screen` é o `ScrollView` da RN: correto aqui (não há arraste de reordenar).

- [ ] **Step 4: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: limpo e verde. Se o `icon-map.test.ts` acusar algum nome, acrescentar a entrada no mapa `MATERIAL` de `icon.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/feed/agenda-item.tsx src/components/feed/reminder-timeline.tsx src/components/finance/budget-rings.tsx
git commit -m "feat(hoje): card de compromisso, linha do tempo de lembretes e anéis de orçamento"
```

---

### Task 10: Primeiros passos e "Diga ao agente…"

**Files:**
- Create: `src/hooks/use-setup-progress.ts`, `src/components/feed/setup-checklist.tsx`, `src/components/feed/agent-prompt.tsx`

**Interfaces:**
- Consumes: `passosDeConfiguracao`, `progresso`, `Passo` (Task 2); `EXEMPLOS_DO_AGENTE` (Task 2); `RingGauge` (Task 7); `useSession`, `useProfile`, `useAccounts`, `useRecentTransactions`.
- Produces:
  - `useSetupProgress(): { passos: Passo[]; pronto: boolean; consultas: Consulta[] }`
  - `SetupChecklist({ passos: readonly Passo[]; onOpen: (p: Passo) => void; onHide: () => void })`
  - `AgentPrompt({ onPress: () => void })`

- [ ] **Step 1: `src/hooks/use-setup-progress.ts`**

```ts
import { useMemo } from 'react';

import { useAccounts, useRecentTransactions } from '@/hooks/use-finance';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import type { Consulta } from '@/hooks/use-tela-pronta';
import { passosDeConfiguracao, type Passo } from '@/lib/setup-steps';

/**
 * Os Primeiros passos a partir do banco. `useRecentTransactions(5)` é a MESMA chave que as
 * raízes já leem — o TanStack não busca de novo.
 */
export function useSetupProgress(): { passos: Passo[]; pronto: boolean; consultas: Consulta[] } {
  const { session } = useSession();
  const perfil = useProfile(session?.user?.id);
  const contas = useAccounts();
  const recentes = useRecentTransactions(5);

  const passos = useMemo(
    () =>
      passosDeConfiguracao({
        telefone: perfil.data?.phone,
        contas: contas.data?.length ?? 0,
        temLancamento: (recentes.data?.length ?? 0) > 0,
      }),
    [perfil.data?.phone, contas.data?.length, recentes.data?.length]
  );

  return {
    passos,
    // Afirmar "falta fazer" exige resposta das três (a régua do `isSuccess` de `frontend.md`).
    pronto: perfil.isSuccess && contas.isSuccess && recentes.isSuccess,
    consultas: [perfil, contas, recentes],
  };
}
```

- [ ] **Step 2: `src/components/feed/setup-checklist.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { RingGauge } from '@/components/ui/ring-gauge';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { showItemActions } from '@/lib/item-actions';
import { progresso, type Passo } from '@/lib/setup-steps';

/**
 * O card de quem acabou de chegar: três passos ligados a dado real, com o anel do progresso.
 * Some sozinho quando os três estão feitos (a tela decide), e "Agora não" esconde neste aparelho.
 */
export function SetupChecklist({
  passos,
  onOpen,
  onHide,
}: {
  passos: readonly Passo[];
  onOpen: (p: Passo) => void;
  onHide: () => void;
}) {
  const theme = useTheme();
  const { feitos, total } = progresso(passos);
  const faltam = total - feitos;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.topo}>
        <RingGauge
          value={feitos / total}
          size={48}
          stroke={5}
          tone="success"
          accessibilityLabel={`${feitos} de ${total} passos feitos`}>
          <ThemedText type="code" style={tabular}>{`${feitos}/${total}`}</ThemedText>
        </RingGauge>
        <View style={styles.titulos}>
          <ThemedText type="headline">Primeiros passos</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {faltam === 1 ? 'Falta 1' : `Faltam ${faltam}`}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mais opções dos primeiros passos"
          hitSlop={(HitTarget - 32) / 2}
          onPress={() => showItemActions('Primeiros passos', [{ label: 'Agora não', icon: 'eye.slash', onPress: onHide }])}
          style={[styles.mais, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="ellipsis" size="sm" color="text" />
        </Pressable>
      </View>
      <View>
        {passos.map((p) => (
          <LinhaDoPasso key={p.id} passo={p} onOpen={onOpen} />
        ))}
      </View>
    </View>
  );
}

function LinhaDoPasso({ passo, onOpen }: { passo: Passo; onOpen: (p: Passo) => void }) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const marca = useSharedValue(passo.feito ? 1 : 0);
  const antes = useRef(passo.feito);

  // Só a TRANSIÇÃO anima (aberto → feito); montar já feito não pula (a lição do alfinete de Notas).
  useEffect(() => {
    if (antes.current === passo.feito) return;
    antes.current = passo.feito;
    const alvo = passo.feito ? 1 : 0;
    marca.set(reduzido ? alvo : withSpring(alvo, Motion.spring.encaixe));
  }, [passo.feito, marca, reduzido]);

  const preenchido = useAnimatedStyle(() => ({
    opacity: marca.get(),
    transform: [{ scale: 0.6 + marca.get() * 0.4 }],
  }));

  const conteudo = (pressed: boolean) => (
    <View style={[styles.passo, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <View style={[styles.caixa, { borderColor: passo.feito ? theme.success : theme.separator }]}>
        <Animated.View style={[styles.caixaCheia, { backgroundColor: theme.success }, preenchido]}>
          <Icon name="checkmark" size="xs" color="onTint" />
        </Animated.View>
      </View>
      <ThemedText
        type="default"
        themeColor={passo.feito ? 'textSecondary' : 'text'}
        style={[styles.passoTexto, passo.feito && styles.riscado]}>
        {passo.titulo}
      </ThemedText>
      {passo.feito ? null : <Icon name="chevron.right" size="sm" color="textSecondary" />}
    </View>
  );

  if (passo.feito) return conteudo(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={passo.titulo} onPress={() => onOpen(passo)}>
      {({ pressed }) => conteudo(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.md,
    paddingTop: Space.lg,
    paddingBottom: Space.sm,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  topo: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg },
  titulos: { flex: 1, minWidth: 0, gap: Space.half },
  mais: { width: 32, height: 32, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  passo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget + Space.sm,
    paddingHorizontal: Space.lg,
  },
  caixa: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caixaCheia: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passoTexto: { flex: 1 },
  riscado: { textDecorationLine: 'line-through' },
});
```

- [ ] **Step 3: `src/components/feed/agent-prompt.tsx`**

```tsx
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { EXEMPLOS_DO_AGENTE } from '@/lib/agent-prompts';

/** Tempo de cada exemplo na pílula. */
const TROCA_MS = 3500;

/**
 * "Diga ao agente…" — a ação primária da Hoje: a PORTA para uma conversa nova, não um segundo
 * compositor. Os exemplos alternam enquanto a tela está em foco e param com Reduzir Movimento.
 *
 * Só `entering`, sem `exiting`: com os dois o exemplo velho e o novo ocupam a mesma linha ao
 * mesmo tempo, e com fonte grande um deles seria cortado.
 */
export function AgentPrompt({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const scheme = useScheme();
  const reduzido = useReducedMotion();
  const [indice, setIndice] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (reduzido) return undefined;
      const id = setInterval(() => setIndice((i) => (i + 1) % EXEMPLOS_DO_AGENTE.length), TROCA_MS);
      return () => clearInterval(id);
    }, [reduzido])
  );

  return (
    <PressableScale
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel="Diga ao agente"
      accessibilityHint="Abre uma conversa nova"
      onPress={onPress}
      style={[
        styles.pilula,
        { backgroundColor: theme.surface, borderColor: theme.cardBorder, boxShadow: Elevation[scheme].raised },
      ]}>
      <View style={[styles.selo, { backgroundColor: theme.heroSurface }]}>
        <Mark size={18} color="onHero" />
      </View>
      <View style={styles.textos}>
        <ThemedText type="caption" themeColor="textSecondary">
          Diga ao agente
        </ThemedText>
        <Animated.View key={indice} entering={reduzido ? undefined : FadeInDown.duration(Motion.duration.slow)}>
          <ThemedText type="small" style={styles.semEncolher}>
            {`“${EXEMPLOS_DO_AGENTE[indice]}”`}
          </ThemedText>
        </Animated.View>
      </View>
      <View style={[styles.enviar, { backgroundColor: theme.tintFill }]}>
        <Icon name="arrow.up" size="sm" color="onTint" />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 64,
    paddingVertical: Space.sm,
    paddingLeft: Space.sm,
    paddingRight: Space.sm,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  selo: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  textos: { flex: 1, minWidth: 0, gap: Space.half },
  // Texto dentro de container com `entering`: sem encolher, ou ele não se remede (§3).
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  enviar: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 4: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: limpo e verde. (`Consulta` é reexportado por `use-tela-pronta.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-setup-progress.ts src/components/feed/setup-checklist.tsx src/components/feed/agent-prompt.tsx
git commit -m "feat(hoje): primeiros passos com progresso e a porta para o agente"
```

---

### Task 11: A Hoje nova (sem a Conversa)

**Files:**
- Modify (reescrita): `src/app/(tabs)/today/index.tsx`
- Modify: `src/lib/simple-finance-ui.test.ts` (harness + testes da Hoje)

**Interfaces:**
- Consumes: tudo das Tasks 1–10; `useSpendable`, `useCycle`, `useUpcomingBills`, `useUpcomingCardCharges`, `useBudgetsStatus`, `useMarkPaid`, `useTodayReminders`, `useProfile`, `useSession`, `useBoolPref`, `useTelaPronta`.
- Produces: `TodayScreen` (default export), com os blocos na ordem da spec; os pontos de encaixe da Fase 2 são o comentário `{/* CONVERSA */}` e a chamada `montarPista(…, [], …)`.

- [ ] **Step 1: Estender o harness** — em `src/lib/simple-finance-ui.test.ts`:

1. Tipo de `options` em `screen(...)`: acrescentar `bills?: any[]; billsError?: boolean; charges?: any[]; setupPassos?: any[]; activity?: any[]; activityError?: boolean`.
2. No objeto do `Proxy` de `finance`, acrescentar:
```ts
    useUpcomingBills: () => ({
      ...query,
      isSuccess: !options.billsError,
      isError: Boolean(options.billsError),
      data: options.billsError ? undefined : (options.bills ?? []),
      refetch: async () => { refetches.push('bills'); },
    }),
    useUpcomingCardCharges: () => ({ ...query, isSuccess: true, data: options.charges ?? [] }),
    useSpendablePath: () => ({ ...query, isSuccess: true, data: [] }),
    useMarkPaid: () => mutation('markPaid'),
```
3. No mock de `react`, acrescentar `useCallback: (fn: unknown) => fn, useRef: (v: unknown) => ({ current: v }), useEffect: () => {},`.
4. No mock de `react-native-reanimated`, acrescentar `FadeOut: animation, FadeIn: animation,`.
5. Antes do `return new Proxy(...)` final do `require`, acrescentar:
```ts
      if (name === '@/hooks/use-session') return { useSession: () => ({ session: { user: { id: 'user-1' } } }) };
      if (name === '@/hooks/use-profile') return { useProfile: () => ({ ...query, isSuccess: true, data: { display_name: 'Gabriel Almeida', phone: null } }) };
      if (name === '@/hooks/use-setup-progress') return { useSetupProgress: () => ({ passos: options.setupPassos ?? [], pronto: true, consultas: [] }) };
      if (name === '@/hooks/use-bool-pref') return { useBoolPref: () => [false, () => {}] };
      if (name === '@/hooks/use-agent-activity') return {
        useAgentActivity: () => ({
          ...query,
          isSuccess: !options.activityError,
          isError: Boolean(options.activityError),
          data: options.activityError ? undefined : (options.activity ?? []),
          refetch: async () => { refetches.push('activity'); },
        }),
      };
```
6. No mock de `@/hooks/use-items`, acrescentar `useTodayReminders: () => ({ ...query, isSuccess: true }),`.
7. Na condição que carrega `src/lib/<nome>.ts` de verdade, acrescentar `|| name === '@/lib/today-sections' || name === '@/lib/runway' || name === '@/lib/budget-tight' || name === '@/lib/setup-steps' || name === '@/lib/activity-feed'`.

- [ ] **Step 2: Testes que falham** — acrescentar ao fim de `src/lib/simple-finance-ui.test.ts` (o harness fixa hoje em `2026-09-08`):

```ts
const hojeFile = 'src/app/(tabs)/today/index.tsx';
const agendaItem = (ui: ReturnType<typeof screen>, title?: string) =>
  ui.nodes().find((n: any) => n.type === 'AgendaItem' && (!title || n.props.title === title));

test('Hoje: o atrasado aparece em Agora e o botão dá baixa no lançamento certo', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
  });
  const item = agendaItem(ui, 'Luz');
  assert.ok(item, 'a conta atrasada precisa estar na tela');
  assert.equal(item.props.meta, 'venceu 01/09');
  item.props.action.onPress();
  assert.deepEqual(ui.writes.map((w) => w.operation), ['markPaid']);
  assert.equal(ui.writes[0].value.id, 'luz-1');
});

test('Hoje: fatura atrasada leva para a fatura, nunca dá baixa de lançamento', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'fat-1', title: 'Fatura Nubank', due_date: '2026-09-01', amount_cents: 135000, kind: 'invoice', overdue: true }],
  });
  agendaItem(ui).props.action.onPress();
  assert.equal(ui.writes.length, 0);
  assert.deepEqual(ui.navigations.at(-1), { pathname: '/finance/invoice/[id]', params: { id: 'fat-1' } });
});

test('Hoje: compra que vai cair no cartão aparece nos próximos dias e abre a fatura', () => {
  const ui = screen(hojeFile, {
    charges: [{ id: 'c-1', title: 'DAS', occurred_at: '2026-09-10', amount_cents: 7000, card: 'Nubank', invoice_id: 'f-9' }],
  });
  const item = agendaItem(ui, 'DAS');
  assert.equal(item.props.cartao, 'Nubank');
  item.props.action.onPress();
  assert.deepEqual(ui.navigations.at(-1), { pathname: '/finance/invoice/[id]', params: { id: 'f-9' } });
});

test('Hoje: usuário novo vê os Primeiros passos, e a pílula do agente abre conversa nova', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: false, href: '/link-phone' }],
  });
  const passos = ui.nodes().find((n: any) => n.type === 'SetupChecklist');
  assert.ok(passos, 'o card de primeiros passos precisa aparecer');
  passos.props.onOpen(passos.props.passos[0]);
  assert.equal(ui.navigations.at(-1), '/link-phone');
  ui.nodes().find((n: any) => n.type === 'AgentPrompt').props.onPress();
  assert.equal(ui.navigations.at(-1), '/agent/new');
});

test('Hoje: com os passos todos feitos o card não aparece', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: true, href: '/link-phone' }],
  });
  assert.ok(!tipos(ui).includes('SetupChecklist'));
});

test('Hoje: falha nas contas mostra o erro em Agora, e o "Tentar de novo" refaz as contas', () => {
  const ui = screen(hojeFile, { billsError: true });
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro, 'seção que falha diz que falhou (§7)');
  erro.props.onRetry();
  assert.ok(ui.refetches.includes('bills'));
  assert.ok(!ui.nodes().some((n: any) => n.type === 'ThemedText' && String(n.props.children).startsWith('Nada vence')),
    'sem resposta das contas a tela não afirma que nada vence');
});

test('Hoje: dia sem nada diz que nada vence, sem inventar lista', () => {
  const ui = screen(hojeFile, {});
  assert.ok(!tipos(ui).includes('AgendaItem'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && String(n.props.children).startsWith('Nada vence')));
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test src/lib/simple-finance-ui.test.ts`
Expected: os testes "Hoje:" falham (a tela ainda é a antiga: não há `AgendaItem`); os do Financeiro continuam passando.

- [ ] **Step 4: Reescrever `src/app/(tabs)/today/index.tsx`**

```tsx
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { ErrorCard } from '@/components/error-card';
import { AgendaItem } from '@/components/feed/agenda-item';
import { AgentPrompt } from '@/components/feed/agent-prompt';
import { ReminderTimeline } from '@/components/feed/reminder-timeline';
import { SetupChecklist } from '@/components/feed/setup-checklist';
import { BudgetRings } from '@/components/finance/budget-rings';
import { ThemedText } from '@/components/themed-text';
import { AppHeader } from '@/components/ui/app-header';
import { BlockHeader } from '@/components/ui/block-header';
import { useBRL } from '@/components/ui/conceal';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { DayRail } from '@/components/ui/day-rail';
import { HeroPanel } from '@/components/ui/hero-panel';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { RunwayBar } from '@/components/ui/runway-bar';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonHero, SkeletonList } from '@/components/ui/skeleton';
import { Tile, TileRow } from '@/components/ui/tile';
import { useToast } from '@/components/ui/toast';
import type { ThemeColor } from '@/constants/theme';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useBoolPref } from '@/hooks/use-bool-pref';
import {
  useBudgetsStatus,
  useCycle,
  useMarkPaid,
  useSpendable,
  useUpcomingBills,
  useUpcomingCardCharges,
} from '@/hooks/use-finance';
import { localISODate, useTodayReminders } from '@/hooks/use-items';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useSetupProgress } from '@/hooks/use-setup-progress';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { orcamentosApertados } from '@/lib/budget-tight';
import { diaCurtoBR, diasAte, greetingBR, isoToBR, rotuloDoDia } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { montarPista } from '@/lib/runway';
import { settleDone, settleLabel } from '@/lib/settle-labels';
import { agendaDoDia, iconeDoItem, metaDoItem, type ItemDaAgenda } from '@/lib/today-sections';

/**
 * A Hoje — "Conversa organizada" (spec 2026-09-17).
 *
 * Duas vozes: o app fala nos blocos com o selo da marca (o livre, Agora, Próximos dias) e a
 * pessoa fala na Conversa (Fase 2). A ordem continua sendo de URGÊNCIA: o que dá para gastar,
 * o que exige ação hoje, e só então o que vem.
 *
 * O herói NÃO repete o Financeiro: aqui é "quanto dá para gastar até entrar dinheiro de novo"
 * (`caixa − comprometido_ate_entrada`); lá é "como o ciclo fecha". A identidade que amarra os
 * dois está em `supabase/tests/da_para_gastar.sql`.
 */

/** Uma instância só: `LinearTransition` recriado a cada render remonta a animação. */
const linear = LinearTransition.duration(Motion.duration.base);

/** Bloco que some sem dar tranco no resto (§5: mudança de estado). A entrada é do `Screen`. */
function Bloco({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View style={styles.bloco} layout={linear} exiting={FadeOut.duration(Motion.duration.exit)}>
      {children}
    </Animated.View>
  );
}

/** O número de um contador: cor só quando conta alguma coisa; `null` = a consulta falhou. */
function Contagem({ valor, tom }: { valor: number | null; tom: ThemeColor }) {
  return (
    <ThemedText
      type="subtitle"
      themeColor={valor === null ? 'textSecondary' : valor > 0 ? tom : 'text'}
      style={tabular}>
      {valor ?? '—'}
    </ThemedText>
  );
}

export default function TodayScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const toast = useToast();
  const hoje = localISODate();
  const [agora] = useState(() => Date.now());

  const { session } = useSession();
  const profile = useProfile(session?.user?.id);
  /** Só o primeiro nome: "Bom dia, Gabriel Almeida Dias" é um crachá, não um cumprimento. */
  const primeiroNome = profile.data?.display_name?.trim().split(/\s+/)[0];

  const cycle = useCycle();
  const gasto = useSpendable();
  const bills = useUpcomingBills(7);
  // Limitado de propósito: a Hoje não é o extrato do cartão. A lista inteira mora na fatura.
  const noCartao = useUpcomingCardCharges(6);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();
  const setup = useSetupProgress();
  const [passosEscondidos, esconderPassos] = useBoolPref(`hoje:passos-escondidos:${session?.user?.id ?? ''}`);
  const markPaid = useMarkPaid();

  const caixa = Number(gasto.data?.caixa ?? 0);
  const comprometido = Number(gasto.data?.comprometido_ate_entrada ?? 0);
  const comprometidoNoCiclo = Number(gasto.data?.comprometido_no_ciclo ?? 0);
  const proximaEntrada = gasto.data?.proxima_entrada ?? null;
  const livre = caixa - comprometido;
  /** Até quando o "livre" vale: a próxima entrada, ou o fim do ciclo se não houver nenhuma. */
  const ateQuando = proximaEntrada ?? cycle.data?.ate ?? null;
  const diasLivres = Math.max(1, ateQuando ? diasAte(ateQuando, hoje) : (cycle.data?.diasAteOFim ?? 1));

  // CONVERSA: na Fase 2 o terceiro argumento passa a ser `caminho.data` (`useSpendablePath`).
  const pista = useMemo(
    () => montarPista(caixa, comprometido, [], hoje, ateQuando ?? hoje),
    [caixa, comprometido, hoje, ateQuando]
  );
  const agenda = useMemo(
    () => agendaDoDia(bills.data ?? [], noCartao.data ?? [], hoje),
    [bills.data, noCartao.data, hoje]
  );
  const atrasados = agenda.agora.filter((i) => i.atrasado);
  const doDia = agenda.agora.filter((i) => !i.atrasado);
  /** O contador "Vencendo" e o badge são SÓ de despesa (receita prevista não vence). */
  const contas = (bills.data ?? []).filter((b) => b.kind !== 'income');
  const lembretes = reminders.data ?? [];
  const apertados = useMemo(() => orcamentosApertados(budgets.data ?? []), [budgets.data]);

  /*
    A segunda linha do herói é o VEREDITO DO DIA: obrigação (devo alguma coisa?) ganha de
    permissão (posso gastar?). "Por dia" some abaixo de R$ 1,00 — um número ridículo no lugar
    mais nobre da tela ensina a pessoa a não ler a linha.
  */
  const atrasadoCents = atrasados.filter((i) => i.kind !== 'income').reduce((s, i) => s + i.cents, 0);
  const venceHojeCents = doDia.filter((i) => i.kind !== 'income').reduce((s, i) => s + i.cents, 0);
  const porDia = livre > 0 ? Math.floor(livre / diasLivres) : 0;
  const dias = `${diasLivres} ${diasLivres === 1 ? 'dia' : 'dias'}`;
  const veredito: { icon: React.ComponentProps<typeof Icon>['name']; negative: boolean; text: string } =
    atrasadoCents > 0
      ? { icon: 'exclamationmark.triangle', negative: true, text: `${brl(atrasadoCents)} atrasado` }
      : venceHojeCents > 0
        ? { icon: 'clock', negative: true, text: `${brl(venceHojeCents)} vence hoje` }
        : porDia >= 100
          ? { icon: 'calendar', negative: false, text: `≈ ${brl(porDia)} por dia · ${dias}` }
          : { icon: 'checkmark.circle', negative: false, text: `Nada vence hoje · ${dias} até entrar` };

  const mostrarPassos = setup.pronto && !passosEscondidos && setup.passos.some((p) => !p.feito);
  const diaCalmo =
    bills.isSuccess &&
    reminders.isSuccess &&
    agenda.agora.length === 0 &&
    agenda.proximos.length === 0 &&
    lembretes.length === 0;

  /*
    O PORTÃO DA TELA (Fase 5 do redesenho anterior): a Hoje abre inteira ou não abre. `profile`
    pode nascer desligada e mesmo assim entra — `telaPronta` lê `fetchStatus`.
  */
  const pronta = useTelaPronta(cycle, profile, gasto, bills, noCartao, reminders, budgets, ...setup.consultas);

  const pay = (id: string, title: string, kind: string | null | undefined) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${title}: ${settleDone(kind)}.`, tone: 'success' }),
        onError: () => toast({ message: `Não deu para dar baixa em ${title}.`, tone: 'error' }),
      }
    );

  /*
    `debt` é a prestação de um financiamento e `ref_id` é o id da DÍVIDA: dar baixa de
    lançamento nele não acharia nada. Fatura e dívida vão para a própria tela; compra no cartão
    vai para a fatura em que ela vai cair.
  */
  const acaoDoItem = (i: ItemDaAgenda): React.ComponentProps<typeof AgendaItem>['action'] => {
    if (i.kind === 'card' && i.faturaId) {
      const id = i.faturaId;
      return { label: 'Ver fatura', icon: 'chevron.right', onPress: () => router.push({ pathname: '/finance/invoice/[id]', params: { id } }) };
    }
    if (i.kind === 'card') return undefined;
    if (i.kind === 'invoice') {
      return { label: 'Pagar fatura', icon: 'checkmark', onPress: () => router.push({ pathname: '/finance/invoice/[id]', params: { id: i.ref_id } }) };
    }
    if (i.kind === 'debt') return { label: 'Ver dívida', icon: 'chevron.right', onPress: () => router.push('/finance/debts') };
    return {
      label: settleLabel(i.kind === 'income' ? 'income' : 'expense'),
      icon: 'checkmark',
      onPress: () => pay(i.ref_id, i.title, i.kind),
    };
  };

  /**
   * A linha ABRE o lançamento — quando a conta veio diferente do previsto ("a luz veio 180"),
   * dar baixa gravaria o valor errado, e sem este caminho não havia como corrigir antes.
   */
  const abrirItem = (i: ItemDaAgenda) =>
    i.kind === 'transaction' || i.kind === 'income' || i.kind === 'card'
      ? () => router.push({ pathname: '/finance/[txId]', params: { txId: i.ref_id } })
      : undefined;

  const itemDaAgenda = (i: ItemDaAgenda, onde: 'agora' | 'proximos') => {
    const meta = metaDoItem(i, onde);
    return (
      <AgendaItem
        key={i.chave}
        title={i.title}
        meta={meta.texto}
        metaTone={meta.tom}
        cents={i.cents}
        valueTone={i.kind === 'income' ? 'success' : i.atrasado ? 'danger' : 'text'}
        icon={iconeDoItem(i)}
        cartao={i.cartao}
        action={acaoDoItem(i)}
        onPress={abrirItem(i)}
      />
    );
  };

  /*
    O toque no herói abre o MENU. As opções são as mesmas nas duas raízes (menu que muda de forma
    conforme a tela é menu que se lê toda vez). `mes` e `view` saem do próprio `cycle.data`, nunca
    de um default — o destino tem que mostrar o período que o rodapé nomeou (`finance.md`).
  */
  const abrirMenu = () =>
    showItemActions('Mais opções', [
      ...(cycle.data
        ? [
            {
              label: 'Ver o que fecha o ciclo',
              icon: 'list.bullet' as const,
              onPress: () =>
                router.push({
                  pathname: '/finance/cycle',
                  params: { month: cycle.data.mes, view: cycle.data.view, tipo: 'sai' },
                }),
            },
          ]
        : []),
      { label: 'Projeção', icon: 'chart.line.uptrend.xyaxis', onPress: () => router.push('/finance/forecast') },
      { label: 'Patrimônio', icon: 'building.columns', onPress: () => router.push('/finance/net-worth') },
      { label: 'Metas', icon: 'target', onPress: () => router.push('/finance/goals') },
    ]);

  if (!pronta) {
    return (
      <Screen topBar={<AppHeader title="Hoje" />}>
        <View style={styles.cabecalho}>
          <Skeleton width="28%" height={12} />
          <Skeleton width="60%" height={28} />
        </View>
        <SkeletonHero />
        <View style={styles.linhaEsqueleto}>
          <Skeleton width="31%" height={64} radius={Radius.md} />
          <Skeleton width="31%" height={64} radius={Radius.md} />
          <Skeleton width="31%" height={64} radius={Radius.md} />
        </View>
        <Skeleton height={64} radius={Radius.pill} />
        <SkeletonList linhas={3} />
      </Screen>
    );
  }

  return (
    <Screen
      stagger
      topBar={<AppHeader title="Hoje" />}
      onRefresh={() =>
        Promise.all([
          gasto.refetch(),
          bills.refetch(),
          noCartao.refetch(),
          reminders.refetch(),
          budgets.refetch(),
          profile.refetch(),
          cycle.refetch(),
        ])
      }>
      <View style={styles.cabecalho}>
        <ThemedText type="caption" themeColor="textSecondary">
          {diaCurtoBR(hoje)}
        </ThemedText>
        {/* Sem nome (entrou por Phone OTP), a saudação some inteira em vez de virar "Bom dia,". */}
        {primeiroNome ? (
          <ThemedText type="title" style={styles.semEncolher}>
            {`${greetingBR()}, ${primeiroNome}`}
          </ThemedText>
        ) : null}
      </View>

      {gasto.isError ? (
        <ErrorCard onRetry={() => gasto.refetch()} />
      ) : (
        <HeroPanel
          surface="live"
          label={ateQuando ? `Livre até ${isoToBR(ateQuando)}` : 'Livre'}
          concealable
          value={<CountUpMoney cents={livre} variant="heroMoney" tone={livre < 0 ? 'onHeroDanger' : 'onHero'} />}
          secondary={veredito}
          chart={gasto.data ? <RunwayBar pista={pista} ate={ateQuando ?? hoje} entrada={proximaEntrada} /> : undefined}
          footer={
            cycle.data ? (
              <View style={styles.rodapeHeroi}>
                <ThemedText type="footnote" themeColor="onHeroMuted" style={styles.shrink}>
                  {`Compromissos até ${isoToBR(cycle.data.ate)}`}
                </ThemedText>
                <Money cents={comprometidoNoCiclo} variant="ticker" tone="onHero" concealable />
              </View>
            ) : undefined
          }
          onPress={abrirMenu}
        />
      )}

      {/* Os contadores só existem quando algum conta alguma coisa (badge é contagem real, §8). */}
      {contas.length + lembretes.length + apertados.length > 0 ? (
        <TileRow>
          <Tile
            compact
            label="Vencendo"
            value={<Contagem valor={contas.length} tom={atrasados.some((i) => i.kind !== 'income') ? 'danger' : 'text'} />}
            accessibilityLabel={`Vencendo: ${contas.length}`}
            onPress={() => router.push('/finance/transactions')}
          />
          <Tile
            compact
            label="Lembretes"
            value={<Contagem valor={lembretes.length} tom="warning" />}
            accessibilityLabel={`Lembretes: ${lembretes.length}`}
            onPress={() => router.push('/reminders')}
          />
          <Tile
            compact
            label="No limite"
            value={<Contagem valor={budgets.isError ? null : apertados.length} tom="warning" />}
            accessibilityLabel={budgets.isError ? 'No limite: não deu para carregar' : `No limite: ${apertados.length}`}
            onPress={() => router.push('/finance/budgets')}
          />
        </TileRow>
      ) : null}

      {mostrarPassos ? (
        <Bloco>
          <SetupChecklist
            passos={setup.passos}
            onOpen={(p) => router.push(p.href)}
            onHide={() => esconderPassos(true)}
          />
        </Bloco>
      ) : null}

      <AgentPrompt onPress={() => router.push('/agent/new')} />

      {bills.isError ? (
        <Bloco>
          <BlockHeader title="Agora" voice="app" />
          <ErrorCard onRetry={() => bills.refetch()} />
        </Bloco>
      ) : agenda.agora.length > 0 ? (
        <Bloco>
          <BlockHeader title="Agora" voice="app" count={agenda.agora.length} />
          <View>
            {atrasados.length > 0 ? (
              <DayRail label="atrasado" tone="danger" last={doDia.length === 0}>
                {atrasados.map((i) => itemDaAgenda(i, 'agora'))}
              </DayRail>
            ) : null}
            {doDia.length > 0 ? (
              <DayRail label="hoje" last>
                {doDia.map((i) => itemDaAgenda(i, 'agora'))}
              </DayRail>
            ) : null}
          </View>
        </Bloco>
      ) : null}

      {/* CONVERSA — entra aqui na Fase 2 (Task 17). */}

      {reminders.isError ? (
        <Bloco>
          <BlockHeader title="Lembretes" />
          <ErrorCard onRetry={() => reminders.refetch()} />
        </Bloco>
      ) : lembretes.length > 0 ? (
        <Bloco>
          <BlockHeader
            title="Lembretes"
            count={lembretes.length}
            action={{ label: 'Todos', onPress: () => router.push('/reminders') }}
          />
          <ReminderTimeline
            lembretes={lembretes}
            agora={agora}
            onOpen={(id) => router.push({ pathname: '/reminder-form', params: { id } })}
          />
        </Bloco>
      ) : null}

      {noCartao.isError ? (
        <Bloco>
          <BlockHeader title="Próximos dias" voice="app" />
          <ErrorCard onRetry={() => noCartao.refetch()} />
        </Bloco>
      ) : agenda.proximos.length > 0 ? (
        <Bloco>
          <BlockHeader title="Próximos dias" voice="app" />
          <View>
            {agenda.proximos.map((g, indice) => (
              <DayRail
                key={g.day}
                label={rotuloDoDia(g.day, hoje)}
                tone={g.itens.every((i) => i.kind === 'income') ? 'success' : 'neutral'}
                last={indice === agenda.proximos.length - 1}>
                {g.itens.map((i) => itemDaAgenda(i, 'proximos'))}
              </DayRail>
            ))}
          </View>
        </Bloco>
      ) : null}

      {budgets.isError ? (
        <Bloco>
          <BlockHeader title="No limite" />
          <ErrorCard onRetry={() => budgets.refetch()} />
        </Bloco>
      ) : apertados.length > 0 ? (
        <Bloco>
          <BlockHeader
            title="No limite"
            count={apertados.length}
            action={{ label: 'Orçamentos', onPress: () => router.push('/finance/budgets') }}
          />
          <BudgetRings itens={apertados} onPress={() => router.push('/finance/budgets')} />
        </Bloco>
      ) : null}

      {/* O dia calmo é o ÚLTIMO filho: não tem como aparecer acima de conteúdo nem se a regra errar. */}
      {diaCalmo ? (
        <View style={styles.calmo}>
          <Icon name="checkmark.circle" size="sm" color="success" />
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.shrink}>
            {proximaEntrada
              ? `Nada vence hoje · entra dinheiro ${isoToBR(proximaEntrada).slice(0, 5)}`
              : 'Nada vence nos próximos dias'}
          </ThemedText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shrink: { flex: 1, minWidth: 0 },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  cabecalho: { gap: Space.xs },
  bloco: { gap: Space.md },
  rodapeHeroi: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.lg,
  },
  linhaEsqueleto: { flexDirection: 'row', justifyContent: 'space-between' },
  calmo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingVertical: Space.sm,
  },
});
```

- [ ] **Step 5: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: tudo verde, inclusive os sete testes "Hoje:". Se o `anti-slop.test.ts` acusar algo (ex.: valor em texto visível fora de `Money`/`useBRL`), corrigir na tela, não na allowlist.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(tabs)/today/index.tsx" src/lib/simple-finance-ui.test.ts
git commit -m "feat(hoje): tela nova em conversa organizada com pista, agenda e primeiros passos"
```

---

### Task 12: Regras e verificação da Fase 1

**Files:**
- Modify: `.claude/rules/design.md` (§1, §2b)

- [ ] **Step 1: Registrar a liberação das regras** — em `.claude/rules/design.md`, logo abaixo do parágrafo "**O `HeroPanel` é um bloco de tinta**…" (§1), acrescentar:

```md
> **Mudou em 17/09/2026 nas raízes, a pedido do dono do produto** (*"quero algo bem bonito… nada
> de coisa comum"*; ao ser perguntado sobre as três regras abaixo: **"liberar o que ficar
> melhor"*). Spec: `docs/superpowers/specs/2026-09-17-hoje-financeiro-conversa-design.md`.
>
> - **Um destaque por tela** → na Hoje convivem o herói e os Primeiros passos.
> - **Sem degradê/brilho em conteúdo** → o herói das raízes usa `surface="live"`
>   (`InkSurface`: luz larga que segue a rolagem + grão fino, dois canvases, custo zero parado).
> - **Vidro só na chrome** → liberado e NÃO usado: sobre papel chapado não há o que refratar, e
>   esse motivo continua verdadeiro.
>
> A estrutura das raízes passou a ser **"Conversa organizada"**: o app fala nos blocos com o selo
> da marca (`BlockHeader voice="app"`), a pessoa fala em balões com o texto REAL que mandou, e o
> registro que a fala virou encaixa embaixo. Cabeçalho de bloco nas raízes é `BlockHeader`, não
> `SectionHead`.
```

- [ ] **Step 2: Subir os aparelhos** (se não estiverem no ar)

```bash
npx expo start --dev-client --port 8081   # em segundo plano
~/Library/Android/sdk/emulator/emulator -avd s26   # em segundo plano; depois desbloquear: WAKEUP, swipe, `adb shell input text 1234`, Enter
```

Provar que o bundle recarregou antes de medir (log "Bundled" novo no Metro depois do reload).

- [ ] **Step 3: Verificar no iOS** — `xcrun simctl openurl booted "appproops:///today"`; capturar claro e escuro (`xcrun simctl ui booted appearance dark|light`), topo e rolado; conferir:
  - cabeçalho do dia + saudação; herói com tinta viva (a luz anda ao rolar); a Pista com "hoje … entra DD/MM" e preenchimento na cor certa;
  - contadores, pílula "Diga ao agente…" (exemplo troca a cada 3,5 s) → abre `/agent/new`;
  - Agora com trilho vermelho/neutro e botões que funcionam (NÃO tocar em "Paguei" com dado real sem querer gravar — conferir a rota/menu, não a escrita);
  - Lembretes em linha do tempo; Próximos dias com minifase do cartão; anéis de orçamento;
  - o menu "…" do herói com as 4 opções.
- [ ] **Step 4: Verificar no Android** — `adb shell am start -a android.intent.action.VIEW -d "appproops:///today" -n com.proops.personal.dev/.MainActivity`; mesmas conferências; depois `adb shell wm density 560 && adb shell settings put system font_scale 1.30`, capturar, conferir que nada trunca nem sai do card; devolver `480`/`1.0`.
- [ ] **Step 5: Primeiros passos** — conferir o card com uma conta sem telefone (o `dev@` tem telefone? se tiver, o passo aparece feito). Conferir "Agora não" esconde e reabrir o app mantém escondido.
- [ ] **Step 6: Reduzir Movimento** — iOS (`defaults write com.apple.Accessibility ReduceMotionEnabled -bool true` + `notifyutil -p com.apple.accessibility.reduce.motion.status`, relançar) e Android (`adb shell settings put global transition_animation_scale 0`): a luz não anda, os exemplos param. Devolver os dois.
- [ ] **Step 7: Corrigir o que a verificação mostrar, em um lote; confirmar em mais uma rodada; commit**

```bash
git add .claude/rules/design.md
git commit -m "docs(design): regras liberadas nas raízes e a estrutura de conversa organizada"
```

---

# Fase 2 — Dados e a Conversa

### Task 13: Migration — a conversa que virou registro (staging)

**Files:**
- Create: `supabase/migrations/20260918120000_a_conversa_que_virou_registro.sql`
- Create: `supabase/tests/agent_activity.sql`
- Modify: `src/lib/database.types.ts` (regenerado)

**Interfaces:**
- Produces (SQL):
  - `executed_actions.user_id uuid`, `.workspace_id uuid`, `.origin_text text`
  - `public.agent_activity(p_limit int default 6)` → `(source_message_id text, executed_at timestamptz, channel text, input_kind text, origin_text text, session_id uuid, action_index int, action_type text, result_id uuid, record jsonb)`
  - `private.spendable_events_for(ws_ids uuid[], p_view text)` e `public.spendable_path(p_view text default null)` → `(day date, out_cents bigint, title text, origin text, ref_id uuid)`

- [ ] **Step 1: Escrever o teste** — `supabase/tests/agent_activity.sql` (sem `\set`: roda por psycopg, numa transação descartável):

```sql
-- agent_activity e spendable_path (20260918120000).
-- Rodar contra o STAGING numa transação descartável (ver o runner na Task 13 do plano).
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'conversa-a@teste.local', '{}', '{}'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'conversa-b@teste.local', '{}', '{}');

-- B participa do workspace de A: é o caso em que o texto de um NÃO pode aparecer para o outro.
insert into public.workspace_members (workspace_id, user_id, role)
select w.id, '00000000-0000-0000-0000-00000000e002', 'member'
from public.workspaces w where w.owner_id = '00000000-0000-0000-0000-00000000e001';

do $$
declare
  ws uuid;
  tx uuid;
begin
  select id into ws from public.workspaces where owner_id = '00000000-0000-0000-0000-00000000e001';

  insert into public.transactions (workspace_id, user_id, kind, amount_cents, occurred_at, category, description, source)
  values (ws, '00000000-0000-0000-0000-00000000e001', 'expense', 4500, current_date, 'mercado', 'Mercado', 'app')
  returning id into tx;

  -- A falou pelo app e criou o gasto.
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text)
  values ('app:11111111-1111-1111-1111-111111111111', 0, 'create_expense', tx,
          '00000000-0000-0000-0000-00000000e001', ws, 'gastei 45 no mercado');

  -- A criou uma nota que depois foi apagada: o registro volta nulo.
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text, executed_at)
  values ('app:22222222-2222-2222-2222-222222222222', 0, 'create_note', gen_random_uuid(),
          '00000000-0000-0000-0000-00000000e001', ws, 'anota a senha do wifi', now() - interval '1 hour');

  -- A mandou um lote pelo WhatsApp, com um áudio no meio.
  insert into public.messages_queue (wa_message_id, thread_id, phone, message_type, payload, batch_id, status)
  values
    ('wamid.teste-1', 'thread-teste-e001', '5511900000001', 'text', '{"text":{"body":"gastei 10"}}', '00000000-0000-0000-0000-0000000000b1', 'done'),
    ('wamid.teste-2', 'thread-teste-e001', '5511900000001', 'audio', '{"audio":{"id":"x"}}', '00000000-0000-0000-0000-0000000000b1', 'done');
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text, executed_at)
  values ('wamid.teste-2', 0, 'create_expense', tx,
          '00000000-0000-0000-0000-00000000e001', ws, E'gastei 10\nno pão', now() - interval '2 hours');

  -- B falou no MESMO workspace. A não pode ler isto.
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text)
  values ('app:33333333-3333-3333-3333-333333333333', 0, 'create_expense', tx,
          '00000000-0000-0000-0000-00000000e002', ws, 'segredo do B');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e001', true);
set local role authenticated;

do $$
declare
  linhas int;
  r record;
begin
  select count(*) into linhas from public.agent_activity(10);
  assert linhas = 3, format('A deveria ver 3 ações, viu %s', linhas);

  assert not exists (select 1 from public.agent_activity(10) where origin_text = 'segredo do B'),
    'o texto de B vazou para A';

  select * into r from public.agent_activity(10) where source_message_id like 'app:1111%';
  assert r.channel = 'app', 'canal do app';
  assert r.record->>'kind' = 'transaction', format('registro deveria ser transaction, veio %s', r.record);
  assert (r.record->>'amount_cents')::int = 4500, 'valor do registro';

  select * into r from public.agent_activity(10) where source_message_id like 'app:2222%';
  assert r.record is null, 'nota apagada deveria vir sem registro';

  select * into r from public.agent_activity(10) where source_message_id = 'wamid.teste-2';
  assert r.channel = 'whatsapp', 'canal do WhatsApp';
  assert r.input_kind = 'audio', format('lote com áudio deveria ser audio, veio %s', r.input_kind);

  -- p_limit conta FALAS, não linhas.
  select count(distinct source_message_id) into linhas from public.agent_activity(1);
  assert linhas = 1, format('p_limit 1 deveria trazer 1 fala, trouxe %s', linhas);

  raise notice 'ok: agent_activity isola por pessoa, resume o registro e agrupa o lote';
end $$;

-- A Pista soma exatamente o comprometido do herói.
do $$
declare
  s record;
  soma bigint;
begin
  select * into s from public.spendable();
  select coalesce(sum(out_cents), 0) into soma from public.spendable_path();
  assert soma = s.comprometido_ate_entrada,
    format('spendable_path soma %s e comprometido_ate_entrada é %s', soma, s.comprometido_ate_entrada);
  raise notice 'ok: spendable_path fecha com o livre';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  begin
    perform public.agent_activity(1);
    raise exception 'anon executou agent_activity';
  exception when insufficient_privilege then
    raise notice 'ok: anon sem execute';
  end;
end $$;

rollback;
```

- [ ] **Step 2: Escrever a migration** — `supabase/migrations/20260918120000_a_conversa_que_virou_registro.sql`:

```sql
-- A conversa que virou registro: a Hoje mostra o texto REAL que a pessoa mandou, preso ao
-- registro que ele criou (spec 2026-09-17, "Conversa organizada").
--
-- `executed_actions` já ligava a fala (`source_message_id`) ao registro (`result_id`), mas não
-- dizia de QUEM era nem o que ela disse. O agente passa a gravar os três na reserva; aqui eles
-- nascem, o histórico é preenchido e duas leituras novas aparecem.
--
-- ⚠️ A tabela continua infra: RLS ligada e SEM policy. O app lê pela porta `agent_activity`,
-- `security definer`, que devolve só o que é do chamador e NUNCA o `payload` da Meta (ele carrega
-- telefone).

alter table public.executed_actions
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists origin_text text;

create index if not exists executed_actions_atividade
  on public.executed_actions (user_id, executed_at desc)
  where user_id is not null;

comment on column public.executed_actions.origin_text is
  'A frase que originou a ação (ExecContext.texto): a mensagem do turno, a original numa retomada de SIM, o raw_text num rascunho completado.';

-- ── Retropreenchimento ────────────────────────────────────────────────────────────────────
-- Canal app: `app:<client_message_id>`.
update public.executed_actions ea
set user_id = s.user_id,
    workspace_id = s.workspace_id,
    origin_text = m.content
from public.app_chat_messages m
join public.user_sessions s on s.id = m.session_id
where ea.user_id is null
  and m.role = 'user'
  and s.user_id is not null
  and ea.source_message_id = 'app:' || m.client_message_id::text;

-- Canal WhatsApp: o id da ÚLTIMA mensagem do lote; o texto é o do lote inteiro, na ordem.
-- (No histórico, uma resposta de rascunho aparece com o próprio texto — só as ações novas levam
-- a frase original, que só o agente conhece.)
with texto as (
  select q.wa_message_id,
         string_agg(nullif(btrim(b.payload->'text'->>'body'), ''), E'\n' order by b.created_at) as corpo
  from public.messages_queue q
  join public.messages_queue b
    on (q.batch_id is not null and b.batch_id = q.batch_id) or b.id = q.id
  group by q.wa_message_id
)
update public.executed_actions ea
set user_id = s.user_id,
    workspace_id = s.workspace_id,
    origin_text = t.corpo
from public.messages_queue q
join public.user_sessions s on s.thread_id = q.thread_id and s.channel = 'whatsapp'
left join texto t on t.wa_message_id = q.wa_message_id
where ea.user_id is null
  and s.user_id is not null
  and ea.source_message_id = q.wa_message_id;

-- Sessão sem workspace: o workspace do registro que a ação criou.
update public.executed_actions ea
set workspace_id = coalesce(
  (select workspace_id from public.transactions where id = ea.result_id),
  (select workspace_id from public.installment_plans where id = ea.result_id),
  (select workspace_id from public.recurring_transactions where id = ea.result_id),
  (select workspace_id from public.reminders where id = ea.result_id),
  (select workspace_id from public.notes where id = ea.result_id),
  (select workspace_id from public.accounts where id = ea.result_id),
  (select workspace_id from public.goals where id = ea.result_id),
  (select workspace_id from public.debts where id = ea.result_id)
)
where ea.user_id is not null and ea.workspace_id is null and ea.result_id is not null;

-- ── A porta da Conversa ───────────────────────────────────────────────────────────────────
create or replace function public.agent_activity(p_limit int default 6)
returns table (
  source_message_id text,
  executed_at timestamptz,
  channel text,
  input_kind text,
  origin_text text,
  session_id uuid,
  action_index int,
  action_type text,
  result_id uuid,
  record jsonb
)
language sql stable security definer set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with minhas as (
    select ea.*
    from public.executed_actions ea
    where ea.user_id = auth.uid()
      and ea.workspace_id in (select private.my_workspace_ids())
  ),
  falas as (
    select m.source_message_id, max(m.executed_at) as quando
    from minhas m
    group by m.source_message_id
    order by quando desc
    limit greatest(1, least(coalesce(p_limit, 6), 30))
  )
  select
    m.source_message_id,
    m.executed_at,
    case when m.source_message_id like 'app:%' then 'app' else 'whatsapp' end,
    case
      when m.source_message_id like 'app:%' then 'text'
      when exists (
        select 1 from public.messages_queue b
        where b.batch_id = q.batch_id and b.message_type = 'audio'
      ) or q.message_type = 'audio' then 'audio'
      when q.message_type in ('image', 'document') then q.message_type
      when q.message_type in ('interactive', 'button') then 'click'
      else 'text'
    end,
    m.origin_text,
    app.session_id,
    m.action_index,
    m.action_type,
    m.result_id,
    case
      when t.id is not null then jsonb_build_object(
        'kind', 'transaction', 'id', t.id,
        'title', coalesce(nullif(t.description, ''), nullif(t.merchant, ''), t.category, 'Lançamento'),
        'amount_cents', t.amount_cents, 'tx_kind', t.kind, 'category', t.category,
        'occurred_at', t.occurred_at, 'account', a.name)
      when ip.id is not null then jsonb_build_object(
        'kind', 'installment_plan', 'id', ip.id,
        'title', coalesce(nullif(ip.description, ''), nullif(ip.merchant, ''), 'Compra parcelada'),
        'amount_cents', ip.total_cents, 'installments', ip.installments, 'category', ip.category)
      when rt.id is not null then jsonb_build_object(
        'kind', 'recurring', 'id', rt.id,
        'title', coalesce(nullif(rt.description, ''), rt.category, 'Recorrente'),
        'amount_cents', rt.amount_cents, 'tx_kind', rt.kind, 'category', rt.category)
      when r.id is not null then jsonb_build_object(
        'kind', 'reminder', 'id', r.id, 'title', r.title, 'next_run_at', r.next_run_at)
      when n.id is not null then jsonb_build_object(
        'kind', 'note', 'id', n.id,
        'title', left(split_part(btrim(n.content), E'\n', 1), 120))
      when ac.id is not null then jsonb_build_object(
        'kind', 'account', 'id', ac.id, 'title', ac.name, 'account_type', ac.type)
      when g.id is not null then jsonb_build_object(
        'kind', 'goal', 'id', g.id, 'title', g.name, 'amount_cents', g.target_cents)
      when d.id is not null then jsonb_build_object(
        'kind', 'debt', 'id', d.id, 'title', d.name, 'amount_cents', d.remaining_cents)
    end
  from falas f
  join minhas m on m.source_message_id = f.source_message_id
  left join public.messages_queue q on q.wa_message_id = m.source_message_id
  left join lateral (
    select acm.session_id
    from public.app_chat_messages acm
    join public.user_sessions s on s.id = acm.session_id and s.user_id = auth.uid()
    where m.source_message_id like 'app:%'
      and acm.role = 'user'
      and acm.client_message_id::text = substr(m.source_message_id, 5)
    limit 1
  ) app on true
  left join public.transactions t on t.id = m.result_id and t.workspace_id = m.workspace_id
  left join public.accounts a on a.id = t.account_id
  left join public.installment_plans ip on ip.id = m.result_id and ip.workspace_id = m.workspace_id
  left join public.recurring_transactions rt on rt.id = m.result_id and rt.workspace_id = m.workspace_id
  left join public.reminders r on r.id = m.result_id and r.workspace_id = m.workspace_id
  left join public.notes n on n.id = m.result_id and n.workspace_id = m.workspace_id and n.deleted_at is null
  left join public.accounts ac on ac.id = m.result_id and ac.workspace_id = m.workspace_id
  left join public.goals g on g.id = m.result_id and g.workspace_id = m.workspace_id
  left join public.debts d on d.id = m.result_id and d.workspace_id = m.workspace_id
  order by f.quando desc, m.source_message_id, m.action_index;
$$;

revoke execute on function public.agent_activity(int) from public, anon;
grant execute on function public.agent_activity(int) to authenticated;

-- ── A Pista: a MESMA lista que forma o "livre" ────────────────────────────────────────────
-- O `ev` de `spendable_for` vira função, e as duas leituras saem dela: duplicar o CTE seria a
-- segunda cópia da regra, e a Pista contradiria o herói sem erro nenhum.
create or replace function private.spendable_events_for(ws_ids uuid[], p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text, origin text, ref_id uuid)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with b as (
    select c.fim
    from private.cycle_bounds(
           private.cycle_close_day(ws_ids, p_view),
           private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date)) c
  )
  -- `not realizado`: o que já saiu da conta está DENTRO de `caixa`, não à frente dele.
  select e.day, e.in_cents, e.out_cents, e.title, e.origin, e.ref_id
  from b, private.cash_events(ws_ids, current_date, b.fim) e
  where not e.realizado;
$$;
revoke execute on function private.spendable_events_for(uuid[], text) from public, anon;
grant execute on function private.spendable_events_for(uuid[], text) to authenticated, service_role;

-- MESMO cabeçalho da `20260913180000` (invoker, search_path, fuso): cláusula não repetida some.
create or replace function private.spendable_for(ws_ids uuid[], p_view text default null)
returns table (caixa bigint, comprometido_ate_entrada bigint, comprometido_no_ciclo bigint,
               a_receber_no_ciclo bigint, proxima_entrada date)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with ev as (select * from private.spendable_events_for(ws_ids, p_view)),
  entrada as (select min(day) d from ev where in_cents > 0)
  select private.cash_total(ws_ids, current_date),
         -- `<=`: a despesa do dia da entrada conta (ver a `20260913180000`).
         coalesce((select sum(out_cents) from ev
                   where day <= coalesce((select d from entrada), 'infinity'::date)), 0)::bigint,
         coalesce((select sum(out_cents) from ev), 0)::bigint,
         coalesce((select sum(in_cents) from ev), 0)::bigint,
         (select d from entrada);
$$;

create or replace function public.spendable_path(p_view text default null)
returns table (day date, out_cents bigint, title text, origin text, ref_id uuid)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with ev as (
    select * from private.spendable_events_for(array(select private.my_workspace_ids()), p_view)
  ),
  entrada as (select min(day) d from ev where in_cents > 0)
  select ev.day, ev.out_cents, ev.title, ev.origin, ev.ref_id
  from ev
  where ev.out_cents > 0
    and ev.day <= coalesce((select d from entrada), 'infinity'::date)
  order by ev.day, ev.out_cents desc;
$$;
revoke execute on function public.spendable_path(text) from public, anon;
grant execute on function public.spendable_path(text) to authenticated;
```

- [ ] **Step 3: Confirmar o alvo e aplicar no STAGING**

```bash
./scripts/supabase-target.sh
npx supabase migration list --project-ref utkqoiigimqzeenxkxdl
npx supabase db push --project-ref utkqoiigimqzeenxkxdl
```
Expected: o alvo é `utkqoiigimqzeenxkxdl`; só a `20260918120000` pendente; push aplica sem erro.

- [ ] **Step 4: Rodar o teste SQL contra o staging**

```bash
cd agent && .venv/bin/python - <<'PY'
import psycopg
from dotenv import dotenv_values
url = dotenv_values('.env')['DATABASE_URL']
assert 'utkqoiigimqzeenxkxdl' in url, 'agent/.env tem que ser o STAGING'
sql = open('../supabase/tests/agent_activity.sql').read()
with psycopg.connect(url, autocommit=True) as c:
    c.add_notice_handler(lambda d: print(d.message_primary))
    c.execute(sql)
PY
cd ..
```
Expected: três linhas `ok: …` e nenhuma exceção (a transação termina em `rollback`). Rodar também `supabase/tests/da_para_gastar.sql` do mesmo jeito (a identidade do livre não pode ter mudado com o refactor de `spendable_for`).

- [ ] **Step 5: Tipos**

```bash
npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl > src/lib/database.types.ts
npx tsc --noEmit
```
Conferir no diff que só entraram `agent_activity`, `spendable_path` e as três colunas de `executed_actions`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918120000_a_conversa_que_virou_registro.sql supabase/tests/agent_activity.sql src/lib/database.types.ts
git commit -m "feat(db): leitura da conversa que virou registro e a pista do livre"
```

---

### Task 14: O agente grava dono e origem na reserva

**Files:**
- Modify: `agent/app/db.py` (`reserve_execution`)
- Modify: `agent/app/tools/registry.py:150`
- Modify: `agent/tests/test_resource_actions.py:109` (dublê)
- Test: `agent/tests/test_conversation_identity.py`

**Interfaces:**
- Produces: `reserve_execution(source_message_id: str, action_index: int, action_type: str, *, user_id: UUID | None = None, workspace_id: UUID | None = None, origin_text: str | None = None) -> bool`

- [ ] **Step 1: Teste que falha** — acrescentar em `agent/tests/test_conversation_identity.py`, depois de `test_reserva_de_execucao_e_do_turno_nao_da_meta`:

```python
@pytest.mark.asyncio
async def test_reserva_grava_dono_workspace_e_a_frase(sql):
    origem = "app:" + str(uuid4())
    dono, ws = uuid4(), uuid4()

    await db.reserve_execution(
        origem, 0, "create_expense", user_id=dono, workspace_id=ws, origin_text="gastei 45 no mercado"
    )

    texto = _texto(sql)
    for coluna in ("user_id", "workspace_id", "origin_text"):
        assert coluna in texto, f"a reserva não grava {coluna}"
    assert dono in sql[-1][1] and ws in sql[-1][1]
    assert "gastei 45 no mercado" in sql[-1][1]
```

(Conferir no topo do arquivo como a fixture `sql` registra as chamadas — `sql[i]` é `(consulta, args)`; se a fixture guardar `args` como tupla, `in` funciona igual.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agent && .venv/bin/pytest tests/test_conversation_identity.py -k dono -q`
Expected: FAIL — `unexpected keyword argument 'user_id'`.

- [ ] **Step 3: Implementar** — em `agent/app/db.py`, trocar `reserve_execution` por:

```python
async def reserve_execution(
    source_message_id: str,
    action_index: int,
    action_type: str,
    *,
    user_id: UUID | None = None,
    workspace_id: UUID | None = None,
    origin_text: str | None = None,
) -> bool:
    """Reserva a vaga ANTES de executar. False = já foi feita (ou está sendo).

    A ordem importa e é a correção do bug do fluxo antigo: lá as ações rodavam e
    SÓ DEPOIS o job era marcado done, então morrer no meio duplicava lançamento
    no retry. Reservando antes, a pior consequência de uma morte no meio é a ação
    NÃO acontecer — e o usuário reenvia.

    Dono, workspace e a frase de origem entram na MESMA linha: é o que a Hoje lê
    para mostrar o balão com o texto real (`public.agent_activity`). A frase é o
    `ExecContext.texto`, que já é a original numa retomada de SIM e o `raw_text`
    num rascunho completado.
    """
    row = await fetch_one(
        """
        insert into public.executed_actions
          (source_message_id, action_index, action_type, user_id, workspace_id, origin_text)
        values (%s, %s, %s, %s, %s, %s)
        on conflict (source_message_id, action_index) do nothing
        returning source_message_id
        """,
        source_message_id,
        action_index,
        action_type,
        user_id,
        workspace_id,
        (origin_text or "").strip()[:2000] or None,
    )
    return row is not None
```

(`UUID` já é importado em `db.py` — conferir; se não, `from uuid import UUID`.)

Em `agent/app/tools/registry.py`, linha 150:

```python
        if not await db.reserve_execution(
            ctx.source_message_id,
            ctx.action_index,
            action.type.value,
            user_id=ctx.user_id,
            workspace_id=ctx.workspace_id,
            origin_text=ctx.texto,
        ):
```

Em `agent/tests/test_resource_actions.py`, o dublê:

```python
    async def reserve(*a, **k):
        return True
```

- [ ] **Step 4: Rodar**

Run: `cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q`
Expected: verde. (Procurar outros dublês com `grep -rn "reserve_execution\|def reserve" agent/tests` e dar `**k` a todos.)

- [ ] **Step 5: Commit**

```bash
git add agent/app/db.py agent/app/tools/registry.py agent/tests/test_conversation_identity.py agent/tests/test_resource_actions.py
git commit -m "feat(agent): a reserva de execução guarda dono, workspace e a frase de origem"
```

- [ ] **Step 6: Deploy no STAGING — PERGUNTAR ao Gabriel antes**

Mensagem: "Posso subir o agente no staging (`./scripts/setup-gcp.sh staging` → deploy)? Sem isso a Conversa só mostra o histórico retropreenchido." Com o sim:

```bash
gcloud config get-value account   # a conta ativa tem que ser a do projeto (memória gcloud-conta-do-projeto)
./scripts/setup-gcp.sh staging deploy
```
Expected: deploy concluído; mandar uma mensagem pela aba Agente do app com `dev@` e conferir no staging:
`select source_message_id, user_id is not null, origin_text from public.executed_actions order by executed_at desc limit 3;` (pelo runner do Step 4 da Task 13, em modo leitura).

---

### Task 15: O feed da conversa (aritmética) e os hooks

**Files:**
- Create: `src/lib/activity-feed.ts`, `src/lib/activity-feed.test.ts`
- Create: `src/hooks/use-agent-activity.ts`
- Modify: `src/hooks/use-finance.ts` (depois de `useSpendable`)

**Interfaces:**
- Consumes: `rotuloDoDia`, `horaBR`, `localISODate` (Task 1); RPCs da Task 13.
- Produces:
  - `type RegistroResumido = { kind: 'transaction' | 'installment_plan' | 'recurring' | 'reminder' | 'note' | 'account' | 'goal' | 'debt'; id: string; title: string; amount_cents?: number; tx_kind?: string; category?: string | null; occurred_at?: string; account?: string | null; installments?: number; next_run_at?: string; account_type?: string }`
  - `type LinhaDaAtividade = { source_message_id: string; executed_at: string; channel: string; input_kind: string; origin_text: string | null; session_id: string | null; action_index: number; action_type: string; result_id: string | null; record: RegistroResumido | null }`
  - `type Destino = { pathname: string; params?: Record<string, string> }`
  - `type CardDaFala = { chave: string; verbo: 'criou' | 'alterou' | 'apagou'; rotulo: string; registro: RegistroResumido | null; destino: Destino | null }`
  - `type ParDaConversa = { chave: string; quando: string; dia: string; hora: string; canal: 'whatsapp' | 'app'; entrada: 'text' | 'audio' | 'image' | 'document' | 'click'; texto: string | null; sessao: string | null; cards: CardDaFala[] }`
  - `paresDaConversa(linhas: readonly LinhaDaAtividade[], hoje: string): ParDaConversa[]`
  - `useAgentActivity(limit?: number)`; `useSpendablePath(view?: CycleView)`

- [ ] **Step 1: Teste que falha** — `src/lib/activity-feed.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { paresDaConversa, type LinhaDaAtividade } from './activity-feed.ts';

const linha = (o: Partial<LinhaDaAtividade>): LinhaDaAtividade => ({
  source_message_id: 'app:1',
  executed_at: '2026-09-17T12:00:00-03:00',
  channel: 'app',
  input_kind: 'text',
  origin_text: 'gastei 45 no mercado',
  session_id: 'sessao-1',
  action_index: 0,
  action_type: 'create_expense',
  result_id: 'tx-1',
  record: { kind: 'transaction', id: 'tx-1', title: 'Mercado', amount_cents: 4500, tx_kind: 'expense', category: 'mercado' },
  ...o,
});

test('uma fala com duas ações vira UM balão com dois cards, na ordem das ações', () => {
  const pares = paresDaConversa(
    [
      linha({ action_index: 1, action_type: 'create_reminder', result_id: 'r-1', record: { kind: 'reminder', id: 'r-1', title: 'Aluguel', next_run_at: '2026-10-05T12:00:00Z' } }),
      linha({}),
    ],
    '2026-09-17'
  );
  assert.equal(pares.length, 1);
  assert.equal(pares[0].texto, 'gastei 45 no mercado');
  assert.equal(pares[0].dia, 'hoje');
  assert.deepEqual(pares[0].cards.map((c) => c.registro?.kind), ['transaction', 'reminder']);
  assert.deepEqual(pares[0].cards[0].destino, { pathname: '/finance/[txId]', params: { txId: 'tx-1' } });
  assert.deepEqual(pares[0].cards[1].destino, { pathname: '/reminder-form', params: { id: 'r-1' } });
});

test('falas diferentes viram pares diferentes, a mais recente primeiro', () => {
  const pares = paresDaConversa(
    [
      linha({ source_message_id: 'wamid.a', channel: 'whatsapp', executed_at: '2026-09-16T10:00:00-03:00', session_id: null }),
      linha({ source_message_id: 'app:2', executed_at: '2026-09-17T09:00:00-03:00' }),
    ],
    '2026-09-17'
  );
  assert.deepEqual(pares.map((p) => p.chave), ['app:2', 'wamid.a']);
  assert.equal(pares[1].dia, 'ontem');
  assert.equal(pares[1].canal, 'whatsapp');
  assert.equal(pares[1].sessao, null);
});

test('registro que sumiu depois de criado diz que foi apagado; o que não sabemos ler não afirma nada', () => {
  const [apagado] = paresDaConversa([linha({ action_type: 'create_note', record: null })], '2026-09-17');
  assert.equal(apagado.cards[0].rotulo, 'Nota apagada depois');
  assert.equal(apagado.cards[0].destino, null);
  const [regra] = paresDaConversa([linha({ action_type: 'set_rule', record: null })], '2026-09-17');
  assert.equal(regra.cards[0].rotulo, 'Regra salva');
  const [delecao] = paresDaConversa([linha({ action_type: 'delete_transaction', record: null })], '2026-09-17');
  assert.equal(delecao.cards[0].verbo, 'apagou');
  assert.equal(delecao.cards[0].rotulo, 'Lançamento apagado');
});

test('alteração é marcada como alteração', () => {
  const [p] = paresDaConversa([linha({ action_type: 'update_transaction' })], '2026-09-17');
  assert.equal(p.cards[0].verbo, 'alterou');
});

test('texto vazio vira nulo — a tela decide o que dizer, nunca inventa a frase', () => {
  const [p] = paresDaConversa([linha({ origin_text: '   ', input_kind: 'image' })], '2026-09-17');
  assert.equal(p.texto, null);
  assert.equal(p.entrada, 'image');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/activity-feed.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar** — `src/lib/activity-feed.ts`:

```ts
import { horaBR, localISODate, rotuloDoDia } from './dates.ts';

/**
 * As linhas de `public.agent_activity` viradas pares "o que a pessoa disse → o que virou".
 *
 * ⚠️ **O texto é o que o banco devolveu, e só.** Sem frase (foto sem legenda, histórico sem
 * texto), `texto` é nulo e a tela escreve o TIPO da entrada ("foto"), nunca uma frase atribuída
 * à pessoa.
 *
 * ⚠️ **"Apagado depois" só para o que sabemos ler.** O RPC resume oito tabelas; uma regra de
 * categoria ou um orçamento voltam sem registro mesmo existindo. Para esses, o card diz o verbo
 * ("Regra salva") e não afirma sumiço nenhum.
 */
export type RegistroResumido = {
  kind: 'transaction' | 'installment_plan' | 'recurring' | 'reminder' | 'note' | 'account' | 'goal' | 'debt';
  id: string;
  title: string;
  amount_cents?: number;
  tx_kind?: string;
  category?: string | null;
  occurred_at?: string;
  account?: string | null;
  installments?: number;
  next_run_at?: string;
  account_type?: string;
};

export type LinhaDaAtividade = {
  source_message_id: string;
  executed_at: string;
  channel: string;
  input_kind: string;
  origin_text: string | null;
  session_id: string | null;
  action_index: number;
  action_type: string;
  result_id: string | null;
  record: RegistroResumido | null;
};

export type Destino = { pathname: string; params?: Record<string, string> };

export type CardDaFala = {
  chave: string;
  verbo: 'criou' | 'alterou' | 'apagou';
  rotulo: string;
  registro: RegistroResumido | null;
  destino: Destino | null;
};

export type ParDaConversa = {
  chave: string;
  quando: string;
  dia: string;
  hora: string;
  canal: 'whatsapp' | 'app';
  entrada: 'text' | 'audio' | 'image' | 'document' | 'click';
  texto: string | null;
  sessao: string | null;
  cards: CardDaFala[];
};

const APAGA = new Set(['delete_transaction', 'undo_last', 'delete_note', 'delete_reminder', 'resource_delete']);
const ALTERA = new Set([
  'update_transaction', 'append_note', 'update_asset_value', 'resource_update',
  'mark_paid', 'pay_invoice', 'goal_deposit', 'resource_pay', 'resource_roll',
]);

/** Ações cujo registro o RPC SABE ler: sem ele, a linha realmente não existe mais. */
const SUMIU_SE_NULO: Record<string, string> = {
  create_expense: 'Gasto apagado depois',
  create_income: 'Receita apagada depois',
  create_transfer: 'Transferência apagada depois',
  update_transaction: 'Lançamento apagado depois',
  create_installment_purchase: 'Compra parcelada apagada depois',
  create_goal: 'Meta apagada depois',
  create_note: 'Nota apagada depois',
  append_note: 'Nota apagada depois',
  create_reminder: 'Lembrete apagado depois',
};

/** O que dizer quando não há registro para mostrar e não dá para afirmar sumiço. */
const ROTULO_SEM_REGISTRO: Record<string, string> = {
  delete_transaction: 'Lançamento apagado',
  undo_last: 'Lançamento desfeito',
  delete_note: 'Nota apagada',
  delete_reminder: 'Lembrete apagado',
  resource_delete: 'Cadastro apagado',
  resource_create: 'Cadastro criado',
  resource_update: 'Cadastro atualizado',
  resource_pay: 'Pagamento registrado',
  resource_roll: 'Fatura adiada',
  set_rule: 'Regra salva',
  mark_paid: 'Baixa registrada',
  pay_invoice: 'Fatura paga',
  goal_deposit: 'Aporte na meta',
  update_asset_value: 'Patrimônio atualizado',
};

function destinoDe(r: RegistroResumido): Destino {
  switch (r.kind) {
    case 'transaction':
      return { pathname: '/finance/[txId]', params: { txId: r.id } };
    case 'installment_plan':
      return { pathname: '/finance/installments' };
    case 'recurring':
      return { pathname: '/finance/recurring' };
    case 'reminder':
      return { pathname: '/reminder-form', params: { id: r.id } };
    case 'note':
      return { pathname: '/notes/[id]', params: { id: r.id } };
    case 'account':
      return { pathname: '/finance/accounts' };
    case 'goal':
      return { pathname: '/finance/goals' };
    case 'debt':
      return { pathname: '/finance/debts' };
  }
}

function card(l: LinhaDaAtividade): CardDaFala {
  const verbo = APAGA.has(l.action_type) ? 'apagou' : ALTERA.has(l.action_type) ? 'alterou' : 'criou';
  const rotulo = l.record
    ? l.record.title
    : SUMIU_SE_NULO[l.action_type] ?? ROTULO_SEM_REGISTRO[l.action_type] ?? 'Feito';
  return {
    chave: `${l.source_message_id}#${l.action_index}`,
    verbo,
    rotulo,
    registro: l.record,
    destino: l.record ? destinoDe(l.record) : null,
  };
}

const ENTRADAS = new Set(['text', 'audio', 'image', 'document', 'click']);

export function paresDaConversa(linhas: readonly LinhaDaAtividade[], hoje: string = localISODate()): ParDaConversa[] {
  const grupos = new Map<string, LinhaDaAtividade[]>();
  for (const l of linhas) grupos.set(l.source_message_id, [...(grupos.get(l.source_message_id) ?? []), l]);

  return [...grupos.entries()]
    .map(([chave, lista]) => {
      const ordenada = [...lista].sort((a, b) => a.action_index - b.action_index);
      const quando = ordenada.reduce((max, l) => (l.executed_at > max ? l.executed_at : max), ordenada[0].executed_at);
      const primeira = ordenada[0];
      const texto = primeira.origin_text?.trim() || null;
      return {
        chave,
        quando,
        dia: rotuloDoDia(localISODate(new Date(quando)), hoje),
        hora: horaBR(quando),
        canal: primeira.channel === 'whatsapp' ? ('whatsapp' as const) : ('app' as const),
        entrada: (ENTRADAS.has(primeira.input_kind) ? primeira.input_kind : 'text') as ParDaConversa['entrada'],
        texto,
        sessao: primeira.session_id,
        cards: ordenada.map(card),
      };
    })
    .sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime());
}
```

(`localISODate(d)` já aceita uma `Date`.)

- [ ] **Step 4: Hooks** — `src/hooks/use-agent-activity.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import type { LinhaDaAtividade } from '@/lib/activity-feed';
import { supabase } from '@/lib/supabase';

/**
 * O que a pessoa disse e o que virou (`public.agent_activity`).
 *
 * `executed_actions` não entra no Realtime (sem policy, nada seria entregue). O que a conversa
 * escreve cai em lançamentos, lembretes e notas — que já têm tempo real — e é por eles que a
 * leitura se renova.
 */
export function useAgentActivity(limit = 6) {
  useRealtimeInvalidate('transactions', ['agent-activity']);
  useRealtimeInvalidate('reminders', ['agent-activity']);
  useRealtimeInvalidate('notes', ['agent-activity']);
  return useQuery({
    queryKey: ['agent-activity', String(limit)],
    queryFn: async (): Promise<LinhaDaAtividade[]> => {
      const { data, error } = await supabase.rpc('agent_activity', { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as unknown as LinhaDaAtividade[];
    },
  });
}
```

Em `src/hooks/use-finance.ts`, logo depois de `useSpendable`:

```ts
/** Um evento que forma o "livre" da Hoje (`public.spendable_path`) — a Pista. */
export type SpendablePathRow = Fns['spendable_path']['Returns'][number];

/**
 * A MESMA lista que produz `comprometido_ate_entrada`. Chaveada junto do `spendable` para as
 * duas envelhecerem juntas; `montarPista` ainda confere a soma e não desenha se não bater.
 */
export function useSpendablePath(view?: CycleView) {
  useRealtimeMonth('spendable-path');
  useRealtimeInvalidate('card_invoices', ['spendable-path']);
  return useQuery({
    queryKey: ['spendable-path', view ?? ''],
    queryFn: async (): Promise<SpendablePathRow[]> => {
      const { data, error } = await supabase.rpc('spendable_path', { p_view: view ?? undefined });
      if (error) throw error;
      return (data ?? []) as SpendablePathRow[];
    },
  });
}
```

(`useRealtimeMonth` é o mesmo helper usado por `useSpendable`; conferir a assinatura no arquivo.)

- [ ] **Step 5: Rodar**

Run: `node --test src/lib/activity-feed.test.ts && npx tsc --noEmit && npx expo lint`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add src/lib/activity-feed.ts src/lib/activity-feed.test.ts src/hooks/use-agent-activity.ts src/hooks/use-finance.ts
git commit -m "feat(hoje): feed da conversa e a leitura da pista"
```

---

### Task 16: Balão, card do registro e o encaixe

**Files:**
- Modify: `src/lib/activity-feed.ts`, `src/lib/activity-feed.test.ts` (acrescenta `metaDoRegistro`)
- Create: `src/components/feed/message-bubble.tsx`, `src/components/feed/record-card.tsx`, `src/components/feed/conversation-feed.tsx`

**Interfaces:**
- Consumes: `ParDaConversa`, `CardDaFala`, `Destino`, `RegistroResumido` (Task 15); `categoryIcon`; tokens `bubble`, `onBubble`, `rail`.
- Produces:
  - `metaDoRegistro(r: RegistroResumido): string`
  - `MessageBubble({ texto: string | null; entrada: ParDaConversa['entrada']; canal: 'whatsapp' | 'app'; hora: string; onPress?: () => void })`
  - `RecordCard({ card: CardDaFala; onPress?: () => void })`
  - `ConversationFeed({ pares: readonly ParDaConversa[]; onOpenRecord: (d: Destino) => void; onOpenConversation: (sessao: string) => void })`

- [ ] **Step 1: Teste que falha** — acrescentar a `src/lib/activity-feed.test.ts` (e `metaDoRegistro` no import):

```ts
test('a linha pequena do registro diz o que ele é, sem inventar', () => {
  assert.equal(metaDoRegistro({ kind: 'transaction', id: 't', title: 'Mercado', category: 'mercado', account: 'Nubank' }), 'mercado · Nubank');
  assert.equal(metaDoRegistro({ kind: 'transaction', id: 't', title: 'Mercado', category: null, account: null }), 'lançamento');
  assert.equal(metaDoRegistro({ kind: 'installment_plan', id: 'p', title: 'TV', installments: 10, category: 'eletrônicos' }), '10× · eletrônicos');
  assert.equal(metaDoRegistro({ kind: 'account', id: 'a', title: 'Nubank', account_type: 'credit_card' }), 'cartão');
  assert.equal(metaDoRegistro({ kind: 'note', id: 'n', title: 'Wifi' }), 'nota');
  assert.match(metaDoRegistro({ kind: 'reminder', id: 'r', title: 'Aluguel', next_run_at: '2026-10-05T12:00:00Z' }), /^seg, 5 out · \d{2}:\d{2}$/);
});
```

(05/10/2026 é segunda-feira.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/activity-feed.test.ts`
Expected: FAIL — `metaDoRegistro` não existe.

- [ ] **Step 3: Implementar `metaDoRegistro`** — acrescentar a `src/lib/activity-feed.ts` (e `diaCurtoBR` ao import de `./dates.ts`):

```ts
/** A linha pequena embaixo do título do registro. */
export function metaDoRegistro(r: RegistroResumido): string {
  switch (r.kind) {
    case 'transaction':
      return [r.category, r.account].filter(Boolean).join(' · ') || 'lançamento';
    case 'installment_plan':
      return [r.installments ? `${r.installments}×` : null, r.category].filter(Boolean).join(' · ') || 'compra parcelada';
    case 'recurring':
      return ['todo mês', r.category].filter(Boolean).join(' · ');
    case 'reminder':
      return r.next_run_at
        ? `${diaCurtoBR(localISODate(new Date(r.next_run_at)))} · ${horaBR(r.next_run_at)}`
        : 'lembrete';
    case 'note':
      return 'nota';
    case 'account':
      return r.account_type === 'credit_card' ? 'cartão' : 'conta';
    case 'goal':
      return 'meta';
    case 'debt':
      return 'falta pagar';
  }
}
```

- [ ] **Step 4: `src/components/feed/message-bubble.tsx`**

```tsx
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Fonts } from '@/constants/theme';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { ParDaConversa } from '@/lib/activity-feed';

/** Sem frase, o balão diz o TIPO do que chegou — nunca uma frase atribuída à pessoa. */
const SEM_TEXTO: Record<ParDaConversa['entrada'], string> = {
  text: 'mensagem',
  audio: 'áudio',
  image: 'foto',
  document: 'documento',
  click: 'toque num botão',
};

/** Acima disto o balão mostra a prévia e um "mais" que abre no lugar (prévia de corpo, §7). */
const LIMITE = 180;
const PREVIA = 160;

/**
 * A fala da pessoa: balão de tinta à direita, o texto REAL que ela mandou, e o carimbo do canal.
 */
export function MessageBubble({
  texto,
  entrada,
  canal,
  hora,
  onPress,
}: {
  texto: string | null;
  entrada: ParDaConversa['entrada'];
  canal: 'whatsapp' | 'app';
  hora: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const [aberto, setAberto] = useState(false);
  const longo = (texto?.length ?? 0) > LIMITE || (texto?.split('\n').length ?? 0) > 4;
  const mostrado =
    texto == null ? SEM_TEXTO[entrada] : !longo || aberto ? texto : `${texto.slice(0, PREVIA).trimEnd()}…`;
  const canalTexto = canal === 'whatsapp' ? 'WhatsApp' : 'App';

  return (
    <View style={styles.coluna}>
      <Pressable
        disabled={!onPress && !(longo && !aberto)}
        accessibilityRole={onPress || (longo && !aberto) ? 'button' : 'text'}
        accessibilityLabel={`Você, ${canalTexto}, ${hora}: ${texto ?? SEM_TEXTO[entrada]}`}
        accessibilityHint={longo && !aberto ? 'Mostra a mensagem inteira' : onPress ? 'Abre a conversa' : undefined}
        onPress={() => (longo && !aberto ? setAberto(true) : onPress?.())}
        style={({ pressed }) => [styles.balao, { backgroundColor: theme.bubble, opacity: pressed ? 0.85 : 1 }]}>
        {entrada === 'audio' ? (
          <View style={styles.audio}>
            <Icon name="waveform" size="xs" color="onBubble" />
            <ThemedText type="caption" themeColor="onBubble">
              áudio
            </ThemedText>
          </View>
        ) : null}
        <ThemedText type="default" themeColor="onBubble" style={[styles.texto, texto == null && styles.italico]}>
          {mostrado}
        </ThemedText>
        {longo && !aberto ? (
          <ThemedText type="caption" themeColor="onBubble" style={styles.mais}>
            mais
          </ThemedText>
        ) : null}
      </Pressable>
      <View style={styles.carimbo}>
        <Icon name={canal === 'whatsapp' ? 'bubble.left' : 'iphone'} size="xs" color="textSecondary" />
        <ThemedText type="caption" themeColor="textSecondary">
          {`${canalTexto} · ${hora}`}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  coluna: { alignItems: 'flex-end', gap: Space.xs },
  balao: {
    maxWidth: '86%',
    gap: Space.xs,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderBottomRightRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  // Dentro de container com `entering`: sem encolher, quebrando na largura do balão (§3).
  texto: { flexShrink: 0, maxWidth: '100%' },
  italico: { fontFamily: Fonts.italic },
  mais: { textDecorationLine: 'underline' },
  audio: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  carimbo: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingRight: Space.xs },
});
```

- [ ] **Step 5: `src/components/feed/record-card.tsx`**

```tsx
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { categoryIcon } from '@/design/category-icons';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { metaDoRegistro, type CardDaFala } from '@/lib/activity-feed';

function iconeDo(card: CardDaFala): IconName {
  const r = card.registro;
  if (!r) return card.verbo === 'apagou' ? 'trash' : 'checkmark.circle';
  switch (r.kind) {
    case 'transaction':
    case 'recurring':
      return categoryIcon(r.category, r.tx_kind);
    case 'installment_plan':
      return 'creditcard';
    case 'reminder':
      return 'bell';
    case 'note':
      return 'note.text';
    case 'account':
      return r.account_type === 'credit_card' ? 'creditcard' : 'wallet.pass';
    case 'goal':
      return 'target';
    case 'debt':
      return 'banknote';
  }
}

/**
 * O registro que a fala virou, como ele está AGORA (o RPC lê a linha atual). Alterado ganha a
 * pílula; o que não existe mais aparece esmaecido e não abre nada.
 */
export function RecordCard({ card, onPress }: { card: CardDaFala; onPress?: () => void }) {
  const theme = useTheme();
  const r = card.registro;
  const comSinal = r?.kind === 'transaction' || r?.kind === 'recurring';
  const valor =
    r?.amount_cents == null ? null : comSinal && r.tx_kind === 'expense' ? -r.amount_cents : r.amount_cents;

  const corpo = (
    <View
      style={[
        styles.card,
        { backgroundColor: r ? theme.surface : theme.backgroundElement, borderColor: theme.cardBorder },
      ]}>
      <View style={[styles.selo, { backgroundColor: r ? theme.backgroundElement : theme.surface }]}>
        <Icon name={iconeDo(card)} size="sm" color={r ? 'text' : 'textSecondary'} />
      </View>
      <View style={styles.textos}>
        <ThemedText type="headline" themeColor={r ? 'text' : 'textSecondary'} style={styles.semEncolher}>
          {card.rotulo}
        </ThemedText>
        {r ? (
          <View style={styles.meta}>
            <ThemedText type="caption" themeColor="textSecondary">
              {metaDoRegistro(r)}
            </ThemedText>
            {card.verbo === 'alterou' ? (
              <View style={[styles.pilula, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="caption" themeColor="textSecondary">
                  alterado
                </ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {valor != null ? (
        <Money
          cents={valor}
          variant="ticker"
          tone={comSinal && valor > 0 ? 'success' : 'text'}
          signed={comSinal}
        />
      ) : null}
    </View>
  );

  if (!onPress) return corpo;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`Abrir ${card.rotulo}`} onPress={onPress}>
      {corpo}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  selo: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: Space.half },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.xs },
  pilula: { paddingHorizontal: Space.sm, paddingVertical: 1, borderRadius: Radius.pill },
});
```

- [ ] **Step 6: `src/components/feed/conversation-feed.tsx`**

```tsx
import * as Haptics from 'expo-haptics';
import { Fragment, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, useReducedMotion } from 'react-native-reanimated';

import { MessageBubble } from '@/components/feed/message-bubble';
import { RecordCard } from '@/components/feed/record-card';
import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { Destino, ParDaConversa } from '@/lib/activity-feed';

/**
 * A Conversa: cada fala da pessoa com o que ela virou encaixado embaixo.
 *
 * ⚠️ **O encaixe só toca para fala que CHEGOU depois da montagem.** As chaves da primeira pintura
 * ficam guardadas; abrir a aba não pode fazer todos os pares pularem (a lição do alfinete de Notas,
 * design.md §5). Um par novo monta com a chave nova — e só ele anima.
 */
export function ConversationFeed({
  pares,
  onOpenRecord,
  onOpenConversation,
}: {
  pares: readonly ParDaConversa[];
  onOpenRecord: (d: Destino) => void;
  onOpenConversation: (sessao: string) => void;
}) {
  const [daAbertura] = useState(() => new Set(pares.map((p) => p.chave)));
  return (
    <View style={styles.lista}>
      {pares.map((p, i) => (
        <Fragment key={p.chave}>
          {p.dia !== 'hoje' && p.dia !== pares[i - 1]?.dia ? (
            <ThemedText type="caption" themeColor="textSecondary" style={styles.dia}>
              {p.dia}
            </ThemedText>
          ) : null}
          <Par
            par={p}
            novo={!daAbertura.has(p.chave)}
            onOpenRecord={onOpenRecord}
            onOpenConversation={onOpenConversation}
          />
        </Fragment>
      ))}
    </View>
  );
}

function Par({
  par,
  novo,
  onOpenRecord,
  onOpenConversation,
}: {
  par: ParDaConversa;
  novo: boolean;
  onOpenRecord: (d: Destino) => void;
  onOpenConversation: (sessao: string) => void;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const anima = novo && !reduzido;

  // Um háptico por chegada, no quadro em que ela aparece (§6).
  useEffect(() => {
    if (novo) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [novo]);

  const sessao = par.sessao;
  return (
    <View style={styles.par}>
      <Animated.View entering={anima ? FadeInDown.duration(Motion.duration.slow).easing(Motion.easing.out) : undefined}>
        <MessageBubble
          texto={par.texto}
          entrada={par.entrada}
          canal={par.canal}
          hora={par.hora}
          onPress={sessao ? () => onOpenConversation(sessao) : undefined}
        />
      </Animated.View>
      <Animated.View
        entering={anima ? FadeIn.delay(160).duration(Motion.duration.fast) : undefined}
        style={[styles.fio, { backgroundColor: theme.rail }]}
      />
      <View style={styles.cards}>
        {par.cards.map((c, i) => {
          const destino = c.destino;
          return (
            <Animated.View
              key={c.chave}
              entering={
                anima
                  ? FadeInUp.delay(220 + Math.min(i * Motion.stagger.step, Motion.stagger.cap))
                      .duration(Motion.duration.slow)
                      .easing(Motion.easing.out)
                  : undefined
              }>
              <RecordCard card={c} onPress={destino ? () => onOpenRecord(destino) : undefined} />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lista: { gap: Space.xl },
  dia: { alignSelf: 'center' },
  par: { gap: 0 },
  // O fio sai de baixo do balão, do lado da cauda, e encosta no card.
  fio: { alignSelf: 'flex-end', width: 2, height: Space.md, marginRight: Space.xl, borderRadius: Radius.pill },
  cards: { gap: Space.sm },
});
```

- [ ] **Step 7: Rodar**

Run: `node --test src/lib/activity-feed.test.ts && npx tsc --noEmit && npx expo lint && npm test`
Expected: verde (`waveform`, `iphone`, `note.text`, `bell`, `target`, `trash`, `wallet.pass` já estão no mapa de ícones).

- [ ] **Step 8: Commit**

```bash
git add src/lib/activity-feed.ts src/lib/activity-feed.test.ts src/components/feed/message-bubble.tsx src/components/feed/record-card.tsx src/components/feed/conversation-feed.tsx
git commit -m "feat(hoje): balão com o texto real, o registro que ele virou e o encaixe"
```

---

### Task 17: A Conversa e a Pista completa na Hoje

**Files:**
- Modify: `src/app/(tabs)/today/index.tsx`
- Modify: `src/lib/simple-finance-ui.test.ts`
- Modify: `CLAUDE.md` (estado das migrations)

**Interfaces:**
- Consumes: `useAgentActivity`, `useSpendablePath` (Task 15); `paresDaConversa` (Task 15); `ConversationFeed` (Task 16).

- [ ] **Step 1: Testes que falham** — acrescentar ao fim de `src/lib/simple-finance-ui.test.ts`:

```ts
const falaDoApp = {
  source_message_id: 'app:1',
  executed_at: '2026-09-08T12:00:00-03:00',
  channel: 'app',
  input_kind: 'text',
  origin_text: 'gastei 45 no mercado',
  session_id: 'sessao-1',
  action_index: 0,
  action_type: 'create_expense',
  result_id: 'tx-1',
  record: { kind: 'transaction', id: 'tx-1', title: 'Mercado', amount_cents: 4500, tx_kind: 'expense' },
};

test('Hoje: a Conversa mostra o texto real e abre o registro que ele virou', () => {
  const ui = screen(hojeFile, { activity: [falaDoApp] });
  const feed = ui.nodes().find((n: any) => n.type === 'ConversationFeed');
  assert.ok(feed, 'a conversa precisa aparecer');
  assert.equal(feed.props.pares[0].texto, 'gastei 45 no mercado');
  feed.props.onOpenRecord(feed.props.pares[0].cards[0].destino);
  assert.deepEqual(ui.navigations.at(-1), { pathname: '/finance/[txId]', params: { txId: 'tx-1' } });
  feed.props.onOpenConversation('sessao-1');
  assert.deepEqual(ui.navigations.at(-1), { pathname: '/agent/[id]', params: { id: 'sessao-1' } });
});

test('Hoje: falha na Conversa diz que falhou e refaz só ela', () => {
  const ui = screen(hojeFile, { activityError: true });
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro);
  erro.props.onRetry();
  assert.deepEqual(ui.refetches, ['activity']);
});

test('Hoje: sem fala nenhuma a Conversa não desenha bloco vazio', () => {
  const ui = screen(hojeFile, {});
  assert.ok(!tipos(ui).includes('ConversationFeed'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/simple-finance-ui.test.ts`
Expected: os três novos falham.

- [ ] **Step 3: Ligar na tela** — em `src/app/(tabs)/today/index.tsx`:

1. Imports:
```tsx
import { router, type Href } from 'expo-router';
import { ConversationFeed } from '@/components/feed/conversation-feed';
import { useAgentActivity } from '@/hooks/use-agent-activity';
import { paresDaConversa } from '@/lib/activity-feed';
```
e `useSpendablePath` no import de `@/hooks/use-finance`.
2. Depois de `const markPaid = useMarkPaid();`:
```tsx
  const atividade = useAgentActivity(6);
  const caminho = useSpendablePath();
  const pares = useMemo(() => paresDaConversa(atividade.data ?? [], hoje), [atividade.data, hoje]);
```
3. Trocar o `useMemo` da pista por:
```tsx
  const pista = useMemo(
    () => montarPista(caixa, comprometido, caminho.data ?? [], hoje, ateQuando ?? hoje),
    [caixa, comprometido, caminho.data, hoje, ateQuando]
  );
```
e apagar o comentário `// CONVERSA: na Fase 2…` acima dele.
4. `useTelaPronta(…)`: acrescentar `atividade, caminho` antes de `...setup.consultas`.
5. `onRefresh`: acrescentar `atividade.refetch(), caminho.refetch()` ao `Promise.all`.
6. Trocar `{/* CONVERSA — entra aqui na Fase 2 (Task 17). */}` por:
```tsx
      {atividade.isError ? (
        <Bloco>
          <BlockHeader title="Conversa" />
          <ErrorCard onRetry={() => atividade.refetch()} />
        </Bloco>
      ) : pares.length > 0 ? (
        <Bloco>
          <BlockHeader title="Conversa" action={{ label: 'Agente', onPress: () => router.push('/agent') }} />
          <ConversationFeed
            pares={pares}
            onOpenRecord={(d) => router.push(d as Href)}
            onOpenConversation={(id) => router.push({ pathname: '/agent/[id]', params: { id } })}
          />
        </Bloco>
      ) : null}
```

- [ ] **Step 4: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: verde.

- [ ] **Step 5: CLAUDE.md** — no parágrafo "⚠️ **O staging está UMA à frente: `20260917120000`**…", trocar o início para "⚠️ **O staging está DUAS à frente: `20260917120000` e `20260918120000`**" e acrescentar, ao fim do parágrafo:

```md
  A `20260918120000` (18/09/2026) dá dono e frase de origem a `executed_actions`, abre
  `public.agent_activity` (a Conversa da Hoje, `security definer`, só as falas do próprio
  chamador, sem `payload`) e `public.spendable_path` (a Pista, a mesma lista que forma o
  "livre"). Produção sem ela: a Hoje mostra a Conversa com erro e a Pista sem entalhes — o
  resto funciona. ⚠️ **Ela sobe ANTES do deploy do agente que grava as colunas novas**: o agente
  novo contra um banco sem `user_id`/`workspace_id`/`origin_text` em `executed_actions` quebra
  TODA escrita (a reserva de execução falha antes de qualquer ação).
```

- [ ] **Step 6: Verificar nos dois aparelhos** (mesmo roteiro da Task 12), mais:
  - com o agente do staging no ar, mandar "gastei 12 no café" pela aba Agente com `dev@`, voltar para a Hoje: o par aparece, e com a Hoje ABERTA durante a chegada ele encaixa animado (abrir a Hoje de novo NÃO anima os pares);
  - tocar no card abre o lançamento; tocar no balão do app abre a conversa;
  - a Pista mostra os entalhes; arrastar dá háptico em cada um e escreve "DD/MM · livre R$ X"; o último "livre" é o número grande;
  - fonte 1,3 no Android: balão quebra, card não corta, "mais" aparece em texto longo.
  - Apagar o lançamento de teste depois (pelo app, no detalhe) para o staging voltar como estava; o card vira "Gasto apagado depois".
- [ ] **Step 7: Commit**

```bash
git add "src/app/(tabs)/today/index.tsx" src/lib/simple-finance-ui.test.ts CLAUDE.md
git commit -m "feat(hoje): a conversa real e a pista com entalhes na tela inicial"
```

---

# Fase 3 — O Financeiro

### Task 18: Escala da série compartilhada e o gráfico arrastável

**Files:**
- Create: `src/design/sparkline-geometry.ts`, `src/design/sparkline-geometry.test.ts`
- Modify: `src/components/ui/sparkline.tsx` (usa a escala)
- Create: `src/components/ui/scrub-chart.tsx`

**Interfaces:**
- Produces:
  - `PAD = 6`; `escalaDaSerie(values: readonly number[], width: number, height: number): { lo: number; hi: number; x(i: number): number; y(v: number): number } | null`
  - `indiceNoX(x: number, n: number, width: number): number` (worklet); `posicaoDoRotulo(px: number, largura: number, larguraRotulo: number): number` (worklet)
  - `ScrubChart({ values: number[]; labels: string[]; width: number; height?: number; legenda: ReactNode; formatValue: (v: number) => string })` — desenhado DENTRO do herói.

- [ ] **Step 1: Teste que falha** — `src/design/sparkline-geometry.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escalaDaSerie, indiceNoX, posicaoDoRotulo } from './sparkline-geometry.ts';

test('a escala põe as pontas no respiro e o maior valor mais alto', () => {
  const e = escalaDaSerie([0, 100], 112, 56)!;
  assert.equal(e.x(0), 6);
  assert.equal(e.x(1), 106);
  assert.ok(e.y(100) < e.y(0));
});

test('série plana não divide por zero', () => {
  const e = escalaDaSerie([500, 500], 100, 50)!;
  assert.ok(Number.isFinite(e.y(500)));
});

test('menos de dois pontos ou largura zero não têm escala', () => {
  assert.equal(escalaDaSerie([1], 100, 50), null);
  assert.equal(escalaDaSerie([1, 2], 0, 50), null);
});

test('o índice do dedo prende nas pontas', () => {
  assert.equal(indiceNoX(-50, 5, 112), 0);
  assert.equal(indiceNoX(500, 5, 112), 4);
  assert.equal(indiceNoX(56, 5, 112), 2);
});

test('o rótulo fica dentro da largura', () => {
  assert.equal(posicaoDoRotulo(5, 300, 100), 0);
  assert.equal(posicaoDoRotulo(290, 300, 100), 200);
  assert.equal(posicaoDoRotulo(150, 300, 100), 100);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/design/sparkline-geometry.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar** — `src/design/sparkline-geometry.ts`:

```ts
/**
 * A escala de uma série de dinheiro — uma só para o desenho (`Sparkline`) e para o dedo
 * (`ScrubChart`). Duas cópias poriam o ponto do arraste fora da curva.
 *
 * O domínio vertical sai dos DADOS, não de zero (uma série de 2.500–2.800 esmagada em 6px lia
 * como divisor), com um span mínimo para ruído de centavos não virar onda.
 */
export const PAD = 6;
const MIN_SPAN_RATIO = 0.05;

export type EscalaDaSerie = {
  lo: number;
  hi: number;
  x: (i: number) => number;
  y: (v: number) => number;
};

export function escalaDaSerie(values: readonly number[], width: number, height: number): EscalaDaSerie | null {
  if (values.length < 2 || width <= 0) return null;
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = Math.max(dataMax - dataMin, Math.abs(dataMax) * MIN_SPAN_RATIO, 1);
  const mid = (dataMin + dataMax) / 2;
  const lo = mid - span / 2;
  const hi = mid + span / 2;
  const plot = height - PAD * 2;
  const passo = (width - PAD * 2) / (values.length - 1);
  return {
    lo,
    hi,
    x: (i) => PAD + i * passo,
    y: (v) => PAD + ((hi - v) / (hi - lo)) * plot,
  };
}

/** O ponto da série mais perto do dedo. */
export function indiceNoX(x: number, n: number, width: number): number {
  'worklet';
  if (n < 2) return 0;
  const passo = (width - PAD * 2) / (n - 1);
  return Math.min(n - 1, Math.max(0, Math.round((x - PAD) / passo)));
}

/** Onde o rótulo começa: centrado no ponto, preso às bordas. */
export function posicaoDoRotulo(px: number, largura: number, larguraRotulo: number): number {
  'worklet';
  return Math.min(Math.max(px - larguraRotulo / 2, 0), Math.max(0, largura - larguraRotulo));
}
```

Em `src/components/ui/sparkline.tsx`: importar `import { escalaDaSerie, PAD } from '@/design/sparkline-geometry';`, apagar as constantes locais `PAD` e `MIN_SPAN_RATIO`, e no `useMemo` de `geo` trocar o bloco de `dataMin` … `const pts = …` por:

```ts
    const escala = escalaDaSerie(values, width, height);
    if (!escala) return null;
    const { lo, hi, y } = escala;
    const pts = values.map((v, i) => ({ x: escala.x(i), y: y(v) }));
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
```

(o `if (values.length < 2 || width <= 0) return null;` do começo pode sair — a escala já responde isso; o resto do `useMemo` usa `lo`, `hi`, `y`, `dataMin`, `dataMax` e `pts` como antes).

- [ ] **Step 4: `src/components/ui/scrub-chart.tsx`**

```tsx
import * as Haptics from 'expo-haptics';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Sparkline } from '@/components/ui/sparkline';
import { escalaDaSerie, indiceNoX } from '@/design/sparkline-geometry';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const PONTO = 10;

/**
 * A curva do herói que se lê com o dedo: arrastar mostra o dia e o saldo daquele dia, com um
 * toque háptico a cada dia; soltar volta à legenda. Desenhada DENTRO do herói (`onHero*`).
 *
 * O desenho continua sendo o `Sparkline`; aqui mora só o cursor, na MESMA escala
 * (`escalaDaSerie`).
 */
export function ScrubChart({
  values,
  labels,
  width,
  height = 64,
  legenda,
  formatValue,
}: {
  values: number[];
  labels: string[];
  width: number;
  height?: number;
  legenda: ReactNode;
  formatValue: (v: number) => string;
}) {
  const theme = useTheme();
  const pontos = useMemo(() => {
    const escala = escalaDaSerie(values, width, height);
    return escala ? values.map((v, i) => ({ x: escala.x(i), y: escala.y(v) })) : [];
  }, [values, width, height]);
  const [ativo, setAtivo] = useState(-1);
  const indice = useSharedValue(-1);

  const estiloLinha = useAnimatedStyle(() => {
    const p = indice.get() >= 0 ? pontos[indice.get()] : undefined;
    return { opacity: p ? 1 : 0, transform: [{ translateX: p ? p.x - 1 : 0 }] };
  });
  const estiloPonto = useAnimatedStyle(() => {
    const p = indice.get() >= 0 ? pontos[indice.get()] : undefined;
    return {
      opacity: p ? 1 : 0,
      transform: [{ translateX: p ? p.x - PONTO / 2 : 0 }, { translateY: p ? p.y - PONTO / 2 : 0 }],
    };
  });

  const gesto = useMemo(
    () =>
      Gesture.Pan()
        .enabled(pontos.length > 1)
        .activeOffsetX([-6, 6])
        .failOffsetY([-10, 10])
        .onUpdate((e) => {
          const i = indiceNoX(e.x, pontos.length, width);
          if (i !== indice.get()) {
            indice.set(i);
            runOnJS(setAtivo)(i);
            runOnJS(Haptics.selectionAsync)();
          }
        })
        .onFinalize(() => {
          indice.set(-1);
          runOnJS(setAtivo)(-1);
        }),
    [pontos, width, indice]
  );

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Saldo projetado por dia"
      accessibilityValue={{ text: ativo >= 0 ? `${labels[ativo]}, ${formatValue(values[ativo])}` : undefined }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        setAtivo((i) =>
          e.nativeEvent.actionName === 'increment'
            ? Math.min(values.length - 1, i + 1)
            : Math.max(0, (i < 0 ? values.length : i) - 1)
        )
      }
      style={styles.coluna}>
      <View style={styles.legenda}>
        {ativo >= 0 ? (
          <ThemedText type="code" themeColor={values[ativo] < 0 ? 'onHeroDanger' : 'onHero'}>
            {`${labels[ativo]} · ${formatValue(values[ativo])}`}
          </ThemedText>
        ) : (
          legenda
        )}
      </View>
      <GestureDetector gesture={gesto}>
        <View style={{ width, height }}>
          <Sparkline values={values} width={width} height={height} onHero showZero />
          <Animated.View
            pointerEvents="none"
            style={[styles.linha, { height, backgroundColor: theme.heroSeparator }, estiloLinha]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.ponto, { backgroundColor: theme.onHero, borderColor: theme.heroSurface }, estiloPonto]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  coluna: { gap: Space.xs },
  legenda: {
    minHeight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  linha: { position: 'absolute', left: 0, top: 0, width: 2, borderRadius: Radius.pill },
  ponto: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PONTO,
    height: PONTO,
    borderRadius: Radius.pill,
    borderWidth: 2,
  },
});
```

`posicaoDoRotulo` fica exportado para quem quiser o rótulo flutuante; aqui o rótulo mora na linha da legenda (mais estável com fonte grande).

- [ ] **Step 5: Rodar**

Run: `node --test src/design/sparkline-geometry.test.ts && npx tsc --noEmit && npx expo lint && npm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add src/design/sparkline-geometry.ts src/design/sparkline-geometry.test.ts src/components/ui/sparkline.tsx src/components/ui/scrub-chart.tsx
git commit -m "feat(ui): escala única da curva e gráfico que se lê com o dedo"
```

---

### Task 19: A rosca

**Files:**
- Create: `src/design/donut-math.ts`, `src/design/donut-math.test.ts`
- Create: `src/components/ui/donut-chart.tsx`

**Interfaces:**
- Produces:
  - `CHAVE_OUTRAS = '__outras__'`
  - `type Fatia = { chave: string; valor: number; inicio: number; fim: number; tom: number }` (ângulos em fração de volta, 0 no topo, sentido horário; `tom` 0..5)
  - `fatias(itens: readonly { chave: string; valor: number }[], max?: number, respiro?: number): Fatia[]`
  - `fatiaNoPonto(x, y, centro, raioInterno, raioExterno, lista: readonly Fatia[]): number` (worklet)
  - `DonutChart({ fatias: readonly Fatia[]; size?; espessura?; selecionada: number; onSelect: (i: number) => void; children? })`

- [ ] **Step 1: Teste que falha** — `src/design/donut-math.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAVE_OUTRAS, fatiaNoPonto, fatias } from './donut-math.ts';

test('as fatias seguem a ordem do maior e cobrem a volta com respiro', () => {
  const f = fatias([{ chave: 'b', valor: 30 }, { chave: 'a', valor: 50 }, { chave: 'c', valor: 20 }]);
  assert.deepEqual(f.map((x) => x.chave), ['a', 'b', 'c']);
  assert.ok(Math.abs(f[0].inicio - 0.003) < 1e-9);
  assert.ok(Math.abs(f[0].fim - 0.497) < 1e-9);
  assert.ok(f[2].fim <= 1);
  assert.deepEqual(f.map((x) => x.tom), [0, 1, 2]);
});

test('acima de seis, o resto vira "outras" no último tom', () => {
  const f = fatias(Array.from({ length: 8 }, (_, i) => ({ chave: `c${i}`, valor: 10 })));
  assert.equal(f.length, 7);
  assert.equal(f[6].chave, CHAVE_OUTRAS);
  assert.equal(f[6].valor, 20);
  assert.equal(f[6].tom, 5);
});

test('uma fatia só fecha a volta', () => {
  const [f] = fatias([{ chave: 'a', valor: 10 }]);
  assert.equal(f.inicio, 0);
  assert.equal(f.fim, 1);
});

test('zero e negativo não entram', () => {
  assert.deepEqual(fatias([{ chave: 'a', valor: 0 }, { chave: 'b', valor: -5 }]), []);
});

test('o toque acha a fatia pelo ângulo e ignora o furo', () => {
  const lista = fatias([{ chave: 'a', valor: 50 }, { chave: 'b', valor: 50 }]);
  assert.equal(fatiaNoPonto(60, 12, 50, 30, 50, lista), 0);
  assert.equal(fatiaNoPonto(40, 88, 50, 30, 50, lista), 1);
  assert.equal(fatiaNoPonto(50, 50, 50, 30, 50, lista), -1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/design/donut-math.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** — `src/design/donut-math.ts`:

```ts
/**
 * A rosca de "Para onde foi": até seis fatias com nome e o resto junto.
 *
 * `CHAVE_OUTRAS` é sentinela, não palavra — uma categoria de verdade pode se chamar "outras".
 * Ângulos em fração de volta, 0 no topo, sentido horário; o respiro entre fatias nunca passa de
 * um terço da própria fatia (uma fatia fina não pode sumir no respiro).
 */
export const CHAVE_OUTRAS = '__outras__';

export type Fatia = { chave: string; valor: number; inicio: number; fim: number; tom: number };

export function fatias(itens: readonly { chave: string; valor: number }[], max = 6, respiro = 0.006): Fatia[] {
  const positivos = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const cabeca = positivos.slice(0, max);
  const resto = positivos.slice(max).reduce((s, i) => s + i.valor, 0);
  const lista = resto > 0 ? [...cabeca, { chave: CHAVE_OUTRAS, valor: resto }] : cabeca;
  const total = lista.reduce((s, i) => s + i.valor, 0);
  if (total <= 0) return [];

  let acumulado = 0;
  return lista.map((item, indice) => {
    const fracao = item.valor / total;
    const gap = lista.length > 1 ? Math.min(respiro, fracao / 3) : 0;
    const fatia = {
      chave: item.chave,
      valor: item.valor,
      inicio: acumulado + gap / 2,
      fim: acumulado + fracao - gap / 2,
      tom: Math.min(indice, 5),
    };
    acumulado += fracao;
    return fatia;
  });
}

/** A fatia sob o toque, ou -1 (fora do anel, no furo ou no respiro). */
export function fatiaNoPonto(
  x: number,
  y: number,
  centro: number,
  raioInterno: number,
  raioExterno: number,
  lista: readonly Fatia[]
): number {
  'worklet';
  const dx = x - centro;
  const dy = y - centro;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < raioInterno || d > raioExterno) return -1;
  let a = Math.atan2(dx, -dy) / (2 * Math.PI);
  if (a < 0) a += 1;
  for (let i = 0; i < lista.length; i++) {
    if (a >= lista[i].inicio && a <= lista[i].fim) return i;
  }
  return -1;
}
```

- [ ] **Step 4: `src/components/ui/donut-chart.tsx`**

```tsx
import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Group, Path, Skia, rect, type SkPath } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import type { ThemeColor } from '@/constants/theme';
import { fatiaNoPonto, type Fatia } from '@/design/donut-math';
import { Motion } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export const TONS_DA_ROSCA: readonly ThemeColor[] = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6'];

/**
 * A rosca tonal: parte-do-todo em escala de tinta (a cor semântica fica livre para dizer
 * estado). Nasce desenhada inteira — sem varredura de entrada, a lição da barra que ficou vazia
 * no Android. Tocar numa fatia seleciona (as outras recuam); tocar no furo limpa.
 */
export function DonutChart({
  fatias,
  size = 168,
  espessura = 22,
  selecionada,
  onSelect,
  children,
}: {
  fatias: readonly Fatia[];
  size?: number;
  espessura?: number;
  selecionada: number;
  onSelect: (i: number) => void;
  children?: ReactNode;
}) {
  const oval = useMemo(() => rect(espessura / 2 + 3, espessura / 2 + 3, size - espessura - 6, size - espessura - 6), [size, espessura]);
  const arcos = useMemo(
    () =>
      fatias.map((f) => {
        const b = Skia.PathBuilder.Make();
        b.addArc(oval, -90 + f.inicio * 360, Math.max(0.5, (f.fim - f.inicio) * 360));
        return b.detach();
      }),
    [fatias, oval]
  );

  const raio = (size - 6) / 2 - espessura / 2;
  const toque = useMemo(
    () =>
      Gesture.Tap().onEnd((e) => {
        const i = fatiaNoPonto(e.x, e.y, size / 2, raio - espessura / 2 - 6, raio + espessura / 2 + 6, fatias);
        runOnJS(onSelect)(i);
      }),
    [fatias, size, raio, espessura, onSelect]
  );

  return (
    <GestureDetector gesture={toque}>
      <View style={{ width: size, height: size }}>
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          {arcos.map((arco, i) => (
            <ArcoDaFatia
              key={fatias[i].chave}
              arco={arco}
              tom={TONS_DA_ROSCA[fatias[i].tom]}
              espessura={espessura}
              estado={selecionada < 0 ? 'neutro' : selecionada === i ? 'ativo' : 'recuado'}
            />
          ))}
        </SkiaCanvas>
        <View pointerEvents="none" style={styles.centro}>
          {children}
        </View>
      </View>
    </GestureDetector>
  );
}

function ArcoDaFatia({
  arco,
  tom,
  espessura,
  estado,
}: {
  arco: SkPath;
  tom: ThemeColor;
  espessura: number;
  estado: 'neutro' | 'ativo' | 'recuado';
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const opacidade = useSharedValue(1);
  const largura = useSharedValue(espessura);

  useEffect(() => {
    const o = estado === 'recuado' ? 0.28 : 1;
    const l = estado === 'ativo' ? espessura + 6 : espessura;
    opacidade.set(reduzido ? o : withTiming(o, { duration: Motion.duration.base, easing: Motion.easing.out }));
    largura.set(reduzido ? l : withTiming(l, { duration: Motion.duration.base, easing: Motion.easing.out }));
  }, [estado, espessura, reduzido, opacidade, largura]);

  return (
    <Group opacity={opacidade}>
      <Path path={arco} color={theme[tom]} style="stroke" strokeWidth={largura} strokeCap="butt" />
    </Group>
  );
}

const styles = StyleSheet.create({
  centro: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 2 },
});
```

- [ ] **Step 5: Rodar**

Run: `node --test src/design/donut-math.test.ts && npx tsc --noEmit && npx expo lint && npm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add src/design/donut-math.ts src/design/donut-math.test.ts src/components/ui/donut-chart.tsx
git commit -m "feat(ui): rosca tonal com seleção por toque"
```

---

### Task 20: Linha de lançamento, FAB que recolhe e o período enxuto

**Files:**
- Create: `src/components/ui/ledger-row.tsx`, `src/components/ui/extended-fab.tsx`
- Modify: `src/components/finance/month-picker.tsx` (prop `variant`)
- Modify: `src/components/finance/period-bar.tsx` (repassa `variant`)

**Interfaces:**
- Produces:
  - `LedgerRow({ title, subtitle?, icon: IconName, cents, signed, tone: ThemeColor | 'plain', date, quote?: string | null, onLongPress?, accessibilityLabel })`
  - `ExtendedFab({ label: string; icon: IconName; onPress: () => void })` — lê `useRolagemDaTela`; vai no `overlay` do `Screen`.
  - `MonthPicker` e `PeriodBar` ganham `variant?: 'card' | 'bare'` (padrão `card`; as outras telas não mudam).

- [ ] **Step 1: `src/components/ui/ledger-row.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Fonts, type ThemeColor } from '@/constants/theme';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** Prévia da citação (o corpo inteiro está a um toque, no detalhe) — §7. */
const CITACAO = 90;

/**
 * A linha de lançamento das raízes: selo de categoria, título, meta, valor e data empilhados, e
 * — quando o lançamento veio de uma fala — a citação do que a pessoa disse.
 *
 * Mesmo contrato do `Row` para o `ItemLink`: sem `onLongPress` (iOS) ela é uma `View`, porque
 * quem abre o menu lá é o `Link.Menu`. Feedback de linha é highlight, nunca escala (§5).
 */
export function LedgerRow({
  title,
  subtitle,
  icon,
  cents,
  signed,
  tone,
  date,
  quote,
  onLongPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  cents: number;
  signed: boolean;
  tone: ThemeColor | 'plain';
  date: string;
  quote?: string | null;
  onLongPress?: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const citacao = quote ? (quote.length > CITACAO ? `${quote.slice(0, CITACAO).trimEnd()}…` : quote) : null;

  const conteudo = (pressed: boolean) => (
    <View style={[styles.linha, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
        <Icon name={icon} size="md" color="text" />
      </View>
      <View style={styles.textos}>
        <ThemedText type="default">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
        {citacao ? (
          <View style={styles.citacao}>
            <View style={[styles.barra, { backgroundColor: theme.rail }]} />
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.italico}>
              {`“${citacao}”`}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <View style={styles.direita}>
        <Money cents={cents} variant="ticker" tone={tone} signed={signed} />
        <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
          {date}
        </ThemedText>
      </View>
    </View>
  );

  if (!onLongPress) return conteudo(false);
  return (
    <Pressable onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {({ pressed }) => conteudo(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A mesma válvula do `Row`: o valor desce de linha antes de o título partir (minWidth medido).
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  selo: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: 2 },
  citacao: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  barra: { width: 2, borderRadius: Radius.pill },
  italico: { flex: 1, fontFamily: Fonts.italic },
  direita: { alignItems: 'flex-end', gap: Space.half, marginLeft: 'auto' },
});
```

- [ ] **Step 2: `src/components/ui/extended-fab.tsx`**

```tsx
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { TAB_BAR_CLEARANCE } from '@/components/ui/pill-tab-bar';
import { useRolagemDaTela } from '@/components/ui/screen-scroll';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

const ALTURA = 48;
/** Quanto a rolagem precisa andar para o botão mudar de estado — tremer no dedo não conta. */
const LIMIAR = 6;

/**
 * O FAB estendido do Material: pílula "+ Lançar" que recolhe para o círculo ao rolar para baixo e
 * volta ao rolar para cima (ou perto do topo). Lê a rolagem da tela na UI thread.
 *
 * A largura anima de propósito: é UM botão, e a alternativa (escala) amassaria o canto da pílula.
 */
export function ExtendedFab({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const theme = useTheme();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const reduzido = useReducedMotion();
  const rolagem = useRolagemDaTela();
  const aberto = useSharedValue(1);
  const alvo = useSharedValue(1);
  const [larguraAberta, setLarguraAberta] = useState(0);

  useAnimatedReaction(
    () => rolagem.get(),
    (y, anterior) => {
      const delta = anterior == null ? 0 : y - anterior;
      const novo = y < 24 ? 1 : delta > LIMIAR ? 0 : delta < -LIMIAR ? 1 : alvo.get();
      if (novo === alvo.get()) return;
      alvo.set(novo);
      aberto.set(reduzido ? novo : withTiming(novo, { duration: Motion.duration.base, easing: Motion.easing.out }));
    },
    [reduzido]
  );

  const estiloPilula = useAnimatedStyle(() =>
    larguraAberta > 0 ? { width: ALTURA + (larguraAberta - ALTURA) * aberto.get() } : {}
  );
  const estiloRotulo = useAnimatedStyle(() => ({
    opacity: aberto.get(),
    transform: [{ translateX: (1 - aberto.get()) * Space.sm }],
  }));

  return (
    <View
      style={[
        styles.ancora,
        {
          // No Android o FAB sobe ACIMA da `PillTabBar` (que flutua); a folga já está na constante.
          bottom: insets.bottom + (Platform.OS === 'android' ? TAB_BAR_CLEARANCE : Space.xxl),
        },
      ]}>
      <PressableScale haptic="light" accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <Animated.View
          style={[
            styles.pilula,
            { backgroundColor: theme.tintFill, boxShadow: Elevation[scheme].floating },
            estiloPilula,
          ]}>
          <Icon name={icon} size="md" color="onTint" />
          <Animated.View style={estiloRotulo}>
            <ThemedText type="smallBold" themeColor="onTint" style={styles.semEncolher}>
              {label}
            </ThemedText>
          </Animated.View>
        </Animated.View>
      </PressableScale>
      {/* A medida da pílula aberta, invisível: é o alvo da largura. */}
      <View
        pointerEvents="none"
        style={[styles.pilula, styles.medida]}
        onLayout={(e) => setLarguraAberta(e.nativeEvent.layout.width)}>
        <Icon name={icon} size="md" color="onTint" />
        <ThemedText type="smallBold" style={styles.semEncolher}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ancora: { position: 'absolute', right: Space.lg, zIndex: 11, elevation: 11 },
  pilula: {
    height: ALTURA,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: (ALTURA - 20) / 2,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  medida: { position: 'absolute', opacity: 0, right: 0 },
  semEncolher: { flexShrink: 0 },
});
```

(Se o `anti-slop.test.ts` recusar `elevation: 11`, repetir exatamente o que o FAB atual do Financeiro fazia — ele passava nos testes com `zIndex: 11, elevation: 11` no estilo; conferir antes de mudar.)

- [ ] **Step 3: `MonthPicker` enxuto** — em `src/components/finance/month-picker.tsx`:

1. Em `MonthPickerProps`:
```tsx
  /** `bare`: sem card em volta, título maior (raiz do Financeiro). As outras telas seguem `card`. */
  variant?: 'card' | 'bare';
```
e `variant = 'card'` na desestruturação.
2. O container:
```tsx
    <View
      style={
        variant === 'bare'
          ? styles.nu
          : [styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]
      }>
```
3. O título: `<ThemedText type={variant === 'bare' ? 'subtitle' : 'smallBold'}>{monthTitle(month)}</ThemedText>`.
4. O rodapé: o divisor só no `card`:
```tsx
      {children ? (
        <>
          {variant === 'card' ? <View style={[styles.divisor, { backgroundColor: theme.separator }]} /> : null}
          <View style={variant === 'card' ? styles.rodape : styles.rodapeNu}>{children}</View>
        </>
      ) : null}
```
5. Estilos novos: `nu: { gap: Space.xs }`, `rodapeNu: { paddingHorizontal: Space.xs }`.

Em `src/components/finance/period-bar.tsx`: `Props` ganha `variant?: 'card' | 'bare'`; `PeriodBar({ month, onChangeMonth, ruler, variant })` repassa `variant={variant}` ao `MonthPicker`.

- [ ] **Step 4: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ledger-row.tsx src/components/ui/extended-fab.tsx src/components/finance/month-picker.tsx src/components/finance/period-bar.tsx
git commit -m "feat(ui): linha de lançamento com citação, FAB que recolhe e período sem card"
```

---

### Task 21: Tendência com seleção e "Para onde foi"

**Files:**
- Create: `src/components/finance/trend-card.tsx`, `src/components/finance/spending-donut.tsx`

**Interfaces:**
- Consumes: `BarTrack` (`ui/sparkline.tsx`), `Segmented`, `monthShort`, `monthTitle`, `MonthlyCashflow`; `DonutChart`, `TONS_DA_ROSCA`, `fatias`, `CHAVE_OUTRAS` (Task 19).
- Produces:
  - `TrendCard({ meses: readonly MonthlyCashflow[]; janela: string; onJanela: (v: string) => void })`
  - `type CategoriaDoMes = { categoria: string; total: number; comparacao: string | null; tom: 'warning' | 'success' | 'textSecondary' }`
  - `SpendingDonut({ itens: readonly CategoriaDoMes[]; onOpenCategory: (c: string) => void; onOpenAll: () => void })`

- [ ] **Step 1: `src/components/finance/trend-card.tsx`** — o bloco "Tendência mensal" sai da tela e ganha seleção:

```tsx
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { monthShort, monthTitle } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Money } from '@/components/ui/money';
import { Segmented } from '@/components/ui/segmented';
import { BarTrack } from '@/components/ui/sparkline';
import { Radius, Space } from '@/design/tokens';
import type { MonthlyCashflow } from '@/hooks/use-finance';
import { formatBRL } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

const JANELAS = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
] as const;
/** A altura útil e a largura da barra (traço fino, não bloco). */
const ALTURA_BARRA = 96;
const LARGURA_BARRA = 10;

/**
 * Entrou × saiu mês a mês. Tocar ou arrastar escolhe o mês, e o rodapé passa a dizer quanto
 * sobrou NAQUELE mês (antes dizia só do último). Os outros meses recuam (`dim`).
 *
 * A comparação é por CLARIDADE (tinta × cinza), nunca por cor semântica — a tampa clara é o
 * previsto que ainda não aconteceu (a pergunta de 09/09/2026: "tem que ter alguma coisa
 * explicando a diferença").
 */
export function TrendCard({
  meses,
  janela,
  onJanela,
}: {
  meses: readonly MonthlyCashflow[];
  janela: string;
  onJanela: (v: string) => void;
}) {
  const theme = useTheme();
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [largura, setLargura] = useState(0);
  const ultimo = useSharedValue(-1);
  // A escala é COMUM às duas barras: escalas separadas igualariam um mês em que uma é o dobro.
  const teto = Math.max(...meses.map((m) => Math.max(Number(m.income_cents), Number(m.expense_cents))), 1);
  const indice = escolhido !== null && escolhido < meses.length ? escolhido : meses.length - 1;
  const mes = meses[indice];

  const escolher = (i: number) => {
    setEscolhido(i);
    Haptics.selectionAsync();
  };

  const gesto = useMemo(() => {
    const noX = (x: number) => {
      'worklet';
      return Math.min(meses.length - 1, Math.max(0, Math.floor(x / (largura / meses.length))));
    };
    const arraste = Gesture.Pan()
      .enabled(largura > 0 && meses.length > 1)
      .activeOffsetX([-6, 6])
      .failOffsetY([-10, 10])
      .onUpdate((e) => {
        const i = noX(e.x);
        if (i !== ultimo.get()) {
          ultimo.set(i);
          runOnJS(escolher)(i);
        }
      })
      .onFinalize(() => ultimo.set(-1));
    const toque = Gesture.Tap()
      .enabled(largura > 0)
      .onEnd((e) => runOnJS(escolher)(noX(e.x)));
    return Gesture.Race(arraste, toque);
    // `escolher` só usa setters estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [largura, meses.length, ultimo]);

  const par = (m: MonthlyCashflow, i: number) => {
    const entrou = Number(m.income_cents);
    const saiu = Number(m.expense_cents);
    const tampa = (previsto: number, total: number) => {
      const bruta = total > 0 ? previsto / total : 0;
      return Number.isFinite(bruta) ? Math.min(1, Math.max(0, bruta)) : 0;
    };
    const barra = (total: number, previsto: number, forte: boolean) => (
      <View style={styles.trilho}>
        <BarTrack ratio={total / teto} index={i} height={ALTURA_BARRA} color={forte ? theme.text : theme.surfaceRaised} dim={i !== indice}>
          {tampa(previsto, total) > 0 ? (
            <View
              style={[
                styles.tampa,
                { flex: tampa(previsto, total), backgroundColor: theme.surface, borderColor: theme.separator },
              ]}
            />
          ) : null}
        </BarTrack>
      </View>
    );
    return (
      <View
        key={m.month}
        style={styles.slot}
        accessible
        accessibilityRole="button"
        accessibilityState={{ selected: i === indice }}
        accessibilityLabel={`${monthTitle(m.month.slice(0, 7))}: entrou ${formatBRL(entrou)}, saiu ${formatBRL(saiu)}`}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={() => escolher(i)}>
        <View style={styles.par}>
          {barra(entrou, Number(m.income_pending_cents), true)}
          {barra(saiu, Number(m.expense_pending_cents), false)}
        </View>
        <ThemedText
          type={i === indice ? 'smallBold' : 'small'}
          themeColor={i === indice ? 'text' : 'textSecondary'}
          style={styles.mes}>
          {monthShort(m.month.slice(0, 7))}
        </ThemedText>
      </View>
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.cabeca}>
        <View style={styles.legenda}>
          <View style={styles.chave}>
            <View style={[styles.amostra, { backgroundColor: theme.text }]} />
            <ThemedText type="caption" themeColor="textSecondary">entrou</ThemedText>
          </View>
          <View style={styles.chave}>
            <View style={[styles.amostra, { backgroundColor: theme.surfaceRaised, borderColor: theme.separator, borderWidth: 1 }]} />
            <ThemedText type="caption" themeColor="textSecondary">saiu</ThemedText>
          </View>
          <View style={styles.chave}>
            <View style={[styles.amostra, { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1 }]} />
            <ThemedText type="caption" themeColor="textSecondary">previsto</ThemedText>
          </View>
        </View>
        <Segmented options={JANELAS} value={janela} onChange={onJanela} />
      </View>

      <GestureDetector gesture={gesto}>
        <View style={styles.barras} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
          {meses.map(par)}
        </View>
      </GestureDetector>

      <View style={[styles.rodape, { backgroundColor: theme.cardFooter }]}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {`Sobrou em ${monthShort(mes.month.slice(0, 7))}`}
        </ThemedText>
        <Money cents={Number(mes.income_cents) - Number(mes.expense_cents)} variant="ticker" tone="auto" signed />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.lg,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  cabeca: { gap: Space.md },
  legenda: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.lg },
  chave: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  amostra: { width: 10, height: 10, borderRadius: Radius.pill },
  barras: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.md },
  slot: { flex: 1, gap: Space.xs },
  // Respiro interno menor que o `gap` entre meses: as duas barras leem como um par.
  par: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: Space.xs },
  trilho: { width: LARGURA_BARRA, height: ALTURA_BARRA, justifyContent: 'flex-end' },
  tampa: { width: '100%', borderTopLeftRadius: Radius.xs, borderTopRightRadius: Radius.xs, borderWidth: 1 },
  mes: { textAlign: 'center' },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginHorizontal: -Space.lg,
    marginBottom: -Space.lg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm + 2,
  },
});
```

(Conferir no `eslint` se a regra `react-hooks/exhaustive-deps` existe na config; se não existir, o comentário de desativação é removido.)

- [ ] **Step 2: `src/components/finance/spending-donut.tsx`**

```tsx
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { DonutChart, TONS_DA_ROSCA } from '@/components/ui/donut-chart';
import { Money } from '@/components/ui/money';
import { CHAVE_OUTRAS, fatias } from '@/design/donut-math';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export type CategoriaDoMes = {
  categoria: string;
  total: number;
  /** "+12% vs agosto", "não teve em agosto"… nulo enquanto o mês anterior não chegou. */
  comparacao: string | null;
  tom: 'warning' | 'success' | 'textSecondary';
};

/**
 * "Para onde foi": a rosca com o total no centro e a lista embaixo, as duas falando da MESMA
 * soma (o percentual divide pelo total das linhas — `finance.md`).
 *
 * Tocar na rosca seleciona e escreve a fatia no centro; tocar numa linha abre os lançamentos da
 * categoria, como antes.
 */
export function SpendingDonut({
  itens,
  onOpenCategory,
  onOpenAll,
}: {
  itens: readonly CategoriaDoMes[];
  onOpenCategory: (categoria: string) => void;
  onOpenAll: () => void;
}) {
  const theme = useTheme();
  const lista = useMemo(() => fatias(itens.map((i) => ({ chave: i.categoria, valor: i.total }))), [itens]);
  const total = itens.reduce((s, i) => s + i.total, 0);
  const [selecionada, setSelecionada] = useState(-1);
  const atual = selecionada >= 0 ? lista[selecionada] : null;
  const nome = (chave: string) => (chave === CHAVE_OUTRAS ? 'Outras' : chave);
  const pct = (valor: number) => (total > 0 ? Math.round((valor / total) * 100) : 0);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.rosca}>
        <DonutChart
          fatias={lista}
          selecionada={selecionada}
          onSelect={(i) => {
            if (i >= 0) Haptics.selectionAsync();
            setSelecionada((s) => (i === s ? -1 : i));
          }}>
          <ThemedText type="caption" themeColor="textSecondary">
            {atual ? nome(atual.chave) : 'Total'}
          </ThemedText>
          <Money cents={atual ? atual.valor : total} variant="headline" />
          {atual ? (
            <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
              {`${pct(atual.valor)}%`}
            </ThemedText>
          ) : null}
        </DonutChart>
      </View>

      <View>
        {lista.map((f, i) => {
          const item = itens.find((x) => x.categoria === f.chave);
          const outras = f.chave === CHAVE_OUTRAS;
          return (
            <Pressable
              key={f.chave}
              accessibilityRole="button"
              accessibilityLabel={`${nome(f.chave)}, ${pct(f.valor)}% dos gastos${item?.comparacao ? `, ${item.comparacao}` : ''}`}
              onPress={() => (outras ? onOpenAll() : onOpenCategory(f.chave))}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.linha,
                    {
                      backgroundColor: pressed
                        ? theme.backgroundSelected
                        : i === selecionada
                          ? theme.backgroundElement
                          : 'transparent',
                    },
                  ]}>
                  <View style={[styles.amostra, { backgroundColor: theme[TONS_DA_ROSCA[f.tom]], borderColor: theme.separator }]} />
                  <View style={styles.textos}>
                    <ThemedText type="default">{nome(f.chave)}</ThemedText>
                    {item?.comparacao ? (
                      <ThemedText type="caption" themeColor={item.tom} style={tabular}>
                        {item.comparacao}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View style={styles.direita}>
                    <Money cents={f.valor} variant="ticker" />
                    <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
                      {`${pct(f.valor)}%`}
                    </ThemedText>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingTop: Space.xl,
    paddingBottom: Space.sm,
    gap: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  rosca: { alignItems: 'center' },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  amostra: { width: 12, height: 12, borderRadius: Radius.pill, borderWidth: 1 },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: 2 },
  direita: { alignItems: 'flex-end', gap: 2, marginLeft: 'auto' },
});
```

- [ ] **Step 3: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/components/finance/trend-card.tsx src/components/finance/spending-donut.tsx
git commit -m "feat(financeiro): tendência com mês escolhido e rosca de para onde foi"
```

---

### Task 22: O Financeiro novo

**Files:**
- Modify (reescrita): `src/app/(tabs)/finance/index.tsx`
- Modify: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: Tasks 5–21; mantém TODOS os destinos do inventário (spec, Regra 0).

- [ ] **Step 1: Testes que falham** — acrescentar ao fim de `src/lib/simple-finance-ui.test.ts`:

```ts
test('Financeiro: os atalhos do mosaico levam aos mesmos destinos de antes', () => {
  const ui = screen(financeiroFile);
  const tiles = ui.nodes().filter((n: any) => n.type === 'Tile' && n.props.onPress);
  for (const t of tiles) t.props.onPress();
  const destinos = JSON.stringify(ui.navigations);
  for (const d of ['/finance/transactions', '/finance/accounts', '/finance/budgets', '/finance/forecast', '/finance/manage']) {
    assert.ok(destinos.includes(d), `o mosaico perdeu ${d}`);
  }
});

test('Financeiro: Entra e Sai abrem o ciclo filtrado pelo lado', () => {
  const ui = screen(financeiroFile);
  const entra = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Entra');
  const sai = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Sai');
  entra.props.onPress();
  sai.props.onPress();
  assert.equal(ui.navigations.at(-2).params.tipo, 'entra');
  assert.equal(ui.navigations.at(-1).params.tipo, 'sai');
  assert.equal(ui.navigations.at(-1).pathname, '/finance/cycle');
});

test('Financeiro: o FAB continua oferecendo as três formas de lançar', () => {
  const ui = screen(financeiroFile);
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  tela.props.overlay.props.onPress();
  assert.deepEqual(
    ui.actions.map((a) => a.label),
    ['Gasto ou receita', 'Gasto ou receita que se repete', 'Financiamento']
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/simple-finance-ui.test.ts`
Expected: os três novos falham (a tela ainda usa `Shortcut`/`Row`/`Button`).

- [ ] **Step 3: Reescrever `src/app/(tabs)/finance/index.tsx`**

```tsx
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { BudgetRings } from '@/components/finance/budget-rings';
import { CardStack, type StackedCard } from '@/components/finance/card-stack';
import { monthLabel, monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { useMonthRuler } from '@/components/finance/month-ruler';
import { PeriodBar } from '@/components/finance/period-bar';
import { SpendingDonut, type CategoriaDoMes } from '@/components/finance/spending-donut';
import { TrendCard } from '@/components/finance/trend-card';
import { ThemedText } from '@/components/themed-text';
import { AppHeader } from '@/components/ui/app-header';
import { BlockHeader } from '@/components/ui/block-header';
import { useBRL } from '@/components/ui/conceal';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { EmptyState } from '@/components/ui/empty-state';
import { ExtendedFab } from '@/components/ui/extended-fab';
import { HeroPanel } from '@/components/ui/hero-panel';
import { ItemLink } from '@/components/ui/item-link';
import { LedgerRow } from '@/components/ui/ledger-row';
import { Money } from '@/components/ui/money';
import { RingGauge } from '@/components/ui/ring-gauge';
import { Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { ScrubChart } from '@/components/ui/scrub-chart';
import { Skeleton, SkeletonCards, SkeletonChart, SkeletonHero, SkeletonList, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { Tile, TileGrid, TileRow } from '@/components/ui/tile';
import { useToast } from '@/components/ui/toast';
import { categoryIcon } from '@/design/category-icons';
import { Radius, Space } from '@/design/tokens';
import { useAgentActivity } from '@/hooks/use-agent-activity';
import {
  useAccounts,
  useBudgetsStatus,
  useCardSummary,
  useCashFlowForecast,
  useCycleMonth,
  useCycleSeries,
  useDebts,
  useDeleteTransaction,
  useMonthRange,
  useMonthlyCashflow,
  useRecentTransactions,
  useTransactionsSummary,
  type Transaction,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { orcamentosApertados } from '@/lib/budget-tight';
import { cartaoDaPilha } from '@/lib/card-status';
import { describeCycle, describeRealizado } from '@/lib/cycle-label';
import { isoToBR, mesmoMes } from '@/lib/dates';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

/**
 * Financeiro — "como o meu ciclo fecha", na estrutura de conversa organizada (spec 2026-09-17).
 *
 * | # | bloco | por quê |
 * |---|---|---|
 * | 1 | período | escopa a tela inteira |
 * | 2 | herói + curva arrastável | a pergunta que trouxe a pessoa |
 * | 3 | Entra \| Sai | a mesma série do herói, pelos dois lados |
 * | 4 | Cartões | a fatura é a maior saída isolada (pilha, voo e Carteira INTOCADOS) |
 * | 5 | mosaico | as portas do domínio |
 * | 6 | passando do limite | alerta, só quando dói |
 * | 7 | últimos lançamentos | a checagem diária, com a fala que os criou |
 * | 8 | para onde foi | análise, por data da compra |
 * | 9 | tendência | ao longo do tempo |
 *
 * Nenhum destino saiu (Regra 0 da spec): Projeção virou ladrilho, "Ver tudo" virou ladrilho,
 * "O que entra/sai" viraram os ladrilhos Entra/Sai.
 */

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: '',
  import: 'importado',
  recurring: 'recorrente',
};

/**
 * Dias até o fim do mês civil (mínimo 1) — só o PALPITE enquanto `cycle_now` não responde.
 */
function daysToMonthEnd(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, Math.ceil((last.getTime() - now.getTime()) / 86_400_000));
}

export default function FinanceScreen() {
  const brl = useBRL();
  const toast = useToast();
  const regua = useMonthRuler();
  const cycle = regua.cycle;
  /**
   * `null` = "siga o ciclo". O mês corrente é o ciclo que contém hoje, não o mês civil (com
   * fechamento no dia 10, o dia 15/09 já é o ciclo "outubro").
   */
  const [mesEscolhido, setMonth] = useState<string | null>(null);
  const mesCorrente = useCycleMonth(regua.view);
  const month = mesEscolhido ?? mesCorrente;

  const range = useMonthRange(month, regua.view);
  const previousMonth = useMemo(() => shiftMonth(month, -1), [month]);
  // Na MESMA régua do mês exibido, senão o "vs mês anterior" compara dois tipos de período.
  const previousRange = useMonthRange(previousMonth, regua.view);
  const isCurrent = month === mesCorrente;
  const { width } = useWindowDimensions();
  const daysLeft = cycle.data?.diasAteOFim ?? daysToMonthEnd();

  const forecast = useCashFlowForecast(daysLeft);
  const summary = useTransactionsSummary(range.from, range.to, range.pronto);
  const previous = useTransactionsSummary(previousRange.from, previousRange.to, previousRange.pronto);
  const budgets = useBudgetsStatus(month, regua.view);
  const accounts = useAccounts();
  const debts = useDebts();
  const cards = useCardSummary();
  const [janelaCashflow, setJanelaCashflow] = useState('6');
  const cashflow = useMonthlyCashflow(Number(janelaCashflow));
  const recent = useRecentTransactions(5);
  const atividade = useAgentActivity(6);
  const remove = useDeleteTransaction();

  /** Memoizado: um array novo a cada render remontava a carteira inteira. */
  const cartoesDaCarteira = useMemo<StackedCard[]>(() => (cards.data ?? []).map(cartaoDaPilha), [cards.data]);

  /*
    ⚠️ O herói lê a linha do tempo (`cycle_series`), a fonte única que o detalhe do ciclo soma
    linha a linha — e `describeCycle` decide como o ciclo é DESCRITO.
  */
  const serie = useCycleSeries(shiftMonth(month, -1), month, regua.view);
  const ciclo = serie.data?.find((c) => mesmoMes(c.mes, month)) ?? null;
  const cicloAnterior = serie.data?.find((c) => !mesmoMes(c.mes, month)) ?? null;
  const descricao = ciclo
    ? describeCycle(ciclo, monthTitle(month).replace(/ de \d{4}$/, '').toLowerCase())
    : null;
  const cicloRuim = descricao?.ruim ?? false;
  const sub = describeRealizado(ciclo, brl);
  const variacaoSaida =
    ciclo && cicloAnterior && Number(cicloAnterior.saiu) > 0
      ? Math.round(((Number(ciclo.saiu) - Number(cicloAnterior.saiu)) / Number(cicloAnterior.saiu)) * 100)
      : null;

  /* `useMemo` não é micro-otimização: o `Sparkline` memoiza o desenho pela identidade da série. */
  const series = useMemo(() => (forecast.data ?? []).map((d) => Number(d.balance_cents)), [forecast.data]);
  const rotulos = useMemo(() => (forecast.data ?? []).map((d) => isoToBR(d.day).slice(0, 5)), [forecast.data]);
  const chartWidth = width - Space.lg * 2 - Space.gutter * 2;
  const fimDoCiclo = ciclo?.fim ?? cycle.data?.ate ?? null;

  /** A citação de cada lançamento que veio de uma fala (mesma chave da Hoje: sem consulta a mais). */
  const citacoes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const l of atividade.data ?? []) {
      const texto = l.origin_text?.trim();
      if (l.result_id && texto && l.record?.kind === 'transaction') mapa.set(l.result_id, texto);
    }
    return mapa;
  }, [atividade.data]);

  const categories = useMemo(() => {
    const rows = (summary.data ?? []).filter((r) => r.kind === 'expense');
    return [...rows].sort((a, b) => Number(b.total_cents) - Number(a.total_cents));
  }, [summary.data]);
  const previousByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of previous.data ?? []) if (r.kind === 'expense') map.set(r.category, Number(r.total_cents));
    return map;
  }, [previous.data]);
  /*
    Numerador e denominador da MESMA coluna (`finance.md`): o percentual divide pela soma das
    linhas mostradas — foi o divisor "realizado" que escreveu "0% do mês" em todas.
  */
  const itensDaRosca = useMemo<CategoriaDoMes[]>(
    () =>
      categories.map((row) => {
        const total = Number(row.total_cents);
        const before = previousByCategory.get(row.category) ?? 0;
        const delta = previous.isSuccess && before > 0 ? Math.round(((total - before) / before) * 100) : null;
        const comparacao = !previous.isSuccess
          ? null
          : delta === null
            ? `não teve em ${monthLabel(previousMonth)}`
            : delta === 0
              ? `igual a ${monthLabel(previousMonth)}`
              : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}% vs ${monthLabel(previousMonth)}`;
        return {
          categoria: row.category,
          total,
          comparacao,
          tom: delta !== null && delta >= 10 ? 'warning' : delta !== null && delta <= -10 ? 'success' : 'textSecondary',
        };
      }),
    [categories, previousByCategory, previous.isSuccess, previousMonth]
  );

  const apertados = useMemo(() => orcamentosApertados(budgets.data ?? []), [budgets.data]);
  const maisApertado = apertados.reduce<number>((m, o) => Math.max(m, o.fracaoGasta), 0);

  // O corte do futuro com a data LOCAL: às 22h o `current_date` do servidor já virou o dia.
  const mesAtual = localISODate().slice(0, 7);
  const meses = (cashflow.data ?? []).filter((m) => m.month.slice(0, 7) <= mesAtual);

  /*
    O PORTÃO DA TELA — as bordas entram como CONSULTA (`range`), e os DOIS ranges entram: sem o
    anterior, o "vs setembro" chegaria depois da primeira pintura. Ver `tela-pronta.ts`.
  */
  const pronta = useTelaPronta(
    forecast, summary, previous, budgets, accounts, debts, cards, cashflow, recent, serie,
    cycle, range, previousRange, atividade,
  );

  const cicloFalhou = cycle.isError && !cycle.data;
  const bordasChegando = !range.pronto && !range.isError;
  const heroLoading = bordasChegando || summary.isLoading || (isCurrent && forecast.isLoading);
  const heroError = cicloFalhou || range.isError || summary.isError || (isCurrent && forecast.isError);
  const isEmpty =
    summary.isSuccess && recent.isSuccess && (summary.data ?? []).length === 0 && (recent.data ?? []).length === 0;

  /** `refetch` ignora `enabled`: o resumo só é refeito com as bordas definitivas. */
  const refazerPeriodo = () =>
    Promise.all([
      ...(cicloFalhou ? [cycle.refetch()] : []),
      ...(range.isError ? [range.refetch()] : []),
      ...(previousRange.isError ? [previousRange.refetch()] : []),
      ...(range.pronto ? [summary.refetch()] : []),
      ...(previousRange.pronto ? [previous.refetch()] : []),
    ]);

  const confirmDelete = (tx: Transaction) => {
    const what = `${formatBRL(tx.amount_cents)}${tx.category ? ` em ${tx.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(tx.id, {
          onSuccess: () => toast({ message: `Apaguei ${what}.`, tone: 'success' }),
          onError: () => toast({ message: 'Não deu para apagar. Tenta de novo.', tone: 'error' }),
        }),
      `${what}. Isso não volta.`
    );
  };

  const abrirFatura = (card: StackedCard) =>
    card.invoice_id
      ? router.push({ pathname: '/finance/invoice/[id]', params: { id: card.invoice_id } })
      : router.push('/finance/cards');

  const openTransactions = (params: Record<string, string>) =>
    router.push({ pathname: '/finance/transactions', params: { month, ...params } });
  const abrirCiclo = (tipo: 'tudo' | 'entra' | 'sai') =>
    router.push({ pathname: '/finance/cycle', params: { month, view: regua.view, tipo } });

  const lancar = () =>
    showItemActions('Lançar', [
      { label: 'Gasto ou receita', onPress: () => router.push({ pathname: '/finance/transaction-form', params: { month } }) },
      { label: 'Gasto ou receita que se repete', onPress: () => router.push({ pathname: '/finance/recurring', params: { create: '1' } }) },
      { label: 'Financiamento', onPress: () => router.push({ pathname: '/finance/debts', params: { create: 'financing' } }) },
    ]);

  if (!pronta) {
    return (
      <Screen grouped topBar={<AppHeader title="Financeiro" />}>
        <Skeleton width="55%" height={26} />
        <SkeletonHero />
        <View style={styles.linhaEsqueleto}>
          <Skeleton width="48%" height={112} radius={Radius.md} />
          <Skeleton width="48%" height={112} radius={Radius.md} />
        </View>
        <SkeletonCards />
        <SkeletonList linhas={3} />
        <SkeletonChart />
      </Screen>
    );
  }

  const entrou = Number(ciclo?.entrou ?? 0);
  const saiu = Number(ciclo?.saiu ?? 0);
  const entrouRealizado = Number(ciclo?.entrou_realizado ?? 0);
  const saiuRealizado = Number(ciclo?.saiu_realizado ?? 0);
  const debtsTotal = (debts.data ?? []).reduce((soma, d) => soma + Number(d.remaining_cents), 0);

  return (
    <Screen
      floatingAction
      stagger
      grouped
      topBar={<AppHeader title="Financeiro" />}
      overlay={<ExtendedFab label="Lançar" icon="plus" onPress={lancar} />}
      onRefresh={() =>
        Promise.all([
          refazerPeriodo(),
          forecast.refetch(),
          budgets.refetch(),
          accounts.refetch(),
          cards.refetch(),
          recent.refetch(),
          cashflow.refetch(),
          atividade.refetch(),
        ])
      }>
      <PeriodBar month={month} onChangeMonth={setMonth} ruler={regua} variant="bare" />

      {heroLoading ? (
        <View style={styles.heroSkeleton}>
          <Skeleton width="55%" height={14} />
          <Skeleton width="70%" height={46} />
        </View>
      ) : heroError ? (
        <ErrorCard
          onRetry={() => {
            void refazerPeriodo();
            void forecast.refetch();
          }}
        />
      ) : (
        <HeroPanel
          surface="live"
          label={descricao?.label ?? 'Saldo projetado'}
          value={
            <CountUpMoney cents={descricao?.cents ?? 0} variant="heroMoney" tone={cicloRuim ? 'onHeroDanger' : 'onHero'} />
          }
          footer={
            descricao?.rodape ? (
              <View style={styles.heroRodape}>
                <ThemedText type="footnote" themeColor="onHeroMuted">
                  {descricao.rodape.label}
                </ThemedText>
                <Money cents={descricao.rodape.cents} variant="footnote" tone="onHero" concealable />
              </View>
            ) : undefined
          }
          secondary={
            variacaoSaida !== null
              ? {
                  icon: variacaoSaida > 0 ? 'arrow.up.right' : 'arrow.down.right',
                  negative: variacaoSaida > 0,
                  text: `${variacaoSaida > 0 ? '+' : ''}${variacaoSaida}% de gastos vs ${monthLabel(previousMonth)}`,
                }
              : undefined
          }
          chart={
            // Em mês passado a curva não aparece: projeção de um período fechado é ficção.
            isCurrent && series.length > 1 ? (
              <ScrubChart
                values={series}
                labels={rotulos}
                width={chartWidth}
                formatValue={brl}
                legenda={
                  <>
                    <ThemedText type="caption" themeColor="onHeroMuted">Hoje</ThemedText>
                    <ThemedText type="caption" themeColor={cicloRuim ? 'onHeroDanger' : 'onHeroSuccess'}>
                      {`${brl(descricao?.cents ?? 0)} projetado`}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="onHeroMuted">
                      {fimDoCiclo ? isoToBR(fimDoCiclo).slice(0, 5) : ''}
                    </ThemedText>
                  </>
                }
              />
            ) : undefined
          }
          concealable
          onPress={() =>
            showItemActions('Mais opções', [
              { label: 'Ver o que fecha o ciclo', icon: 'list.bullet', onPress: () => abrirCiclo('tudo') },
              { label: 'O que entra', icon: 'arrow.down.circle', onPress: () => abrirCiclo('entra') },
              { label: 'O que sai', icon: 'arrow.up.circle', onPress: () => abrirCiclo('sai') },
              { label: 'Projeção', icon: 'chart.line.uptrend.xyaxis', onPress: () => router.push('/finance/forecast') },
              { label: 'Patrimônio', icon: 'building.columns', onPress: () => router.push('/finance/net-worth') },
              { label: 'Metas', icon: 'target', onPress: () => router.push('/finance/goals') },
            ])
          }
        />
      )}

      {/* Entra | Sai somam o MESMO número do herói — leem a mesma série. */}
      <TileRow>
        <Tile
          icon="arrow.down.left"
          label="Entra"
          value={ciclo ? <Money cents={entrou} variant="title2" tone="success" /> : undefined}
          caption={sub.entra || undefined}
          footer={entrou > 0 ? <ProgressBar value={entrouRealizado} max={entrou} tone="strong" /> : undefined}
          onPress={() => abrirCiclo('entra')}
        />
        <Tile
          icon="arrow.up.right"
          label="Sai"
          value={ciclo ? <Money cents={saiu} variant="title2" /> : undefined}
          caption={sub.sai || undefined}
          footer={saiu > 0 ? <ProgressBar value={saiuRealizado} max={saiu} tone="strong" /> : undefined}
          onPress={() => abrirCiclo('sai')}
        />
      </TileRow>

      {cards.isError ? (
        <ErrorCard onRetry={cards.refetch} />
      ) : (cards.data ?? []).length > 0 ? (
        <View style={styles.bloco}>
          <BlockHeader
            title="Cartões"
            count={cards.data!.length}
            action={{ label: 'Ver todos', accessibilityLabel: 'Ver todos os cartões', onPress: () => router.push('/finance/cards') }}
          />
          {/* A fatura do cartão da frente abre pelo "fecha ›" da face; tocar no corpo abre a Carteira. */}
          <CardStack cards={cartoesDaCarteira} onOpen={abrirFatura} />
        </View>
      ) : null}

      <View style={styles.bloco}>
        <BlockHeader title="Atalhos" />
        <TileGrid>
          {/* Sem contagem em Lançamentos: `summary` conta categorias, não lançamentos (§8). */}
          <Tile
            layout="half"
            icon="list.bullet"
            label="Lançamentos"
            value={<ThemedText type="headline">{monthTitle(month).replace(/ de \d{4}$/, '')}</ThemedText>}
            onPress={() => router.push({ pathname: '/finance/transactions', params: { month, view: regua.view } } as Href)}
          />
          <Tile
            layout="half"
            icon="chart.line.uptrend.xyaxis"
            label="Projeção"
            value={<ThemedText type="headline">Mês a mês</ThemedText>}
            visual={isCurrent && series.length > 1 ? <Sparkline values={series} width={64} height={28} /> : undefined}
            onPress={() => router.push('/finance/forecast')}
          />
          <Tile
            layout="half"
            icon="wallet.pass"
            label="Contas"
            value={
              accounts.data ? (
                <ThemedText type="headline">
                  {`${accounts.data.length} ${accounts.data.length === 1 ? 'conta' : 'contas'}`}
                </ThemedText>
              ) : undefined
            }
            onPress={() => router.push('/finance/accounts')}
          />
          <Tile
            layout="half"
            icon="chart.pie"
            label="Orçamentos"
            value={
              budgets.data ? (
                <ThemedText type="headline">
                  {`${budgets.data.length} ${budgets.data.length === 1 ? 'limite' : 'limites'}`}
                </ThemedText>
              ) : undefined
            }
            visual={
              apertados.length > 0 ? (
                <RingGauge
                  value={maisApertado}
                  size={28}
                  stroke={4}
                  tone={apertados.some((o) => o.estourou) ? 'danger' : 'warning'}
                  accessibilityLabel={`Orçamento mais apertado em ${Math.round(maisApertado * 100)}%`}
                />
              ) : undefined
            }
            onPress={() => router.push('/finance/budgets')}
          />
          {/* Dívida só existe no mosaico quando existe — e o número é o que falta pagar. */}
          {debts.data?.length ? (
            <Tile
              layout="half"
              icon="banknote"
              label="Dívidas"
              value={<Money cents={debtsTotal} variant="headline" />}
              onPress={() => router.push('/finance/debts')}
            />
          ) : null}
          <Tile
            layout={debts.data?.length ? 'half' : 'wide'}
            icon="ellipsis.circle"
            label="Tudo o que dá para gerenciar"
            accessibilityLabel="Ver tudo que dá para gerenciar"
            onPress={() => router.push('/finance/manage')}
          />
        </TileGrid>
      </View>

      {budgets.isError ? (
        <ErrorCard onRetry={budgets.refetch} />
      ) : apertados.length > 0 ? (
        <View style={styles.bloco}>
          <BlockHeader title="Passando do limite" count={apertados.length} />
          <BudgetRings itens={apertados} onPress={() => router.push('/finance/budgets')} />
        </View>
      ) : null}

      {recent.isError ? (
        <ErrorCard onRetry={recent.refetch} />
      ) : recent.isLoading ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : (recent.data ?? []).length > 0 ? (
        <View style={styles.bloco}>
          {/* Lista CHAPADA: a ordem é a do registro (`created_at`), e cabeçalho de dia contradiria. */}
          <BlockHeader title="Últimos lançamentos" action={{ label: 'Ver todos', onPress: () => openTransactions({}) }} />
          <Section>
            {(recent.data ?? []).map((tx) => {
              const titulo = tx.description || tx.merchant || tx.category || 'Sem descrição';
              const destino = { pathname: '/finance/[txId]' as const, params: { txId: tx.id, month: tx.occurred_at.slice(0, 7) } };
              return (
                <ItemLink
                  key={tx.id}
                  href={destino}
                  title={titulo}
                  actions={[
                    { label: 'Ver detalhe', icon: 'doc.text.magnifyingglass', onPress: () => router.push(destino) },
                    {
                      label: 'Editar',
                      icon: 'pencil',
                      onPress: () => router.push({ pathname: '/finance/transaction-form', params: { id: tx.id, month } }),
                    },
                    { label: 'Apagar', icon: 'trash', destructive: true, onPress: () => confirmDelete(tx) },
                  ]}>
                  {({ onLongPress }) => (
                    <LedgerRow
                      title={titulo}
                      subtitle={[tx.category, SOURCE_LABEL[tx.source]].filter(Boolean).join(' · ') || undefined}
                      icon={categoryIcon(tx.category, tx.kind)}
                      cents={tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents}
                      signed={tx.kind !== 'transfer'}
                      tone={tx.kind === 'income' ? 'success' : 'text'}
                      date={formatDateBR(tx.occurred_at)}
                      quote={citacoes.get(tx.id) ?? null}
                      onLongPress={onLongPress}
                      accessibilityLabel={`${titulo}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}`}
                    />
                  )}
                </ItemLink>
              );
            })}
          </Section>
        </View>
      ) : null}

      {/* Por DATA DA COMPRA (o herói é por data do pagamento): a pílula diz a lente. */}
      {summary.isError ? null : itensDaRosca.length > 0 ? (
        <View style={styles.bloco}>
          <BlockHeader title="Para onde foi" tag="por data da compra" />
          <SpendingDonut
            itens={itensDaRosca}
            onOpenCategory={(category) => openTransactions({ category })}
            onOpenAll={() => openTransactions({ kind: 'expense' })}
          />
        </View>
      ) : null}

      {cashflow.isError ? (
        <ErrorCard onRetry={cashflow.refetch} />
      ) : cashflow.isLoading ? (
        <Skeleton height={180} radius={Radius.md} />
      ) : meses.length > 1 ? (
        <View style={styles.bloco}>
          <BlockHeader title="Tendência" />
          <TrendCard meses={meses} janela={janelaCashflow} onJanela={setJanelaCashflow} />
        </View>
      ) : null}

      {isEmpty ? (
        <EmptyState
          title="Ainda não tem movimento"
          hint={'Manda “gastei 45 no mercado” no WhatsApp —\nou toca no + para lançar aqui'}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloco: { gap: Space.md },
  heroSkeleton: { gap: Space.md },
  heroRodape: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.sm,
  },
  linhaEsqueleto: { flexDirection: 'row', justifyContent: 'space-between' },
});
```

Notas para quem executa:
- `Money` recebe `variant: TypeVariant` (`Type`), cujas chaves são `display`, `largeTitle`, `title`, `title2`, `headline`, `body`, `callout`, `subhead`, `footnote`, `caption`, `money`, `heroMoney`, `meta`, `code`, `ticker`. Usar `title2` (não `subtitle`) no `Money`. O `ThemedText` aceita `subtitle` (mapeado para `title2`).
- O `href` de Lançamentos com `view` já existia assim; o `as Href` só acalma a união tipada se o TypeScript reclamar.
- Se `ellipsis.circle` ou `arrow.down.left` não estiverem no mapa do `Icon`, acrescentar (`more_horiz` / `south_west`).

- [ ] **Step 4: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: verde — inclusive os cinco testes antigos do Financeiro (bordas falhando → `ErrorCard`; "Tentar de novo" refaz o range; esqueleto na troca de mês; portão segura o anterior; sem falha com o período resolvido) e os três novos.

- [ ] **Step 5: Verificar nos dois aparelhos** (roteiro da Task 12) com foco em:
  - período em uma linha; ‹ › e o toque no título (abre o seletor de ano); Mês | Ciclo;
  - herói com tinta viva; arrastar a curva mostra "DD/MM · R$ X" com háptico e NÃO abre o menu ao soltar; o "…" abre as 6 opções;
  - Entra/Sai com barras; tocar abre o ciclo filtrado;
  - Cartões: cabeçalho novo; a pilha, o voo para a Carteira, o "fecha ›" e a volta continuam IGUAIS (gravar a ida e a volta nos dois sistemas);
  - mosaico (todos os destinos), anéis, lançamentos com citação (usar o lançamento criado na Task 17 antes de apagá-lo), toque longo/menu de contexto;
  - rosca: tocar fatia seleciona, centro muda; tocar linha abre a categoria; "Outras" abre despesas;
  - tendência: tocar e arrastar muda o mês e o "Sobrou em";
  - FAB recolhe ao rolar para baixo, volta ao subir; o menu Lançar tem as 3 opções;
  - 384dp × 1,3 no Android: Entra/Sai não cortam o valor (se cortar, trocar o `variant` do `Money` para `headline`), ladrilhos não estouram.
- [ ] **Step 6: Commit**

```bash
git add "src/app/(tabs)/finance/index.tsx" src/lib/simple-finance-ui.test.ts
git commit -m "feat(financeiro): tela nova com curva arrastável, mosaico, rosca e lançamentos com a fala"
```

---

# Fase 4 — Notas, Agente e Perfil adotam o kit

Pele e cabeçalhos; nenhum comportamento muda.

### Task 23: `Section` com cabeçalho de bloco e o Perfil

**Files:**
- Modify: `src/components/ui/row.tsx` (`Section`)
- Modify: `src/app/(tabs)/profile/index.tsx` (5 `Section title=`)
- Modify: `src/components/profile/lock-section.tsx:56`, `src/components/profile/alert-preferences-section.tsx:103`

**Interfaces:**
- Produces: `Section({ title?, heading?: 'small' | 'block', children })` — `block` desenha `BlockHeader`; `small` (padrão) é o título de 14px de hoje (as telas empurradas não mudam).

- [ ] **Step 1: `Section`** — em `src/components/ui/row.tsx`:

```tsx
import { BlockHeader } from '@/components/ui/block-header';
```
```tsx
export function Section({
  title,
  heading = 'small',
  children,
}: {
  title?: string;
  /** `block`: o cabeçalho das raízes (`BlockHeader`). `small`: o título das telas empurradas. */
  heading?: 'small' | 'block';
  children: ReactNode;
}) {
  const theme = useTheme();
  const items = Children.toArray(children);

  return (
    <View style={[styles.section, heading === 'block' && styles.sectionBloco]}>
      {title ? (
        heading === 'block' ? (
          <BlockHeader title={title} />
        ) : (
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            {title}
          </ThemedText>
        )
      ) : null}
      {/* …o grupo continua igual… */}
```
e o estilo `sectionBloco: { gap: Space.md },`.

- [ ] **Step 2: Perfil** — em `src/app/(tabs)/profile/index.tsx`, trocar `<Section title="Aparência">`, `<Section title="Meu mês">`, `<Section title="Conta">`, `<Section title="Dados">`, `<Section title="App">` por `<Section heading="block" title="…">`; o mesmo em `lock-section.tsx` (`"Bloqueio"`) e `alert-preferences-section.tsx` (`"Notificações"`).

- [ ] **Step 3: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/row.tsx "src/app/(tabs)/profile/index.tsx" src/components/profile/lock-section.tsx src/components/profile/alert-preferences-section.tsx
git commit -m "feat(perfil): cabeçalhos de bloco do kit novo"
```

---

### Task 24: Notas e Agente

**Files:**
- Modify: `src/app/(tabs)/notes/index.tsx` (3 `SectionHead`)
- Modify: `src/app/(tabs)/agent/index.tsx` (cabeçalho da lista, exemplos)

- [ ] **Step 1: Notas** — trocar o import de `SectionHead` por `import { BlockHeader } from '@/components/ui/block-header';` e:

1. "Pastas" (dentro do `Pressable` que recolhe):
```tsx
              <BlockHeader
                title="Pastas"
                count={pastas.length}
                trailing={
                  <Icon name={pastasRecolhidas ? 'chevron.down' : 'chevron.up'} size="sm" color="textSecondary" />
                }
              />
```
(o `View style={styles.recolher}` e o `ThemedText` da contagem saem; se `styles.recolher` ficar sem uso, apagar.)
2. `<SectionHead title="Fixadas" inset={false} />` → `<BlockHeader title="Fixadas" count={fixadas.length} />`.
3. `<SectionHead title={procurando ? 'Resultados' : 'Notas'} inset={false} />` → `<BlockHeader title={procurando ? 'Resultados' : 'Notas'} count={soltas.length} />`.

- [ ] **Step 2: Agente** — em `src/app/(tabs)/agent/index.tsx`:

1. `import { BlockHeader } from '@/components/ui/block-header';` e `import { Tile, TileGrid } from '@/components/ui/tile';`.
2. Na `FlashList` das conversas, `ListHeaderComponent={<View style={styles.cabecaLista}><BlockHeader title="Conversas" count={conversas.length} /></View>}` com `cabecaLista: { paddingBottom: Space.md }` (se a lista já tiver `ListHeaderComponent`, o cabeçalho entra no topo dele).
3. Na conversa vazia, trocar o `.map` de `Pressable` dos exemplos por:
```tsx
          <TileGrid>
            {EXEMPLOS_DO_AGENTE.map((p) => (
              <Tile
                key={p}
                layout="half"
                icon="bubble.left"
                label="Pergunte"
                value={<ThemedText type="headline">{p}</ThemedText>}
                accessibilityLabel={p}
                onPress={() => router.push(`/agent/new?prompt=${encodeURIComponent(p)}`)}
              />
            ))}
          </TileGrid>
```
(o estilo `prompt` e o `theme` só dele saem se ficarem sem uso.)

- [ ] **Step 3: Rodar**

Run: `npx tsc --noEmit && npx expo lint && npm test`
Expected: verde (o `anti-slop` exige `<Screen>` nas duas — elas já usam).

- [ ] **Step 4: Verificar nos dois aparelhos** — Notas (recolher pastas, fixadas, busca, arrastar para reordenar — o `DragScrollView` não pode ter mudado), Agente (lista e conversa vazia com os exemplos abrindo conversa com o texto), Perfil (todas as seções e controles). Claro/escuro, 384dp × 1,3.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(tabs)/notes/index.tsx" "src/app/(tabs)/agent/index.tsx"
git commit -m "feat(ui): notas e agente adotam o cabeçalho e o ladrilho do kit"
```

---

# Fase 5 — Fechamento

### Task 25: Vitrine, documentação e revisão final

**Files:**
- Modify: `src/app/design-preview.tsx`
- Modify: `docs/superpowers/specs/2026-09-17-hoje-financeiro-conversa-design.md` (seção "Como ficou")
- Modify: `DESIGN.md` (pelo documentador da impeccable)
- Modify: `CLAUDE.md` (linha "Design" da tabela de stack)

- [ ] **Step 1: Vitrine** — em `src/app/design-preview.tsx`, semear as chaves que as raízes novas leem (nomes EXATOS dos hooks):
```ts
  client.setQueryData(['spendable', ''], [{ caixa: 3657180, comprometido_ate_entrada: 1233320, comprometido_no_ciclo: 1233320, a_receber_no_ciclo: 0, proxima_entrada: null }][0]);
  client.setQueryData(['spendable-path', ''], [
    { day: hoje, out_cents: 21430, title: 'Energia', origin: 'transaction', ref_id: 'prev-energia' },
  ]);
  client.setQueryData(['upcoming-card-charges', '6'], []);
  client.setQueryData(['agent-activity', '6'], [
    {
      source_message_id: 'app:prev-1', executed_at: at(12, 44), channel: 'whatsapp', input_kind: 'audio',
      origin_text: 'gastei 45 no almoço do Rangão', session_id: null, action_index: 0,
      action_type: 'create_expense', result_id: 'prev-tx',
      record: { kind: 'transaction', id: 'prev-tx', title: 'Almoço', amount_cents: 4500, tx_kind: 'expense', category: 'alimentação' },
    },
  ]);
```
(conferir a forma de `useSpendable`: a query guarda a LINHA, não o array — por isso o `[0]`; e ajustar `upcoming-bills` se a chave tiver mudado.)

- [ ] **Step 2: "Como ficou"** — acrescentar ao fim da spec uma seção `## Como ficou` (com a data do dia da execução) com o que mudou na execução em relação ao desenho (ex.: tamanho de fonte trocado depois da régua 1,3; qualquer destino que precisou de ajuste), medido nos aparelhos.

- [ ] **Step 3: CLAUDE.md** — na tabela "Stack", linha "Design", acrescentar ao fim: "; raízes em **conversa organizada** (balão com o texto real → registro; kit `BlockHeader`/`Tile`/`RingGauge`/`ScrubChart`/`DonutChart`), spec de 17/09/2026".

- [ ] **Step 4: Capturas finais** — em `.impeccable/review/` (criar a pasta): `phone-ios.png`, `phone-ios-dark.png`, `phone-android.png`, `phone-android-dark.png`, `phone-android-384x13.png` da Hoje e as mesmas da Financeiro (sufixo `-financeiro`). Conferir cada arquivo antes de seguir (sem quadro preto, sem estado carregando, entrada assentada).

- [ ] **Step 5: Revisão final (impeccable)** — rodar o revisor de acabamento da skill com: pedido original, respostas confirmadas, caminhos das duas telas, capturas, o contrato de direção da spec, `reference/craft-floor.md`, `reference/ios.md` e `reference/android.md`, e a linha "plataforma nativa: nenhum detector rodou". Aplicar o que ele marcar em UM lote, recapturar, pedir o veredito. Duas rodadas no máximo; o que sobrar vai para o Gabriel decidir.

- [ ] **Step 6: DESIGN.md** — rodar o documentador da skill (projeto, telas, contrato, `PRODUCT.md`, `reference/document.md`) para registrar o mundo como ficou construído.

- [ ] **Step 7: Portão e commit**

```bash
npx tsc --noEmit && npx expo lint && npm test
cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q && cd ..
git add src/app/design-preview.tsx docs/superpowers/specs/2026-09-17-hoje-financeiro-conversa-design.md DESIGN.md CLAUDE.md
git commit -m "docs(design): como ficou a conversa organizada nas raízes"
```

- [ ] **Step 8: Relatório ao Gabriel** — o que foi entregue por fase, o que foi verificado em cada aparelho, e as pendências dele: a `20260917120000` e a `20260918120000` em produção, e o deploy do agente em produção, que só pode acontecer DEPOIS da `20260918120000` (agente novo em banco antigo quebra toda escrita), e a tag da 1.3.36 (build nativo). Sem tag e sem push.
