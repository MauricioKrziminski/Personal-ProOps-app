/**
 * RRULE → português. As séries são criadas pela IA a partir de frases como
 * "todo dia 5" (supabase/functions/_shared/gemini.ts), então aqui é o caminho de
 * volta: mostrar a regra do jeito que o usuário falou, não `FREQ=MONTHLY;BYMONTHDAY=5`.
 *
 * Puro de propósito — coberto por src/lib/rrule-text.test.ts.
 */

const WEEKDAYS: Record<string, string> = {
  MO: 'segunda',
  TU: 'terça',
  WE: 'quarta',
  TH: 'quinta',
  FR: 'sexta',
  SA: 'sábado',
  SU: 'domingo',
};

const EVERY: Record<string, string> = {
  DAILY: 'todo dia',
  WEEKLY: 'toda semana',
  MONTHLY: 'todo mês',
  YEARLY: 'todo ano',
};

const UNIT: Record<string, string> = {
  DAILY: 'dias',
  WEEKLY: 'semanas',
  MONTHLY: 'meses',
  YEARLY: 'anos',
};

function parse(rrule: string): Record<string, string> {
  const clean = rrule.trim().replace(/^RRULE:/i, '');
  const parts: Record<string, string> = {};
  for (const chunk of clean.split(';')) {
    const [key, value] = chunk.split('=');
    if (key && value) parts[key.trim().toUpperCase()] = value.trim().toUpperCase();
  }
  return parts;
}

/** Lista em português: ["a"] -> "a", ["a","b"] -> "a e b", ["a","b","c"] -> "a, b e c". */
function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/**
 * Descrição curta e minúscula, para caber num card.
 * Regra que não souber interpretar volta como veio — melhor mostrar o RRULE cru
 * do que mentir sobre quando o lançamento cai.
 */
export function describeRRule(rrule: string | null): string {
  if (!rrule?.trim()) return 'sem recorrência';

  const parts = parse(rrule);
  const freq = parts.FREQ;
  if (!freq || !EVERY[freq]) return rrule.trim();

  const interval = Number(parts.INTERVAL ?? '1');
  const base = interval > 1 ? `a cada ${interval} ${UNIT[freq]}` : EVERY[freq];

  if (freq === 'WEEKLY' && parts.BYDAY) {
    const days = parts.BYDAY.split(',')
      .map((d) => WEEKDAYS[d.replace(/^[+-]?\d/, '')])
      .filter(Boolean);
    if (days.length) {
      if (interval > 1) return `${base}, ${joinPt(days)}`;
      // concordância: "toda segunda" (feira, feminino) mas "todo sábado"/"todo domingo"
      const first = parts.BYDAY.split(',')[0].replace(/^[+-]?\d/, '');
      const article = first === 'SA' || first === 'SU' ? 'todo' : 'toda';
      return `${article} ${joinPt(days)}`;
    }
  }

  if (freq === 'MONTHLY' && parts.BYMONTHDAY) {
    const days = parts.BYMONTHDAY.split(',').filter(Boolean);
    if (days.length) {
      return interval > 1 ? `${base}, no dia ${joinPt(days)}` : `todo dia ${joinPt(days)}`;
    }
  }

  return base;
}
