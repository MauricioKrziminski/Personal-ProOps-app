/**
 * F14 — planejamento por percentual da renda. Puro: texto pt-BR ↔ pontos-base, validação que
 * explica ANTES de mandar, rascunho ↔ comando, e a leitura do que o banco devolve. A regra de
 * verdade mora no banco (`budget_plan_*`); a tela mostra os reais que ELE calcula. `allocate` é a
 * mesma aritmética do servidor só para provar a equivalência em teste.
 *
 * Percentual é inteiro em pontos-base (1% = 100): 12,5% = 1250. Dinheiro é `amount_cents` inteiro.
 */
export interface PlanLineDraft { key: string; category: string | null; pct: string }
export interface PlanGroupDraft { key: string; name: string; lines: PlanLineDraft[] }
export interface PlanDraft { baseCents: number; groups: PlanGroupDraft[] }

export interface PlanInput { base_income_cents: string; lines: { group: string; category: string | null; share_bp: number }[] }

export interface PreviewLine { position: number; group: string; category: string | null; share_bp: number; amount_cents: number }
export interface PlanPreview {
  ok: boolean; errors: { code: string; position: number | null; message: string }[];
  lines: PreviewLine[]; total_bp: number; total_cents: number; undistributed_bp: number; undistributed_cents: number;
}
export interface PlanStateLine extends PreviewLine {
  current_default_cents: number | null; current_month_cents: number | null; spent_cents: number | null;
}
export interface PlanState {
  revision: number; month: string; period_start: string; period_end: string; income_cents: number; income_unsettled_cents: number;
  plan: null | {
    version: number; base_income_cents: number; lines: PlanStateLine[];
    total_bp: number; total_cents: number; undistributed_bp: number; undistributed_cents: number;
  };
  applications: { plan_version: number; category: string; scope: 'default' | 'month'; month: string | null;
    before_cents: number | null; applied_cents: number; created_at: string }[];
}

