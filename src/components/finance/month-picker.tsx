import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { localISODate } from '@/lib/dates';

/** Mês corrente em `YYYY-MM`. */
export function currentMonth(): string {
  return localISODate().slice(0, 7);
}

/** `YYYY-MM` deslocado em N meses (aceita negativo). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `2026-08` → `agosto de 2026`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/**
 * Igual, com inicial maiúscula. `textTransform: 'capitalize'` não serve: viraria
 * "Agosto De 2026".
 */
export function monthTitle(month: string): string {
  const label = monthLabel(month);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

interface MonthPickerProps {
  month: string;
  onChange: (month: string) => void;
  /**
   * Sobre o painel de destaque (tinta), em vez de sobre o fundo da tela.
   *
   * O seletor é o **controle do número do painel** — quem muda o mês muda o valor grande. Fora
   * dele, flutuando entre o header e a faixa preta, ele lia como um filtro solto e a relação
   * com o valor sumia. Aqui só troca as cores; a mecânica é a mesma.
   */
  onHero?: boolean;
}

/**
 * Navegador de mês — UMA implementação para o app inteiro.
 *
 * `transactions.tsx` e `budgets.tsx` tinham a mesma função duplicada com visual e
 * acessibilidade diferentes (setas desenhadas como texto `‹`/`›`, sem label). Aqui a seta é
 * `Icon` (SF Symbol) e cada uma diz para onde vai.
 */
export function MonthPicker({ month, onChange, onHero = false }: MonthPickerProps) {
  const theme = useTheme();

  const step = (delta: number) => () => {
    Haptics.selectionAsync();
    onChange(shiftMonth(month, delta));
  };

  const arrow = (delta: -1 | 1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        delta < 0 ? `Mês anterior, ${monthTitle(shiftMonth(month, -1))}` : `Próximo mês, ${monthTitle(shiftMonth(month, 1))}`
      }
      hitSlop={8}
      onPress={step(delta)}
      style={({ pressed }) => [
        styles.arrow,
        onHero
          ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.heroSeparator }
          : { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <Icon
        name={delta < 0 ? 'chevron.left' : 'chevron.right'}
        size="sm"
        color={onHero ? 'onHero' : 'tint'}
      />
    </Pressable>
  );

  return (
    <View style={styles.row}>
      {arrow(-1)}
      <ThemedText
        type="smallBold"
        themeColor={onHero ? 'onHeroMuted' : 'text'}
        accessibilityRole="header"
        accessibilityLabel={monthTitle(month)}
        style={styles.label}>
        {monthTitle(month)}
      </ThemedText>
      {arrow(1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  arrow: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    textAlign: 'center',
  },
});
