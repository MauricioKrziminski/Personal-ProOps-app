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
import { brToISO, isValidBRDate, isoToBR, localISODate, monthBounds } from '@/lib/dates';
import { transicaoDeLayout } from '@/components/motion/transicao';

interface Props {
  /** Data em dd/mm/aaaa, o formato do formulário. `null` = vazia. */
  value: string | null;
  onChange: (br: string) => void;
  onSelectLastDay?: (br: string) => void;
  /** O valor atual representa a intenção explícita de fim do mês (`BYMONTHDAY=-1`). */
  lastDaySelected?: boolean;
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
  onSelectLastDay,
  lastDaySelected = false,
  placeholder = 'Escolher data',
  invalid,
  accessibilityLabel,
  min,
  max,
}: Props) {
  const theme = useTheme();
  const scheme = useScheme();
  const [aberto, setAberto] = useState(false);
  // O mês que a grade está MOSTRANDO: navegando até junho, "último dia" é 30/06, não o fim do
  // mês da data gravada (28/09/2026, *"se eu estou em junho no calendário…"*).
  const [mesVisivel, setMesVisivel] = useState<string | null>(null);
  const vidro = supportsLiquidGlass() && !aberto;

  const iso = value && isValidBRDate(value) ? brToISO(value) : null;
  const mesDoValor = iso?.slice(0, 7) ?? localISODate().slice(0, 7);
  const mesPedido = (aberto && mesVisivel) || mesDoValor;
  // O mês do valor antes do mínimo (o vencimento velho de uma série que o agendador não andou)
  // desligava o botão: vale o primeiro mês permitido.
  const mesDoBotao = min && monthBounds(mesPedido).to < min ? min.slice(0, 7) : mesPedido;
  const fimDoMesISO = monthBounds(mesDoBotao).to;
  const fimDoMes = isoToBR(fimDoMesISO);
  const fimDoMesForaDoLimite = Boolean((min && fimDoMesISO < min) || (max && fimDoMesISO > max));
  // Marcado só quando a intenção gravada É este fim de mês; em outro mês o toque escolhe o dele.
  const marcado = lastDaySelected && iso === fimDoMesISO;

  const alternarUltimoDia = () => {
    if (marcado) onChange(fimDoMes);
    else onSelectLastDay?.(fimDoMes);
    setAberto(false);
  };

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
            setMesVisivel(null);
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
              onMonthChange={setMesVisivel}
              onChange={(escolhido) => {
                onChange(isoToBR(escolhido));
                setAberto(false);
              }}
              min={min}
              max={max}
            />
          </View>
        ) : null}
        {onSelectLastDay ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Último dia de todo mês"
            accessibilityState={{ selected: marcado, disabled: fimDoMesForaDoLimite }}
            disabled={fimDoMesForaDoLimite}
            onPress={alternarUltimoDia}
            style={({ pressed }) => [
              styles.ultimoDia,
              {
                backgroundColor: marcado
                  ? theme.tintFill
                  : pressed ? theme.backgroundSelected : theme.backgroundElement,
                opacity: fimDoMesForaDoLimite ? 0.4 : 1,
              },
            ]}>
            <ThemedText type="smallBold" themeColor={marcado ? 'onTint' : 'tint'}>
              Último dia de todo mês
            </ThemedText>
            <ThemedText type="caption" themeColor={marcado ? 'onTint' : 'textSecondary'}>
              {marcado ? `Selecionado · ${fimDoMes}` : `Usar ${fimDoMes}`}
            </ThemedText>
          </Pressable>
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
  ultimoDia: {
    minHeight: 48,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    justifyContent: 'center',
    gap: 2,
  },
});
