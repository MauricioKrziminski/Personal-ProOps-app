import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Presenca } from '@/components/motion/presenca';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Row, Section } from '@/components/ui/row';
import { SearchField } from '@/components/ui/search-field';
import { SelectField } from '@/components/ui/select-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Space } from '@/design/tokens';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { useCategoriesUsed } from '@/hooks/use-finance';
import { useSubcategories, useWriteSubcategory } from '@/hooks/use-subcategories';
import { foldCategory } from '@/lib/categories-merge';
import { confirmDestructive } from '@/lib/item-actions';
import { SubcategoryAttemptCancelledError, subcategoryWriteError } from '@/lib/subcategory-save';
import { subcategoryWriteInput, type Subcategory, type SubcategoryWriteInput } from '@/lib/subcategories';

type Draft = { visit: number; scope: string; workspace: string; snapshot: Subcategory | null; name: string; parent: string; newParent: boolean };

/** The editor and command controller remain above the Sheet's adaptive presentation. */
export function SubcategoryManager({ visible, parent, workspaceId, onClose }: {
  visible: boolean; parent: string; workspaceId?: string; onClose: () => void;
}) {
  const query = useSubcategories(workspaceId, visible);
  const categories = useCategoriesUsed();
  const write = useWriteSubcategory();
  const catalog = !query.isError && !query.isPending && query.data
    && (!workspaceId || query.data.workspace_id === workspaceId.toLowerCase()) ? query.data : null;
  const scope = visible ? JSON.stringify([workspaceId ?? catalog?.workspace_id ?? 'default', foldCategory(parent)]) : '';
  const [session, setSession] = useState({ scope, visit: 1 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [issue, setIssue] = useState('');
  const attemptVisit = useRef<number | null>(null);
  const active = useRef({ visible, visit: session.visit, blocked: false, catalog, draft });
  const blocked = write.isPending || write.unconfirmedInput !== null;
  useLayoutEffect(() => {
    active.current = { visible, visit: session.visit, blocked, catalog, draft };
    return () => { active.current.visible = false; };
  }, [visible, session.visit, blocked, catalog, draft]);
  if (scope !== session.scope) {
    setSession({ scope, visit: session.visit + 1 });
    if (!blocked) { setDraft(null); setIssue(''); setSearch(''); }
  } else if (!blocked && draft && draft.scope !== scope) {
    setDraft(null); setIssue(''); setSearch('');
  }
  const visit = session.visit;
  const current = draft?.snapshot ? catalog?.items.find(item => item.id === draft.snapshot!.id) : null;
  const outdated = Boolean(draft?.snapshot && (!current || current.edit_revision !== draft.snapshot.edit_revision
    || current.name !== draft.snapshot.name || current.parent_category !== draft.snapshot.parent_category));
  const collision = draft && catalog?.items.find(item => item.id !== draft.snapshot?.id
    && foldCategory(item.parent_category) === foldCategory(draft.parent) && foldCategory(item.name) === foldCategory(draft.name));
  const matching = catalog?.items.filter(item => foldCategory(item.parent_category) === foldCategory(parent)
    && foldCategory(item.name).includes(foldCategory(search))) ?? [];
  const page = useAosPoucos(matching, `${scope}:${search}`);
  const parentNames = new Map<string, string>();
  for (const label of [parent, draft?.parent, ...(categories.data ?? []).map(item => item.category)]) {
    if (label?.trim()) parentNames.set(foldCategory(label), label);
  }
  const canEdit = !blocked && visible && !!catalog && !outdated && draft?.visit === visit;
  const validName = draft ? Array.from(draft.name.trim().toLowerCase()).length : 0;
  const validParent = draft ? Array.from(draft.parent.trim().toLowerCase()).length : 0;
  const valid = Boolean(canEdit && validName > 0 && validName <= 40 && validParent > 0 && validParent <= 40);
  const sameVisit = () => active.current.visible && active.current.visit === visit;
  const close = () => {
    if (active.current.blocked) { setIssue('Confira a tentativa antes de fechar ou ajustar o detalhe.'); return; }
    if (sameVisit()) onClose();
  };
  const open = (snapshot: Subcategory | null) => {
    if (!sameVisit() || active.current.blocked || !catalog) return;
    setIssue(''); setDraft({ visit, scope, workspace: catalog.workspace_id, snapshot: snapshot ? { ...snapshot } : null,
      name: snapshot?.name ?? '', parent: snapshot?.parent_category ?? parent, newParent: false });
  };
  const change = (patch: Partial<Draft>) => {
    if (!sameVisit() || active.current.blocked || !canEdit) return;
    setIssue(''); setDraft(previous => previous?.visit === visit ? { ...previous, ...patch } : previous);
  };
  const finished = (owner: number) => {
    if (active.current.visible && active.current.visit === owner) { setDraft(null); setIssue(''); }
    attemptVisit.current = null;
  };
  const failure = (error: unknown, owner: number) => {
    if (active.current.visit !== owner || !active.current.visible) return;
    if (error instanceof SubcategoryAttemptCancelledError) finished(owner);
    setIssue(subcategoryWriteError(error));
  };
  const execute = (input: SubcategoryWriteInput) => {
    if (!sameVisit() || active.current.blocked) return;
    const currentDraft = active.current.draft;
    if (!currentDraft || (currentDraft.snapshot?.id ?? null) !== input.subcategory_id
      || (input.action === 'save' && (currentDraft.name.trim().toLowerCase() !== input.name
        || currentDraft.parent.trim().toLowerCase() !== input.parent_category))) return;
    // Confirmation callbacks must still refer to the exact source/receiver revisions captured.
    const rows = active.current.catalog?.items;
    if (!rows || (input.subcategory_id && rows.find(item => item.id === input.subcategory_id)?.edit_revision !== input.expected_revision)
      || (input.action === 'save' && input.merge_into_id
        && rows.find(item => item.id === input.merge_into_id)?.edit_revision !== input.expected_merge_revision)) {
      setIssue('O detalhe mudou. Reabra para conferir antes de salvar.'); return;
    }
    active.current.blocked = true; attemptVisit.current = visit; setIssue('');
    void write.mutateAsync(input).then(() => finished(visit), error => failure(error, visit));
  };
  const save = () => {
    if (!valid || !draft || !sameVisit() || active.current.blocked) return;
    let input: SubcategoryWriteInput;
    try {
      input = subcategoryWriteInput({ action: 'save', workspace_id: draft.workspace,
        subcategory_id: draft.snapshot?.id ?? null, expected_revision: draft.snapshot?.edit_revision ?? null,
        name: draft.name, parent_category: draft.parent, merge_into_id: collision?.id ?? null,
        expected_merge_revision: collision?.edit_revision ?? null });
    } catch (error) { setIssue(subcategoryWriteError(error)); return; }
    if (collision) {
      confirmDestructive(`Juntar com ${collision.name}?`, 'Juntar detalhes', () => execute(input),
        `Os registros de ${draft.snapshot?.name ?? draft.name} passam para ${collision.name}, em ${collision.parent_category}. O detalhe receptor mantém seu nome. Isso atualiza históricos e leituras de orçamento, sem movimentar dinheiro.`);
    } else execute(input);
  };
  const remove = () => {
    if (!canEdit || !draft?.snapshot || !sameVisit()) return;
    const snapshot = draft.snapshot;
    const input: SubcategoryWriteInput = { action: 'delete', workspace_id: draft.workspace,
      subcategory_id: snapshot.id, expected_revision: snapshot.edit_revision };
    confirmDestructive(`Remover ${snapshot.name}?`, 'Remover detalhe', () => execute(input),
      `${snapshot.uses} registros passam a Sem detalhe. A categoria, os lançamentos e o histórico continuam. Nenhum dinheiro é movimentado.`);
  };
  const retry = (resolve = false) => {
    if (write.isPending || !write.unconfirmedInput) return;
    const owner = attemptVisit.current ?? visit;
    setIssue('');
    void (resolve ? write.resolveAsync() : write.mutateAsync(write.unconfirmedInput)).then(() => finished(owner), error => failure(error, owner));
  };
  const moving = draft?.snapshot && foldCategory(draft.parent) !== foldCategory(draft.snapshot.parent_category);
  return <Sheet visible={visible || blocked} onClose={close}>
    <TaskHeader title="Detalhes da categoria" subtitle={blocked ? 'Resposta ainda não confirmada' : parent} onClose={close} />
    <SheetScroll contentContainerStyle={styles.body}>
      {issue ? <ThemedText type="small" themeColor="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{issue}</ThemedText> : null}
      {write.unconfirmedInput ? <View style={styles.group}>
        <ThemedText type="small">Confira esta tentativa antes de ajustar ou fechar. Os mesmos valores serão mantidos.</ThemedText>
        <Button label="Tentar novamente" variant="secondary" disabled={write.isPending} loading={write.isPending} onPress={() => retry()} />
        <Button label="Conferir tentativa" variant="secondary" disabled={write.isPending} onPress={() => retry(true)} />
      </View> : null}
      {query.isPending ? <ThemedText type="small" themeColor="textSecondary">Carregando detalhes…</ThemedText> : null}
      {query.isError || (!query.isPending && !catalog) ? <View style={styles.group}>
        <ThemedText type="small" themeColor="danger">Não consegui conferir os detalhes deste espaço.</ThemedText>
        <Button label="Tentar carregar" variant="secondary" onPress={() => { void query.refetch(); }} />
      </View> : null}
      {catalog && !draft ? <>
        <SearchField value={search} onChangeText={value => { if (sameVisit()) setSearch(value); }} placeholder="Buscar detalhe" />
        {page.visiveis.length ? <Section>{page.visiveis.map(item => <Row key={item.id} title={item.name}
          subtitle={`${item.uses} registros`} chevron={false} onPress={() => open(item)} />)}</Section>
          : <ThemedText type="small" themeColor="textSecondary">{search ? 'Nenhum detalhe encontrado.' : 'Esta categoria ainda não tem detalhes.'}</ThemedText>}
        {page.restantes ? <Button label="Ver mais detalhes" variant="secondary" onPress={page.verMais} /> : null}
        <Button label="Novo detalhe" variant="secondary" disabled={blocked} onPress={() => open(null)} />
      </> : null}
      <Presenca visivel={!!draft}>
        {draft ? <View style={styles.group}>
          <Field label="Nome" hint="De 1 a 40 caracteres" error={validName > 40 ? 'Use até 40 caracteres.' : undefined}><TextField accessibilityLabel="Nome do detalhe" value={draft.name}
            editable={Boolean(canEdit)} autoCapitalize="none" onChangeText={name => change({ name })} /></Field>
          <Field label="Categoria"><SelectField value={draft.parent} selectedOption={{ id: draft.parent, label: draft.parent }} disabled={!canEdit}
            options={Array.from(parentNames.values(), label => ({ id: label, label }))}
            onChange={value => { if (value) change({ parent: value, newParent: false }); }}
            actions={[{ id: 'new-parent', label: 'Outra categoria', disabled: !canEdit, onPress: () => change({ newParent: true }) }]} /></Field>
          {draft.newParent ? <Field label="Outra categoria"><TextField accessibilityLabel="Outra categoria" value={draft.parent}
            editable={Boolean(canEdit)} autoCapitalize="none" onChangeText={value => change({ parent: value })} /></Field> : null}
          {moving ? <ThemedText type="small" themeColor="textSecondary">Mover atualiza a categoria dos registros vinculados, pagos e pendentes, e seus históricos. As leituras de orçamento passam para o novo pai; nenhum dinheiro é transferido.</ThemedText> : null}
          {collision ? <ThemedText type="small" themeColor="warning">{draft.snapshot
            ? 'Já existe esse detalhe nesta categoria. Juntar conserva o detalhe receptor e atualiza os vínculos.'
            : 'Esse detalhe já existe. Volte à lista para editar o detalhe existente.'}</ThemedText> : null}
          {outdated && !blocked ? <View style={styles.group}>
            <ThemedText type="small" themeColor="danger">O detalhe mudou em outro lugar. Reabra para conferir a revisão atual.</ThemedText>
            <Button label="Reabrir detalhe" variant="secondary" onPress={() => {
              if (!sameVisit() || active.current.blocked) return;
              if (current) open(current); else setDraft(null);
            }} />
          </View> : null}
          <Button label={collision ? 'Juntar detalhes' : 'Salvar detalhe'} disabled={!valid || (!!collision && !draft.snapshot)} loading={write.isPending} onPress={save} />
          {draft.snapshot ? <Button label="Remover detalhe" variant="secondary" tone="danger" disabled={!canEdit} onPress={remove} /> : null}
          <Button label="Voltar aos detalhes" variant="ghost" disabled={blocked} onPress={() => { if (sameVisit() && !active.current.blocked) setDraft(null); }} />
        </View> : null}
      </Presenca>
    </SheetScroll>
  </Sheet>;
}
const styles = StyleSheet.create({ body: { padding: Space.lg, gap: Space.xl }, group: { gap: Space.md } });
