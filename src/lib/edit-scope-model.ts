export type EditScope = 'one' | 'future' | 'all';
export type EditScopeKind = 'occurrence' | 'installment' | 'payment' | 'reminder';

const LABELS: Record<EditScopeKind, readonly [string, string, string]> = {
  occurrence: ['Só esta ocorrência', 'Esta e as próximas', 'Todas, inclusive passadas'],
  installment: ['Só esta parcela', 'Esta e as próximas', 'Todas, inclusive parcelas passadas'],
  payment: ['Só este pagamento', 'Este e os próximos', 'Todos, inclusive pagamentos passados'],
  reminder: ['Só esta ocorrência', 'Esta e as próximas', 'Todas, inclusive passadas'],
};

/** Uma ordem e um vocabulário para toda edição de algo que se repete. */
export function editScopeChoices(kind: EditScopeKind): readonly { scope: EditScope; label: string }[] {
  const [one, future, all] = LABELS[kind];
  return [
    { scope: 'one', label: one },
    { scope: 'future', label: future },
    { scope: 'all', label: all },
  ];
}
