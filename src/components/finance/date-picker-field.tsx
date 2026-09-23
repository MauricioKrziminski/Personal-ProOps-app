import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Calendar } from '@/components/finance/calendar';
import { ThemedText } from '@/components/themed-text';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { brToISO, isValidBRDate, isoToBR } from '@/lib/dates';
import { transicaoDeLayout } from '@/components/motion/transicao';

interface Props {
  /** Data em dd/mm/aaaa, o formato do formulário. `null` = vazia. */
  value: string | null;
  onChange: (br: string) => void;
  placeholder?: string;
  invalid?: boolean;
  accessibilityLabel: string;
  /** Limites inclusivos em ISO, repassados ao `Calendar`. */
  min?: string;
  max?: string;
}

/**
 * **Escolher uma data num formulário** — o valor colapsado, o calendário no lugar.
 *
 * ## Por que ele existe
 *
 * `.claude/rules/design.md` já mandava: *"Escolher UMA DATA é `Calendar`… e ele abre no lugar,
 * nunca em `Modal`"*. Os formulários continuavam com `TextField` de `keyboardType="number-pad"`,
 * e a queixa foi direta (13/09/2026): *"se quiser editar a data de vencimento, ao clicar na
 * data, tinha que aparecer o calendar pick"*.
 *
 * ⚠️ **Não é só conforto: no iOS o campo é INDIGITÁVEL.** O teclado numérico do iPhone não tem a
 * tecla "/", então uma data que espera a barra só aceita texto colado. No Android o teclado TEM
 * a barra, e é por isso que o defeito nunca aparecia no emulador.
 *
 * ⚠️ **Abre NO LUGAR, nunca em `Modal`.** Os formulários que pedem data já vivem dentro de um
 * `Sheet`, e `Modal` dentro de `Modal` no Android é uma janela dentro de outra, com teclado e
 * botão voltar disputando qual fecha. Mesma razão do `SelectField`.
 *
 * O calendário é o único caminho: a máscara sai junto. Quem só tem espaço para uma linha de
 * texto continua com `DateField`.
 */
export function DatePickerField({
  value,
  onChange,
  placeholder = 'Escolher data',
  invalid,
  accessibilityLabel,
  min,
  max,
}: Props) {
  const theme = useTheme();
  const scheme = useScheme();
  const [aberto, setAberto] = useState(false);
  const vidro = supportsLiquidGlass() && !aberto;

  const iso = value && isValidBRDate(value) ? brToISO(value) : null;

  return (
    <Animated.View layout={transicaoDeLayout}>
      <View
        style={[
          styles.moldura,
          {
            backgroundColor: vidro ? 'transparent' : theme.surface,
            borderColor: invalid ? theme.danger : theme.cardBorder,
            boxShadow: Elevation[scheme].raised,
          },
        ]}>
        {vidro ? <GlassBackdrop fallbackColor={theme.surface} radius={Radius.sm} /> : null}
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setAberto((a) => !a);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: aberto }}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Toque para escolher no calendário">
          {({ pressed }) => (
            <View
              style={[
                styles.linha,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              <Icon name="calendar" size="sm" color="textSecondary" />
              <ThemedText
                type="default"
                themeColor={value ? 'text' : 'textSecondary'}
                style={styles.valor}>
                {value || placeholder}
              </ThemedText>
              <Icon name={aberto ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />
            </View>
          )}
        </Pressable>

        {aberto ? (
          <View style={[styles.calendario, { borderTopColor: theme.cardBorder }]}>
            <Calendar
              value={iso}
              onChange={(escolhido) => {
                onChange(isoToBR(escolhido));
                setAberto(false);
              }}
              min={min}
              max={max}
            />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  moldura: { borderRadius: Radius.sm, borderWidth: 1, borderCurve: 'continuous', overflow: 'hidden' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, padding: Space.md, minHeight: 48 },
  /* O valor empurra o chevron para a direita e cede antes dele quando a fonte cresce. */
  valor: { flex: 1 },
  calendario: { borderTopWidth: 1, padding: Space.sm },
});
