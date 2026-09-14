import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { TextField } from '@/components/ui/field';
import { Space } from '@/design/tokens';
import { useNoteTags } from '@/hooks/use-notes';
import { isValidTag, normalizeTag } from '@/lib/search';

/**
 * Seletor de tag — de NOTA e de PASTA, com a mesma lista.
 *
 * ## O namespace é um só, e é isso que faz o chip da home funcionar
 *
 * `notes.tags` é coluna GERADA do `#hashtag` do texto; `note_folders.tags` é coluna de verdade.
 * São mecanismos diferentes de GRAVAR a mesma coisa, e por isso este componente não grava nada:
 * ele devolve `onToggle(tag)` e quem chamou decide — a nota edita o CONTEÚDO (acrescenta ou tira
 * o token `#tag`, que é o que mantém a nota como texto puro voltando inteiro para o WhatsApp), a
 * pasta grava a coluna.
 *
 * As opções vêm de `note_tag_counts()`, que só conhece tag de NOTA. É de propósito: sugerir a
 * tag que já existe é o que impede `#mercado` e `#Mercado` de virarem duas coisas, e uma tag que
 * só existe em pasta continua alcançável digitando — ela aparece na lista assim que alguma nota
 * a usa. Uma segunda RPC só para completar a lista custaria uma consulta em toda abertura do
 * sheet para mudar a ordem de poucas linhas.
 */
export function TagPicker({
  visible,
  alvo,
  current,
  onClose,
  onToggle,
}: {
  visible: boolean;
  /** Muda só a palavra do título e a dica do estado vazio. O mecanismo é o mesmo. */
  alvo: 'nota' | 'pasta';
  current: string[];
  onClose: () => void;
  onToggle: (tag: string) => void;
}) {
  const known = useNoteTags();
  const [draft, setDraft] = useState('');

  const typed = normalizeTag(draft);
  const existing = (known.data ?? []).map((t) => t.tag);
  const options = Array.from(new Set([...existing, ...current])).sort();
  const shown = typed ? options.filter((t) => t.includes(typed)) : options;
  const canCreate = isValidTag(typed) && !options.includes(typed);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader title={alvo === 'nota' ? 'Tags da nota' : 'Tags da pasta'} onClose={onClose} />

      <ScrollView
        contentContainerStyle={styles.corpo}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <TextField
          value={draft}
          onChangeText={setDraft}
          placeholder="Buscar ou criar tag"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Buscar ou criar tag"
        />

        {canCreate ? (
          <Section>
            <Row
              title={`Criar #${typed}`}
              icon="plus.circle"
              chevron={false}
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onToggle(typed);
                setDraft('');
              }}
            />
          </Section>
        ) : null}

        {shown.length > 0 ? (
          <Section title="Tags">
            {shown.map((tag) => {
              const on = current.includes(tag);
              return (
                <Row
                  key={tag}
                  title={`#${tag}`}
                  chevron={false}
                  accessibilityState={{ selected: on }}
                  trailing={on ? <Icon name="checkmark" size="md" color="tint" /> : null}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onToggle(tag);
                  }}
                />
              );
            })}
          </Section>
        ) : !canCreate ? (
          <EmptyState
            icon="tag"
            title="Nenhuma tag ainda"
            hint={
              alvo === 'nota'
                ? 'Escreve o nome aí em cima — ou digita #assim no corpo da nota.'
                : 'Escreve o nome aí em cima. A mesma tag serve para nota e pasta.'
            }
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.lg, paddingHorizontal: Space.lg, paddingBottom: Space.xxxl },
});
