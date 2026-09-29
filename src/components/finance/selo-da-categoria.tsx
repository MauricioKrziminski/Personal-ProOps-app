import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { noteInk } from '@/design/note-colors';
import { superficieDaNota } from '@/design/note-surface';
import { Radius } from '@/design/tokens';
import { useAparencia } from '@/hooks/use-finance';
import { useScheme, useTheme } from '@/hooks/use-theme';

/**
 * O ícone da categoria num disco pequeno, na cor dela — para onde a categoria aparece fora de
 * uma `Row` (o card de orçamento). A mesma régua do disco da `Row`: fundo tingido, glifo na tinta.
 */
export function SeloDaCategoria({ categoria }: { categoria: string }) {
  const theme = useTheme();
  const scheme = useScheme();
  const { icon, cor } = useAparencia()(categoria);
  const tinta = cor ? noteInk(cor, scheme) : null;
  const fundo = tinta
    ? superficieDaNota(tinta, scheme, { surface: theme.backgroundElement, text: theme.text }).fundo
    : theme.backgroundElement;
  return (
    <View style={[styles.disco, { backgroundColor: fundo }]}>
      <Icon name={icon} size="sm" color="text" tint={tinta ?? undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  disco: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
});
