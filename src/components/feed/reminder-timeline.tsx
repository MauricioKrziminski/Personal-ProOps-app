import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { emQuantoTempo, horaBR } from '@/lib/dates';

export type LembreteDoDia = {
  id: string;
  title: string;
  next_run_at: string;
  channel: string;
  recurrence: string | null;
};

/**
 * Os lembretes de hoje numa linha do tempo: a hora à esquerda, o eixo no meio, o título à
 * direita. O que já passou esmaece; o próximo acende com "em 2 h".
 *
 * Linha de lista: highlight de fundo no toque, nunca escala (§5).
 */
export function ReminderTimeline({
  lembretes,
  agora,
  onOpen,
}: {
  lembretes: readonly LembreteDoDia[];
  agora: number;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const proximo = lembretes.find((r) => new Date(r.next_run_at).getTime() >= agora)?.id;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      {lembretes.map((r, i) => {
        const passou = new Date(r.next_run_at).getTime() < agora;
        const destaque = r.id === proximo;
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={`${r.title}, ${horaBR(r.next_run_at)}`}
            onPress={() => onOpen(r.id)}>
            {({ pressed }) => (
              <View style={[styles.linha, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
                <View style={styles.hora}>
                  <ThemedText type="ticker" themeColor={passou ? 'textSecondary' : 'text'} style={tabular}>
                    {horaBR(r.next_run_at)}
                  </ThemedText>
                  {destaque ? (
                    <ThemedText type="caption" themeColor="success">
                      {emQuantoTempo(r.next_run_at, agora)}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.eixo}>
                  <View
                    style={[
                      styles.ponto,
                      { backgroundColor: destaque ? theme.success : passou ? theme.separator : theme.text },
                    ]}
                  />
                  {i < lembretes.length - 1 ? <View style={[styles.fio, { backgroundColor: theme.rail }]} /> : null}
                </View>
                <View style={styles.textos}>
                  <ThemedText type="default" themeColor={passou ? 'textSecondary' : 'text'}>
                    {r.title}
                  </ThemedText>
                  {r.channel === 'whatsapp' || r.recurrence ? (
                    <View style={styles.meta}>
                      {r.channel === 'whatsapp' ? (
                        <>
                          <Icon name="bubble.left" size="xs" color="textSecondary" />
                          <ThemedText type="caption" themeColor="textSecondary">
                            WhatsApp
                          </ThemedText>
                        </>
                      ) : null}
                      {r.recurrence ? <Icon name="arrow.clockwise" size="xs" color="textSecondary" /> : null}
                    </View>
                  ) : null}
                </View>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  linha: { flexDirection: 'row', gap: Space.md, paddingHorizontal: Space.lg, minHeight: 56 },
  hora: { width: 56, paddingVertical: Space.md, gap: Space.half },
  eixo: { width: 10, alignItems: 'center', paddingTop: Space.md + 5 },
  ponto: { width: 10, height: 10, borderRadius: Radius.pill },
  fio: { width: 2, flex: 1, marginTop: Space.xs, borderRadius: Radius.pill },
  textos: { flex: 1, minWidth: 0, paddingVertical: Space.md, gap: Space.half },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
});
