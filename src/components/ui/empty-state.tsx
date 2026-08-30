import { StyleSheet, View } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { Space } from '@/design/tokens';

interface EmptyStateProps {
  /**
   * SF Symbol, quando o símbolo CARREGA a causa do vazio — a lixeira vazia, a busca sem
   * resultado. Sem ele o glyph é a espiral da marca (ver o cabeçalho do componente).
   */
  icon?: SymbolViewProps['name'];
  title: string;
  /** A dica ACIONÁVEL. Normalmente o atalho do WhatsApp que preenche esta tela. */
  hint?: string;
  action?: { label: string; onPress: () => void };
}

/**
 * Empty state composto.
 *
 * Regra: cada causa de vazio tem o seu. "Nunca teve nada" e "o filtro não achou" são telas
 * diferentes — dizer "nada anotado ainda" para quem tem 200 notas filtradas é mentira.
 *
 * ## Por que o glyph padrão é a marca
 *
 * `design.md` §2b prevê a espiral em cinco papéis utilitários — spinner, **glyph de estado
 * vazio**, marcador do que veio da IA, marca d'água do painel e a abertura. Ela estava em três.
 * Num sistema sem cor de marca, é a repetição da FORMA que dá personalidade (é o que torna a
 * Vercel reconhecível pelo ▲ no prompt e no loading); um SF Symbol genérico no estado vazio é
 * de todo mundo.
 *
 * `icon` continua existindo para quando o símbolo carrega a CAUSA — lixeira vazia, busca sem
 * resultado. Vazio genérico ("ainda não tem nada aqui") fica com a marca.
 */
export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ? (
        <Icon name={icon} size="xl" color="textSecondary" />
      ) : (
        <Mark size={44} color="textSecondary" />
      )}
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
        // pai com `stretch`, e isso ganhava do `alignItems: center` daqui — o botão saía colado
        // à esquerda embaixo de um título centralizado.
        <Button label={action.label} onPress={action.onPress} size="sm" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.xxxl,
    paddingHorizontal: Space.xl,
  },
  centered: {
    textAlign: 'center',
  },
  action: {
    alignSelf: 'center',
  },
});
