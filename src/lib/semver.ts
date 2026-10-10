/** `MAJOR.MINOR.PATCH` → números; qualquer outra coisa é `null` (comparar com `null` nunca bloqueia). */
export function lerVersao(v: string | null | undefined): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0 ou 1; `null` se alguma das duas não for versão válida. */
export function compararVersoes(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const x = lerVersao(a);
  const y = lerVersao(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** `atual` é MENOR que `minima`? Versão ausente ou ilegível não conta (falha aberto). */
export function abaixoDe(atual: string | null | undefined, minima: string | null | undefined): boolean {
  return compararVersoes(atual, minima) === -1;
}
