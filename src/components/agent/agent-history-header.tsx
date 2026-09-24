import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/motion/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  onNew: () => void;
}

/**
 * Cabeçalho do histórico. Escrever e enviar ficam na aba Agente ou na conversa
 * aberta; o histórico só lista e encaminha.
 */
export const AgentHistoryHeader = memo(function AgentHistoryHeader({ onNew }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <ThemedText type="title" accessibilityRole="header">
          Conversas
        </ThemedText>
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Nova conversa"
        accessibilityHint="Abre a tela para escrever ao agente"
        haptic="light"
        onPress={onNew}
        style={[styles.action, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
        <View style={[styles.icon, { backgroundColor: theme.tintFill }]}>
          <Icon name="square.and.pencil" size="md" color="onTint" />
        </View>
        <View style={styles.actionCopy}>
          <ThemedText type="headline">Nova conversa</ThemedText>
        </View>
        <Icon name="chevron.right" size="sm" color="textSecondary" />
      </PressableScale>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%', maxWidth: 620, gap: Space.xxl },
  intro: { gap: Space.sm },
  action: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  icon: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: { flex: 1, minWidth: 0, gap: Space.xs },
});