/** Sem acento e sem caixa, a régua de `categories.ts`. */
export function foldPlanText(s: string): string {
  return s.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** "12,5%" → 1250. Vírgula (ou ponto), até duas casas, 0 a 100; vazio ou inválido → null. */
export function parseBp(text: string): number | null {
  const t = text.replace('%', '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.split('.');
  const bp = Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
  return bp <= 10000 ? bp : null;
}

/** 1250 → "12,5" · 10001 → "100,01" (vírgula, nunca ponto). */
export function formatBp(bp: number): string {
  const frac = bp % 100;
  const resto = frac === 0 ? '' : `,${String(frac).padStart(2, '0').replace(/0$/, '')}`;
  return `${Math.trunc(bp / 100)}${resto}`;
}

/**
 * Reais de cada linha: `floor(base × bp / 10000)`; os centavos que sobram vão, um por vez, às
 * linhas de maior resto (empate: a primeira). Com 100% a soma é EXATAMENTE a renda.
 */
export function allocate(baseCents: number, bps: readonly number[]) {
  const base = BigInt(baseCents);
  const prod = bps.map((bp) => base * BigInt(bp));
  const piso = prod.map((p) => p / 10000n);
  const totalBp = bps.reduce((s, b) => s + b, 0);
  let sobra = (base * BigInt(totalBp)) / 10000n - piso.reduce((s, v) => s + v, 0n);
  const ordem = bps.map((_, i) => i).sort((a, b) => {
    const ra = prod[a] % 10000n;
    const rb = prod[b] % 10000n;
    return ra === rb ? a - b : ra > rb ? -1 : 1;
  });
  const amounts = piso.map((v) => v);
  for (const i of ordem) {
    if (sobra <= 0n) break;
    amounts[i] += 1n;
    sobra -= 1n;
  }
  const totalCents = amounts.reduce((s, v) => s + v, 0n);
  return {
    amounts: amounts.map(Number), totalBp, totalCents: Number(totalCents),
    undistributedBp: 10000 - totalBp, undistributedCents: Number(base - totalCents),
  };
}

let chave = 0;
export const novaChave = () => `k${++chave}`;
export const novaLinha = (category: string | null = null, pct = ''): PlanLineDraft => ({ key: novaChave(), category, pct });
export const novoGrupo = (name = ''): PlanGroupDraft => ({ key: novaChave(), name, lines: [novaLinha()] });

/** O ponto de partida: três grupos que a pessoa troca ou apaga. */
export const planoInicial = (baseCents = 0): PlanDraft => ({
  // chaves fixas: o rascunho ainda não editado é recalculado a cada render e não pode remontar os campos
  baseCents, groups: ['Essenciais', 'Estilo de vida', 'Futuro'].map((name, i) => ({ key: `g${i}`, name, lines: [{ key: `g${i}l0`, category: null, pct: '' }] })),
});

/** A versão atual do plano vira rascunho editável (grupos na ordem em que aparecem). */
export function draftFromPlan(plan: NonNullable<PlanState['plan']>): PlanDraft {
  const groups: PlanGroupDraft[] = [];
  for (const l of plan.lines) {
    let g = groups.find((x) => x.name === l.group);
    if (!g) { g = { key: `g${groups.length}`, name: l.group, lines: [] }; groups.push(g); }
    g.lines.push({ key: `p${l.position}`, category: l.category, pct: formatBp(l.share_bp) });
  }
  return { baseCents: plan.base_income_cents, groups };
}

export const MAX_LINHAS = 60;

/** Por que o rascunho ainda não vai para o banco — a primeira razão, em frase; `null` = pronto. */
export function motivoDoPlano(draft: PlanDraft): string | null {
  if (draft.baseCents <= 0) return 'Informe uma renda-base maior que zero.';
  const linhas = draft.groups.flatMap((g) => g.lines.map((l) => ({ g, l })));
  if (linhas.length === 0) return 'Adicione ao menos uma linha ao plano.';
  if (linhas.length > MAX_LINHAS) return 'O plano aceita até 60 linhas.';
  const sem = draft.groups.find((g) => g.name.trim() === '');
  if (sem) return 'Dê um nome ao grupo.';
  const nomes = new Map<string, string>();
  for (const g of draft.groups) {
    const f = foldPlanText(g.name);
    if (nomes.has(f)) return `Dois grupos com o nome ${nomes.get(f)}: use um só.`;
    nomes.set(f, g.name.trim());
  }
  const vistas = new Set<string>();
  let total = 0;
  for (const { g, l } of linhas) {
    const bp = parseBp(l.pct);
    if (bp === null) return `Informe o percentual de ${l.category ?? `uma linha de ${g.name.trim()}`} (0 a 100%).`;
    total += bp;
    if (l.category) {
      const f = foldPlanText(l.category);
      if (vistas.has(f)) return `A categoria ${l.category} aparece em mais de uma linha.`;
      vistas.add(f);
    }
  }
  if (total > 10000) return `A soma dos percentuais é ${formatBp(total)}%: passa de 100%.`;
  return null;
}

/** O comando/prévia a partir do rascunho (só chamar com `motivoDoPlano` nulo). */
export function toInput(draft: PlanDraft): PlanInput {
  return {
    base_income_cents: String(draft.baseCents),
    lines: draft.groups.flatMap((g) => g.lines.map((l) => ({
      group: g.name.trim(), category: l.category ? l.category.trim().toLowerCase() : null, share_bp: parseBp(l.pct) ?? 0,
    }))),
  };
}

const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function decodePreview(raw: any): PlanPreview {
  return {
    ok: Boolean(raw.ok), errors: raw.errors ?? [],
    lines: (raw.lines ?? []).map((l: any) => ({ ...l, amount_cents: n(l.amount_cents) })),
    total_bp: n(raw.total_bp), total_cents: n(raw.total_cents),
    undistributed_bp: n(raw.undistributed_bp), undistributed_cents: n(raw.undistributed_cents),
  };
}

export function decodePlanState(raw: any): PlanState {
  const p = raw.plan;
  return {
    revision: n(raw.revision), month: raw.month, period_start: raw.period_start, period_end: raw.period_end,
    income_cents: n(raw.income_cents), income_unsettled_cents: n(raw.income_unsettled_cents ?? 0),
    plan: p ? {
      version: n(p.version), base_income_cents: n(p.base_income_cents), total_bp: n(p.total_bp), total_cents: n(p.total_cents),
      undistributed_bp: n(p.undistributed_bp), undistributed_cents: n(p.undistributed_cents),
      lines: p.lines.map((l: any) => ({
        ...l, amount_cents: n(l.amount_cents), current_default_cents: nn(l.current_default_cents),
        current_month_cents: nn(l.current_month_cents), spent_cents: nn(l.spent_cents),
      })),
    } : null,
    applications: (raw.applications ?? []).map((a: any) => ({ ...a, before_cents: nn(a.before_cents), applied_cents: n(a.applied_cents) })),
  };
}

export type ApplyScope = 'default' | 'month';
export interface ApplyRow { category: string; before: number | null; after: number; conflict: boolean; doPadrao?: boolean }

/** A confirmação: cada categoria afetada com antes → depois; conflito = já havia outro limite valendo.
 *  Só o mês sem limite do mês: o que vale ali é o padrão (`doPadrao`), não "sem limite". */
export function applyRows(plan: NonNullable<PlanState['plan']>, categories: readonly string[], scope: ApplyScope): ApplyRow[] {
  return plan.lines
    .filter((l) => l.category && categories.includes(l.category))
    .map((l) => {
      const doPadrao = scope === 'month' && l.current_month_cents === null && l.current_default_cents !== null;
      const before = scope === 'default' ? l.current_default_cents : l.current_month_cents ?? l.current_default_cents;
      const row: ApplyRow = { category: l.category!, before, after: l.amount_cents, conflict: before !== null && before !== l.amount_cents };
      return doPadrao ? { ...row, doPadrao } : row;
    });
}

/** % da renda que entrou: `null` sem renda no período (a tela diz "sem renda lançada"). */
export function realizedBp(spentCents: number, incomeCents: number): number | null {
  return incomeCents > 0 ? Math.round((spentCents * 10000) / incomeCents) : null;
}
