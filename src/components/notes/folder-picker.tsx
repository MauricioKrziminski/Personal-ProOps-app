import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { symbol } from '@/components/notes/note-actions';
import { useSaveFolder, type NoteFolder } from '@/hooks/use-notes';
import { normalizeFolderName } from '@/lib/search';

/** Quando o campo de busca deixa de ser ruído e passa a ser necessário. */
const SEARCH_FROM = 8;

/**
 * Seletor de pasta — o "mover para" de nota, e o único lugar onde uma pasta nasce no meio do
 * caminho.
 *
 * Criar dali não é atalho de conveniência: quem está movendo uma nota descobre que a pasta que
 * queria não existe exatamente ali, e mandá-lo para outra tela perderia a nota de vista. Nome
 * repetido **não é erro** — o upsert devolve a pasta existente e a nota vai para ela, que é o
 * resultado que a pessoa queria.
 */
export function FolderPicker({
  visible,
  current,
  folders,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: string | null;
  folders: NoteFolder[];
  onClose: () => void;
  onPick: (id: string | null) => void;
}) {
  const toast = useToast();
  const saveFolder = useSaveFolder();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState<string | null>(null);

  const visibleFolders = query
    ? folders.filter((f) => f.name.includes(normalizeFolderName(query)))
    : folders;

  const check = (selected: boolean) =>
    selected ? <Icon name="checkmark" size="md" color="tint" /> : null;

  const createAndMove = async () => {
    const name = normalizeFolderName(newName ?? '');
    if (!name) return;
    try {
      const id = await saveFolder.mutateAsync({ name, icon: 'folder' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNewName(null);
      setQuery('');
      onPick(id);
    } catch {
      toast({ message: 'Não deu para criar a pasta.', tone: 'error' });
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader title="Mover para" onClose={onClose} />

      <ScrollView
        contentContainerStyle={styles.corpo}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {folders.length > SEARCH_FROM ? (
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar pasta"
            autoCapitalize="none"
            accessibilityLabel="Buscar pasta"
          />
        ) : null}

        <Section>
          <Row
            title="Sem pasta"
            icon="tray"
            chevron={false}
            accessibilityState={{ selected: current === null }}
            trailing={check(current === null)}
            onPress={() => onPick(null)}
          />
          {visibleFolders.map((f) => (
            <Row
              key={f.id}
              title={f.name}
              subtitle={`${f.notes_count} nota${f.notes_count === 1 ? '' : 's'}`}
              icon={symbol(f.icon)}
              chevron={false}
              accessibilityState={{ selected: current === f.id }}
              accessibilityLabel={`${f.name}, ${f.notes_count} notas`}
              trailing={check(current === f.id)}
              onPress={() => onPick(f.id)}
            />
          ))}
          {newName === null ? (
            <Row
              title="Nova pasta…"
              icon="plus.circle"
              chevron={false}
              onPress={() => setNewName('')}
            />
          ) : (
            <View style={styles.nova}>
              <TextField
                value={newName}
                onChangeText={setNewName}
                placeholder="Nome da pasta"
                autoCapitalize="none"
                autoFocus
                maxLength={40}
                accessibilityLabel="Nome da nova pasta"
                onSubmitEditing={() => void createAndMove()}
              />
              <Button
                label="Criar e mover"
                size="sm"
                loading={saveFolder.isPending}
                onPress={() => void createAndMove()}
              />
            </View>
          )}
        </Section>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.lg, paddingHorizontal: Space.lg, paddingBottom: Space.xxxl },
  nova: { gap: Space.md, padding: Space.lg },
});
