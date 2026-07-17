import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  formatDateBR,
  useCreateNote,
  useDeleteNote,
  useNotes,
  type Note,
} from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

function NoteCard({ note, index, onDelete }: { note: Note; index: number; onDelete: () => void }) {
  const confirmDelete = () => {
    Alert.alert('Apagar nota', 'Apagar esta nota?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onDelete();
        },
      },
    ]);
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
      <Pressable onLongPress={confirmDelete}>
        <GlassCard style={styles.noteCard}>
          <ThemedText>{note.content}</ThemedText>
          <ThemedView style={styles.noteMeta}>
            {note.category && (
              <ThemedText type="small" themeColor="tint">
                #{note.category}
              </ThemedText>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {formatDateBR(note.created_at)}
              {note.source === 'whatsapp' ? ' · via WhatsApp' : ''}
            </ThemedText>
          </ThemedView>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export default function NotesScreen() {
  const theme = useTheme();
  const { data: notes, isLoading, isError, refetch } = useNotes();
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const note of notes ?? []) if (note.category) set.add(note.category);
    return [...set].sort();
  }, [notes]);

  const filtered = category ? (notes ?? []).filter((n) => n.category === category) : notes ?? [];

  const onCreate = () => {
    const content = draft.trim();
    if (!content) return;
    createNote.mutate(content, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setDraft('');
      },
    });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.heading}>
          Notas
        </ThemedText>

        <View style={styles.quickAdd}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Anotar algo rápido…"
            placeholderTextColor={theme.textSecondary}
            onSubmitEditing={onCreate}
            returnKeyType="done"
            style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />
          <Pressable
            onPress={onCreate}
            disabled={createNote.isPending || !draft.trim()}
            accessibilityLabel="Salvar nota"
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: theme.tint,
                opacity: pressed || createNote.isPending || !draft.trim() ? 0.6 : 1,
              },
            ]}>
            <ThemedText style={styles.addLabel}>＋</ThemedText>
          </Pressable>
        </View>
        {createNote.isError && (
          <ThemedText type="small" themeColor="danger" style={styles.createError}>
            Não deu para salvar a nota. Tenta de novo.
          </ThemedText>
        )}

        {categories.length > 0 && (
          <View style={styles.filterRow}>
            <Chip label="Todas" selected={!category} onPress={() => setCategory(null)} />
            {categories.map((cat) => (
              <Chip
                key={cat}
                label={`#${cat}`}
                selected={category === cat}
                onPress={() => setCategory(category === cat ? null : cat)}
              />
            ))}
          </View>
        )}

        {isError ? (
          <ErrorCard onRetry={refetch} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(note) => note.id}
            renderItem={({ item, index }) => (
              <NoteCard note={item} index={index} onDelete={() => deleteNote.mutate(item.id)} />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              isLoading ? (
                <LoadingCard />
              ) : (
                <GlassCard style={styles.empty}>
                  <ThemedText style={styles.emptyEmoji}>📝</ThemedText>
                  <ThemedText type="smallBold">Nenhuma nota ainda</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                    Escreva aqui em cima ou manda no WhatsApp:{'\n'}“anotar: ligar pro dentista”
                  </ThemedText>
                </GlassCard>
              )
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    width: '100%',
  },
  heading: {
    paddingVertical: Spacing.three,
  },
  quickAdd: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  createError: {
    paddingBottom: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  addButton: {
    width: 48,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 26,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  list: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  noteCard: {
    gap: Spacing.two,
  },
  noteMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyHint: {
    textAlign: 'center',
  },
});
