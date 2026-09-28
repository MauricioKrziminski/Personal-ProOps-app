import { showItemActions } from './item-actions';
import { editScopeChoices, type EditScope, type EditScopeKind } from './edit-scope-model';

/**
 * A escolha acontece no Salvar; cancelar não chama nenhuma mutação. `contrato`: a pessoa editou a
 * série/contrato, não uma ocorrência — sem "Só esta" (`edit-scope-model.ts`).
 */
export function askEditScope(
  kind: EditScopeKind,
  onSelect: (scope: EditScope) => void,
  message?: string,
  opcoes?: { contrato?: boolean },
) {
  showItemActions(
    'Salvar alterações em',
    editScopeChoices(kind, opcoes).map(({ scope, label }) => ({ label, onPress: () => onSelect(scope) })),
    message,
  );
}
