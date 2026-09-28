export type EditScope = 'one' | 'future' | 'all';
export type EditScopeKind = 'occurrence' | 'installment' | 'payment' | 'reminder';

const LABELS: Record<EditScopeKind, readonly [string, string, string]> = {
  occurrence: ['Só esta ocorrência', 'Esta e as próximas', 'Todas, inclusive passadas'],
  installment: ['Só esta parcela', 'Esta e as próximas', 'Todas, inclusive parcelas passadas'],
  payment: ['Só este pagamento', 'Este e os próximos', 'Todos, inclusive pagamentos passados'],
  reminder: ['Só esta ocorrência', 'Esta e as próximas', 'Todas, inclusive passadas'],
};

/**
 * Editando o CONTRATO (a ficha da dívida, a série em Recorrentes, a compra em Parceladas, o
 * lembrete na lista) não há "esta": a pessoa não abriu uma ocorrência (28/09/2026, *"faz sentido
 * ele ter as 3 perguntas já que eu não estou dentro de uma parcela em específico?"*). Ficam duas.
 */
const CONTRATO: Record<EditScopeKind, readonly [string, string]> = {
  occurrence: ['Das próximas em diante', 'Todas, inclusive passadas'],
  installment: ['Das próximas parcelas em diante', 'Todas, inclusive parcelas passadas'],
  payment: ['Dos próximos pagamentos em diante', 'Todos, inclusive pagamentos passados'],
  reminder: ['Das próximas em diante', 'Todas, inclusive passadas'],
};

/** Uma ordem e um vocabulário para toda edição de algo que se repete. */
export function editScopeChoices(
  kind: EditScopeKind, { contrato = false }: { contrato?: boolean } = {},
): readonly { scope: EditScope; label: string }[] {
  if (contrato) {
    const [future, all] = CONTRATO[kind];
    return [{ scope: 'future', label: future }, { scope: 'all', label: all }];
  }
  const [one, future, all] = LABELS[kind];
  return [
    { scope: 'one', label: one },
    { scope: 'future', label: future },
    { scope: 'all', label: all },
  ];
}
