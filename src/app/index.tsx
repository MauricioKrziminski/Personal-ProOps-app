import { FlatList, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatDateBR, useNotes, type Note } from '@/hooks/use-items';

function NoteCard({ note, index }: { note: Note; index: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
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
    </Animated.View>
  );
}

export default function NotesScreen() {
  const { data: notes, isLoading } = useNotes();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.heading}>
          Notas
        </ThemedText>

        <FlatList
          data={notes ?? []}
          keyExtractor={(note) => note.id}
          renderItem={({ item, index }) => <NoteCard note={item} index={index} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            isLoading ? null : (
              <GlassCard style={styles.empty}>
                <ThemedText style={styles.emptyEmoji}>📝</ThemedText>
                <ThemedText type="smallBold">Nenhuma nota ainda</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                  Manda uma mensagem no WhatsApp, tipo{'\n'}
                  “anotar: ligar pro dentista”
                </ThemedText>
              </GlassCard>
            )
          }
        />
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
  },
  heading: {
    paddingVertical: Spacing.three,
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
