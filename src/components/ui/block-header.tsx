import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const ALTURA_DA_ACAO = 30;

export interface BlockHeaderProps {
  title: string;
  /** Contagem ao lado do título. Zero ou ausente não desenha nada (badge é contagem real, §8). */
  count?: number;
  /** A ação do bloco, em pílula ("Ver todos"). */
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** Etiqueta neutra quando não há ação — a LENTE do número ("por data da compra"). */
  tag?: string;
  /** `app`: o selo da marca antes do título — é o app falando (Conversa organizada). */
  voice?: 'app';
  /** Controle próprio à direita. Vence `action` e `tag`. */
  trailing?: ReactNode;
}

/**
 * O cabeçalho de bloco das raízes.
 *
 * Substitui o `SectionHead` de 14px + "Ver todos" em texto azul-tinta solto: o título ganha
 * escala (`title2`), a contagem vira pílula e a ação vira um alvo de verdade, com fundo e seta —
 * a queixa de 17/09/2026 foi exatamente o "Cartões" e o "Ver todos" do Financeiro.
 */
export function BlockHeader({ title, count, action, tag, voice, trailing }: BlockHeaderProps) {
  const theme = useTheme();
  const direita =
    trailing ??
    (action ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel ?? action.label}
        hitSlop={(HitTarget - ALTURA_DA_ACAO) / 2}
        onPress={() => {
          Haptics.selectionAsync();
          action.onPress();
        }}
        style={({ pressed }) => [
          styles.pilula,
          { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        <ThemedText type="caption" style={styles.semEncolher}>
          {action.label}
        </ThemedText>
        <Icon name="chevron.right" size="xs" color="text" />
      </Pressable>
    ) : tag ? (
      <View style={[styles.pilula, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.semEncolher}>
          {tag}
        </ThemedText>
      </View>
    ) : null);

  return (
    <View style={styles.cabeca}>
      <View style={styles.esquerda}>
        {voice === 'app' ? (
          <View style={[styles.selo, { backgroundColor: theme.heroSurface }]}>
            <Mark size={12} color="onHero" />
          </View>
        ) : null}
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.titulo}>
          {title}
        </ThemedText>
        {count ? (
          <View style={[styles.contagem, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="code" themeColor="textSecondary" style={tabular}>
              {count}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {direita}
    </View>
  );
}

const styles = StyleSheet.create({
  cabeca: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  esquerda: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm, flexShrink: 1 },
  // Identificador: quebra a linha inteira, nunca encolhe até sumir (§3).
  titulo: { flexShrink: 0, maxWidth: '100%' },
  semEncolher: { flexShrink: 0 },
  selo: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contagem: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: ALTURA_DA_ACAO,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
});
