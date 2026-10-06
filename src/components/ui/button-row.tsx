import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Space } from '@/design/tokens';

/**
 * Botões do mesmo nível, lado a lado quando cabem e um embaixo do outro só quando não dá.
 *
 * Cada filho entra com a largura NATURAL do rótulo (`flexBasis` automático) e cresce para
 * dividir a sobra; o `flexWrap` manda para a linha de baixo quem não coube, já ocupando a
 * linha inteira. O rótulo do `Button` não encolhe (§3), então com fonte grande ele desce
 * inteiro em vez de truncar. Passe `<Button block>`: o `block` enche a caixa que esta linha dá.
 */
export function ButtonRow({ children }: { children: ReactNode }) {
  const botoes = Children.toArray(children);
  if (botoes.length === 0) return null;
  return (
    <View style={styles.linha}>
      {botoes.map((botao, i) => (
        <View key={i} style={styles.celula}>{botao}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  celula: { flexGrow: 1, flexShrink: 0, maxWidth: '100%' },
});
