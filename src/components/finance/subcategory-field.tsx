import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Presenca, usePresencaAtiva } from '@/components/motion/presenca';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Row } from '@/components/ui/row';
import { SearchField } from '@/components/ui/search-field';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { VerMais } from '@/components/ui/ver-mais';
import { Space } from '@/design/tokens';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { useSubcategories, useWriteSubcategory } from '@/hooks/use-subcategories';
import { foldCategory } from '@/lib/categories-merge';
import { subcategoryWriteError } from '@/lib/subcategory-save';
import { subcategoryWriteInput } from '@/lib/subcategories';

/** Optional detail, inline even when the enclosing form already lives in a Sheet. */
export function SubcategoryField({ parent, value, onChange, workspaceId, sessionKey = '', enabled = true }: {
  parent: string | null; value: string | null; onChange: (id: string | null) => void;
  workspaceId?: string; sessionKey?: string; enabled?: boolean;
}) {
  const active = usePresencaAtiva() && enabled;
  const query = useSubcategories(workspaceId, active && Boolean(parent?.trim()));
  const write = useWriteSubcategory();
  const scopeKey = JSON.stringify([sessionKey, workspaceId ?? 'default', foldCategory(parent ?? '')]);
  const [session, setSession] = useState({ key: scopeKey, expanded: false, creating: false, name: '', search: '', error: '' });
  const [presence, setPresence] = useState({ active, visit: 0 });
  if (presence.active !== active) setPresence({ active, visit: presence.visit + Number(active) });
  const owner = JSON.stringify([scopeKey, presence.visit]);
  const visit = useRef(0);
  const live = useRef(false);
  const liveOwner = useRef('');
  const attemptOwner = useRef<string | null>(null);
  if (session.key !== scopeKey) setSession({ key: scopeKey, expanded: false, creating: false, name: '', search: '', error: '' });
  useLayoutEffect(() => {
    live.current = active; liveOwner.current = owner; visit.current += 1;
    return () => { live.current = false; visit.current += 1; };
  }, [owner, active]);
  const state = !query.isError ? query.data : undefined;
  const children = state?.items.filter(item => foldCategory(item.parent_category) === foldCategory(parent ?? '')) ?? [];
  const selected = children.find(item => item.id === value);
  const searching = foldCategory(session.search);
  const filtered = children.filter(item => foldCategory(item.name).includes(searching));
  const list = useAosPoucos(filtered, scopeKey + searching);
  const options: SelectOption[] = [{ id: null, label: 'Sem detalhe', neutral: true },
    ...list.visiveis.map(item => ({ id: item.id, label: item.name }))];
  const pending = write.isPending || write.unconfirmedInput !== null;
  const update = (patch: Partial<typeof session>) => {
    if (live.current && liveOwner.current === owner) setSession(current => ({ ...current, ...patch }));
  };

  async function create(resolve = false) {
    if (!live.current || liveOwner.current !== owner || write.isPending) return;
    const epoch = visit.current;
    const owned = write.unconfirmedInput;
    const requestedParent = resolve && owned?.action === 'save' ? owned.parent_category : parent;
    const requestedWorkspace = resolve && owned ? owned.workspace_id : state?.workspace_id;
    if (!requestedWorkspace || !requestedParent) {
      update({ error: 'Confira a categoria e o espaço antes de criar o detalhe.' });
      return;
    }
    try {
      update({ error: '' });
      if (!resolve && !owned) attemptOwner.current = owner;
      const result = resolve ? await write.resolveAsync() : await write.mutateAsync(subcategoryWriteInput({
        action: 'save', workspace_id: requestedWorkspace, subcategory_id: null, expected_revision: null,
        parent_category: requestedParent, name: session.name, merge_into_id: null, expected_merge_revision: null,
      }));
      // A committed catalog item may outlive this form. A late response cannot select
      // it into another parent, workspace, record or presence visit.
      if (!live.current || visit.current !== epoch) return;
      if (attemptOwner.current === owner && foldCategory(requestedParent) === foldCategory(parent ?? '') && requestedWorkspace === state?.workspace_id) {
        onChange(result.subcategory_id);
      }
      update({ creating: false, name: '', error: '' });
    } catch (error) {
      if (live.current && visit.current === epoch) update({ error: subcategoryWriteError(error) });
    }
  }

  if (!parent?.trim()) return null;
  const referenceError = value !== null && !selected && !query.isLoading
    ? 'Este detalhe mudou. Confira as opções ou escolha Sem detalhe.' : '';
  return (
    <View>
      <View style={styles.row}>
        <Row title="Detalhe" subtitle={selected?.name ?? (value === null ? 'Sem detalhe' : 'Conferir detalhe')}
          chevron={false} trailing={<Icon name={session.expanded ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
          accessibilityState={{ expanded: session.expanded, disabled: !active }}
          onPress={() => { if (live.current && liveOwner.current === owner) update({ expanded: !session.expanded }); }} />
      </View>
      <Presenca visivel={session.expanded} imediata style={styles.fields}>
        <Field label={`Detalhe de ${parent}`} error={session.error || (query.isError ? 'Não consegui consultar os detalhes. Tente novamente.' : referenceError)}>
          {children.length > 8 ? <SearchField value={session.search} onChangeText={search => update({ search })}
            placeholder="Buscar detalhe" accessibilityLabel="Buscar detalhe" /> : null}
          <SelectField value={value} options={options} selectedOption={selected ? { id: selected.id, label: selected.name } : null}
            disabled={!active || query.isLoading || query.isError || pending}
            placeholder={query.isLoading ? 'Consultando detalhes…' : 'Sem detalhe'}
            onChange={id => { if (live.current && liveOwner.current === owner) onChange(id); }}
            actions={[{ id: 'create', label: 'Criar detalhe', icon: 'plus', disabled: pending || !state,
              onPress: () => update({ creating: true, name: '', error: '' }) }]} />
          <VerMais restantes={list.restantes} onPress={list.verMais} />
        </Field>
        {query.isError ? <Button label="Tentar novamente" variant="secondary" size="sm" onPress={() => { void query.refetch(); }} /> : null}
        <Presenca visivel={session.creating} imediata style={styles.fields}>
          <Field label="Nome do detalhe" hint="Um nome curto que ajude a entender este gasto ou receita.">
            <TextField value={session.name} onChangeText={name => update({ name })}
              accessibilityLabel="Nome do detalhe" placeholder="Ex.: mercado, delivery, consultas" editable={!pending} />
          </Field>
          <View style={styles.actions}>
            <Button label="Cancelar criação" variant="ghost" size="sm" disabled={pending} onPress={() => {
              visit.current += 1; update({ creating: false, name: '', error: '' });
            }} />
            <Button label="Criar detalhe" size="sm" loading={write.isPending} disabled={!session.name.trim() || Boolean(write.unconfirmedInput)} onPress={() => { void create(); }} />
          </View>
        </Presenca>
        {write.unconfirmedInput && !write.isPending ? <Button label="Conferir criação" variant="secondary" size="sm"
          onPress={() => { void create(true); }} /> : null}
      </Presenca>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { marginHorizontal: -Space.lg },
  fields: { gap: Space.md, paddingTop: Space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, justifyContent: 'flex-end' },
});
