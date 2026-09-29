import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * O contador vermelho — "9+" no máximo. O da aba (`PillTabBar`) e o do sino da Hoje são ESTE, para
 * os dois terem a mesma forma (28/09/2026).
 *
 * ⚠️ **A fonte NÃO escala aqui**, pelo mesmo motivo do `Icon`: o selo mora numa caixa de geometria
 * fixa, e a 1,3× o "9+" quebrava em duas linhas dentro de um oval alto. `allowFontScaling={false}`
 * nas DUAS plataformas: a conta `px / fontScale` que existia só valia no Android, e no tamanho de
 * acessibilidade do iPhone o número do sino crescia e saía cortado (28/09/2026).
 * `flexShrink: 0` impede o "+" de descer.
 *
 * `borda` é a cor do que está ATRÁS do selo: ela o recorta do ícone embaixo.
 */
export function Contador({ valor, borda, style }: { valor: number | undefined; borda: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  if (!valor) return null;
  return (
    <View style={[styles.selo, { backgroundColor: theme.danger, borderColor: borda }, style]}>
      <ThemedText
        type="meta"
        themeColor="onTint"
        allowFontScaling={false}
        style={styles.texto}>
        {valor > 9 ? '9+' : String(valor)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  selo: {
    position: 'absolute',
    flexDirection: 'row',
    // Geometria FIXA: com a altura da linha escalando e a largura não, a 1,15× o selo saía oval, e
    // o lado sem a borda visível lia como cortado (28/09/2026). Um dígito = círculo.
    height: 20,
    minWidth: 20,
    borderRadius: Radius.pill,
    borderWidth: 2,
    paddingHorizontal: Space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { flexShrink: 0 },
});
