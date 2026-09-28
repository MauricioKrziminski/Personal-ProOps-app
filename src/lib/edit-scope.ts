import { showItemActions } from './item-actions';
import { editScopeChoices, type EditScope, type EditScopeKind } from './edit-scope-model';

/** A escolha acontece no Salvar; cancelar não chama nenhuma mutação. */
export function askEditScope(
  kind: EditScopeKind,
  onSelect: (scope: EditScope) => void,
  message?: string,
) {
  showItemActions(
    'Salvar alterações em',
    editScopeChoices(kind).map(({ scope, label }) => ({ label, onPress: () => onSelect(scope) })),
    message,
  );
}
