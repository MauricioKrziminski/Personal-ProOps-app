/**
 * Acumulação e renda futura (F20): cálculo de cenário, não grava nada. Dinheiro em centavos
 * inteiros nas bordas; dentro da conta, float (arredonda só na SAÍDA).
 */
export type Premissas = {
  inicialCents: number;
  aporteCents: number;
  anos: number;
  meses: number;
  /** Taxa em %, ao ano ou ao mês conforme `porMes`. */
  taxa: number;
  porMes: boolean;
  /** Aporte no início do mês (senão, no fim). */
  inicio: boolean;
  /** Inflação % ao ano; 0 = sem inflação. */
  inflacao: number;
  rendaCents: number;
  /** Taxa de retirada % ao ano. */
  retirada: number;
};

export const MAX_MESES = 1200;
export const TETO_CENTS = 1e11; // R$ 1 bilhão

/** Taxa anual → mensal EQUIVALENTE, nunca a/12. */
export const mensalDeAnual = (anualPct: number) => Math.pow(1 + anualPct / 100, 1 / 12) - 1;
export const anualDeMensal = (mensalPct: number) => (Math.pow(1 + mensalPct / 100, 12) - 1) * 100;

export function taxaMensal(p: Pick<Premissas, 'taxa' | 'porMes'>): number {
  return p.porMes ? p.taxa / 100 : mensalDeAnual(p.taxa);
}

/** "8,5" ou "8.5" → 8.5; vazio ou lixo → NaN (a validação explica). */
export function lerPercentual(texto: string): number {
  const t = texto.trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export const prazoEmMeses = (p: Pick<Premissas, 'anos' | 'meses'>) => p.anos * 12 + p.meses;

/** Mensagem do campo fora do domínio, ou null. Fora dele o cálculo não roda. */
export function validar(p: Premissas): string | null {
  const dinheiro = [p.inicialCents, p.aporteCents, p.rendaCents];
  if (dinheiro.some((c) => !Number.isFinite(c) || c < 0 || c > TETO_CENTS)) return 'Valores de 0 até R$ 1 bilhão.';
  const n = prazoEmMeses(p);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MESES) return 'O prazo vai de 1 mês a 100 anos.';
  if (!Number.isFinite(p.taxa)) return 'Use um número na taxa, como 8,5.';
  const anual = p.porMes ? anualDeMensal(p.taxa) : p.taxa;
  if (p.taxa <= -100 || anual < -50 - 1e-9 || anual > 100 + 1e-9) return 'A taxa vai de −50% a +100% ao ano.';
  if (!Number.isFinite(p.inflacao) || p.inflacao < 0 || p.inflacao > 50) return 'A inflação vai de 0% a 50% ao ano.';
  if (!Number.isFinite(p.retirada) || p.retirada < 0.1 || p.retirada > 20) return 'A retirada vai de 0,1% a 20% ao ano.';
  return null;
}

/** Valor (centavos, float) ao fim do mês k: VF = P·(1+i)^k + A·((1+i)^k − 1)/i · (1+i)^[início]. */
export function valorNoMes(p: Premissas, k: number): number {
  const i = taxaMensal(p);
  const P = p.inicialCents;
  const A = p.aporteCents;
  if (i === 0) return P + A * k;
  const f = Math.pow(1 + i, k);
  return P * f + A * ((f - 1) / i) * (p.inicio ? 1 + i : 1);
}

export const deflator = (p: Premissas, k: number) => Math.pow(1 + mensalDeAnual(p.inflacao), k);

/** Capital que rende a renda desejada (dinheiro de hoje): 12 × renda ÷ retirada. */
export const capitalNecessario = (p: Premissas) =>
  Math.round((12 * p.rendaCents) / (p.retirada / 100));

export type Resultado = {
  /** Um ponto por mês, de 0 a n, em centavos nominais. O último é o valor do fim. */
  curva: number[];
  fimCents: number;
  /** Em dinheiro de hoje (igual ao nominal sem inflação). */
  fimRealCents: number;
  aportadoCents: number;
  rendimentoCents: number;
  capitalCents: number;
  /** Primeiro mês (0..1200) em que o valor real ≥ capital; null = não atinge em 100 anos. */
  atingeMes: number | null;
  perdeParaInflacao: boolean;
};

export function simular(p: Premissas): Resultado {
  const n = prazoEmMeses(p);
  const curva = Array.from({ length: n + 1 }, (_, k) => Math.round(valorNoMes(p, k)));
  const fimCents = curva[n];
  const fimRealCents = Math.round(valorNoMes(p, n) / deflator(p, n));
  const aportadoCents = p.inicialCents + p.aporteCents * n;
  const capitalCents = capitalNecessario(p);
  let atingeMes: number | null = null;
  for (let k = 0; k <= MAX_MESES; k++) {
    if (valorNoMes(p, k) / deflator(p, k) >= capitalCents) {
      atingeMes = k;
      break;
    }
  }
  return {
    curva,
    fimCents,
    fimRealCents,
    aportadoCents,
    rendimentoCents: fimCents - aportadoCents,
    capitalCents,
    atingeMes,
    perdeParaInflacao: p.inflacao > 0 && fimRealCents < aportadoCents,
  };
}

/** "atinge em 3 anos e 2 meses", "já atinge" ou "não atinge em até 100 anos". */
export function quandoAtinge(mes: number | null): string {
  if (mes === null) return 'não atinge em até 100 anos';
  if (mes === 0) return 'já atinge';
  const a = Math.floor(mes / 12);
  const m = mes % 12;
  const anos = a ? `${a} ${a === 1 ? 'ano' : 'anos'}` : '';
  const meses = m ? `${m} ${m === 1 ? 'mês' : 'meses'}` : '';
  return `atinge em ${[anos, meses].filter(Boolean).join(' e ')}`;
}

/** Premissas como ficam gravadas: percentuais em texto, para a digitação não ser reescrita. */
export type Cenario = Omit<Premissas, 'taxa' | 'inflacao' | 'retirada'> & {
  taxa: string;
  inflacao: string;
  retirada: string;
};

export const CENARIO_PADRAO: Cenario = {
  inicialCents: 0,
  aporteCents: 0,
  anos: 10,
  meses: 0,
  taxa: '8',
  porMes: false,
  inicio: false,
  inflacao: '0',
  rendaCents: 0,
  retirada: '4',
};

export const paraPremissas = (c: Cenario): Premissas => ({
  ...c,
  taxa: lerPercentual(c.taxa),
  inflacao: lerPercentual(c.inflacao),
  retirada: lerPercentual(c.retirada),
});

/** Lê o JSON gravado; o que não for uma lista de 1 a 3 cenários completos cai no padrão. */
export function lerCenarios(json: string): Cenario[] {
  try {
    const lista: unknown = JSON.parse(json);
    if (Array.isArray(lista) && lista.length >= 1 && lista.length <= 3) {
      const modelo = CENARIO_PADRAO as Record<string, unknown>;
      const ok = lista.every(
        (c) => c && typeof c === 'object' && Object.keys(modelo).every((k) => typeof c[k] === typeof modelo[k]),
      );
      if (ok) return lista as Cenario[];
    }
  } catch {
    // disco corrompido: padrão
  }
  return [CENARIO_PADRAO];
}
