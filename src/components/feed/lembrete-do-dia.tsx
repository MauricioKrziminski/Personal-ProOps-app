import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { COLUNA_DA_HORA } from '@/components/feed/grupo-do-dia';
import { Icon } from '@/components/ui/icon';
import { Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { emQuantoTempo, horaBR, localISODate, rotuloDoDia } from '@/lib/dates';
import type { EntradaDoDia, LembreteDoDia } from '@/lib/today-sections';

type Estado = Extract<EntradaDoDia, { tipo: 'lembrete' }>['estado'];

/**
 * Um lembrete no Seu dia: a hora na coluna da agenda, o título, e de onde ele vem.
 *
 * - O que já passou esmaece; o próximo diz "em 2 h", em tinta — verde é dinheiro que entra (§2).
 * - O que ficou de OUTRO dia (o cron não entregou) diz a data dele, em âmbar — só a hora mentiria
 *   que é de hoje. Foi o "Para hoje" com lembretes de 25 dias antes (28/09/2026).
 *
 * Linha de lista: realce de fundo no toque, nunca escala (§5).
 */
export function LinhaDeLembrete({
  lembrete,
  estado,
  agora,
  onOpen,
}: {
  lembrete: LembreteDoDia;
  estado: Estado;
  agora: number;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const passou = estado === 'passou';
  const hora = horaBR(lembrete.next_run_at);
  const dia = estado === 'outroDia'
    ? rotuloDoDia(localISODate(new Date(lembrete.next_run_at)), localISODate(new Date(agora)))
    : null;
  const quando = estado === 'proximo' ? emQuantoTempo(lembrete.next_run_at, agora) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        lembrete.title,
        dia,
        hora,
        quando,
        passou ? 'já passou' : null,
        lembrete.recurrence ? 'repete' : null,
        lembrete.channel === 'whatsapp' ? 'pelo WhatsApp' : null,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => onOpen(lembrete.id)}>
      {({ pressed }) => (
        <View style={[styles.linha, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <View style={styles.hora}>
            <ThemedText type="ticker" themeColor={passou ? 'textSecondary' : 'text'} style={tabular}>
              {hora}
            </ThemedText>
            {quando ? (
              <ThemedText type="caption" themeColor="text">
                {quando}
              </ThemedText>
            ) : dia ? (
              <ThemedText type="caption" themeColor="warning">
                {dia}
              </ThemedText>
            ) : null}
          </View>
          <View style={styles.textos}>
            <ThemedText type="default" themeColor={passou ? 'textSecondary' : 'text'}>
              {lembrete.title}
            </ThemedText>
            {lembrete.channel === 'whatsapp' || lembrete.recurrence ? (
              <View style={styles.meta}>
                {lembrete.channel === 'whatsapp' ? (
                  <>
                    <Icon name="bubble.left" size="xs" color="textSecondary" />
                    <ThemedText type="caption" themeColor="textSecondary">
                      WhatsApp
                    </ThemedText>
                  </>
                ) : null}
                {lembrete.recurrence ? <Icon name="arrow.clockwise" size="xs" color="textSecondary" /> : null}
              </View>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 56,
  },
  hora: { minWidth: COLUNA_DA_HORA, flexShrink: 0, gap: Space.half },
  textos: { flex: 1, minWidth: 0, gap: Space.half },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
});
