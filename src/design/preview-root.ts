const ROOTS = {
  today: 'Hoje',
  notes: 'Notas',
  finance: 'Finanças',
  agent: 'Agente',
  profile: 'Perfil',
} as const;

/** Allows stable visual QA URLs without changing the preview's normal step sequence. */
export function previewRootFromParam(value: unknown): (typeof ROOTS)[keyof typeof ROOTS] | null {
  return typeof value === 'string' && Object.hasOwn(ROOTS, value)
    ? ROOTS[value as keyof typeof ROOTS]
    : null;
}
