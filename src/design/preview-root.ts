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

/** A pushed route uses its own native header and never inherits tab chrome in visual QA. */
export function previewScreenFromParam(value: unknown) {
  return previewRootFromParam(value) ?? (
    value === 'invoice' ? 'Fatura' :
    value === 'forecast' ? 'Projeção' :
    value === 'net-worth' ? 'Patrimônio' :
    value === 'cycle' ? 'Ciclo' :
    value === 'reports' ? 'Relatórios' : null
  );
}
