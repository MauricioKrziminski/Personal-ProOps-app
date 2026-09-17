import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface EmptyStateProps {
  /**
   * SF Symbol que CARREGA a causa do vazio — a lixeira vazia, a busca sem resultado. Sem ele, a
   * bandeja: "ainda não tem nada aqui".
   */
  icon?: SymbolViewProps['name'];
  title: string;
  /** A dica ACIONÁVEL. Normalmente o atalho do WhatsApp que preenche esta tela. */
  hint?: string;
  action?: { label: string; onPress: () => void };
}

/** Diâmetro do selo do ícone. */
const SELO = 64;

/**
 * Empty state composto: um selo redondo e calmo com o símbolo, o título e a dica.
 *
 * Regra: cada causa de vazio tem o seu. "Nunca teve nada" e "o filtro não achou" são telas
 * diferentes — dizer "nada anotado ainda" para quem tem 200 notas filtradas é mentira.
 *
 * O glyph é um símbolo do sistema num círculo suave, como nos apps de referência: ele diz o que
 * falta sem pedir atenção. (O mundo anterior usava um painel de azulejos aqui, recusado por "não
 * ter nada a ver" — o vazio precisa ser lido, não decifrado.)
 */
export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <Animated.View
        entering={FadeIn.duration(Motion.duration.slow).reduceMotion(ReduceMotion.System)}
        style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
        <Icon name={icon ?? 'tray'} size="lg" color="textSecondary" />
      </Animated.View>
      <ThemedText type="headline" style={styles.centered}>
        {title}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
          {hint}
        </ThemedText>
      ) : null}
      {action ? (
        // `alignSelf` explícito: o wrapper do `Button` usa `flex-start` para não ser esticado por
        // pai com `stretch`, e isso ganhava do `alignItems: center` daqui.
        <Button label={action.label} onPress={action.onPress} size="sm" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: Space.xxxl,
    paddingHorizontal: Space.xl,
  },
  selo: {
    width: SELO,
    height: SELO,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.sm,
  },
  centered: {
    textAlign: 'center',
  },
  action: {
    alignSelf: 'center',
    marginTop: Space.sm,
  },
});
