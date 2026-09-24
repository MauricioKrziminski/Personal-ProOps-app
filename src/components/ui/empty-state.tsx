import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  /**
   * O vazio de uma lista que NÃO é a única coisa da tela — há arquivadas, concluídas, pausadas
   * ou pastas acima dele. Vira um card de linha, depois do que existe (24/09/2026). Grande e
   * centralizado no meio da tela, ele empurrava para baixo o que a pessoa tinha, e "Arquivadas · 1"
   * ficava solto num canto: *"a tela de arquivadas… está horrível"*.
   */
  compacto?: boolean;
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
export function EmptyState({ icon, title, hint, action, compacto = false }: EmptyStateProps) {
  const theme = useTheme();
  if (compacto) {
    return (
      <Card style={styles.compacto}>
        <View style={[styles.seloCompacto, { backgroundColor: theme.backgroundElement }]}>
          <Icon name={icon ?? 'tray'} size="md" color="textSecondary" />
        </View>
        <View style={styles.textosCompacto}>
          <ThemedText type="headline">{title}</ThemedText>
          {hint ? (
            // A quebra à mão ("…\n— ou toca em +") é do desenho centralizado; na linha o texto corre.
            <ThemedText type="footnote" themeColor="textSecondary">
              {hint.replace(/\s*\n\s*/g, ' ')}
            </ThemedText>
          ) : null}
          {action ? (
            <Button label={action.label} onPress={action.onPress} size="sm" variant="secondary" style={styles.acaoCompacta} />
          ) : null}
        </View>
      </Card>
    );
  }
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
  compacto: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md, padding: Space.lg },
  seloCompacto: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  textosCompacto: { flex: 1, gap: Space.xs },
  acaoCompacta: { alignSelf: 'flex-start', marginTop: Space.xs },
});
