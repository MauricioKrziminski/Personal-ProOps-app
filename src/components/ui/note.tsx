import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Space } from '@/design/tokens';

/**
 * Nota de apoio: uma linha de contexto que não pertence a nenhum campo.
 *
 * Existia copiada em três telas de porta de entrada (`login-screen`, `link-phone`
 * ×2, `link-email`), sempre com o mesmo `flexDirection: 'row'` mais `flex: 1` no
 * texto — e em mais quatro telas sem o ícone, como parágrafo solto escrito à mão.
 * Oito cópias é como o tamanho e a cor divergem: o paywall já escrevia
 * `...Type.footnote` num `StyleSheet` de tela só para chegar onde este componente
 * chega.
 *
 * ⚠️ **`alignItems: 'flex-start'`, nunca `center`.** As três cópias centralizavam,
 * e centralizado o ícone desce para o meio do bloco quando o texto ocupa duas
 * linhas — que é o caso normal, já que design.md §7 proíbe truncar. O glifo
 * pertence à PRIMEIRA linha.
 *
 * Fora de `textSecondary` só entra cor semântica: nota é contexto, e cor aqui é a
 * última alavanca que o app tem (§2b).
 */
export function Note({
  icon,
  tone = 'textSecondary',
  children,
}: {
  icon?: IconName;
  tone?: 'textSecondary' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <View style={styles.nota}>
      {icon ? <Icon name={icon} size="sm" color={tone} /> : null}
      <ThemedText type="footnote" themeColor={tone} style={styles.texto}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  nota: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  texto: { flex: 1 },
});
