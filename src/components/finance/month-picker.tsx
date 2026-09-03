import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
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
 * `2026-08` → `ago.` — o rótulo de EIXO de gráfico, onde só cabem 3 letras.
 *
 * Existia em três cópias literais (`mesLabel` em Patrimônio, `mesCurto` em Parceladas, e a que
 * este arquivo não tinha), e a quarta ia nascer com a tendência da home. Mora aqui porque é a
 * mesma família de `monthLabel`/`monthTitle`: um mês, três comprimentos.
 */
export function monthShort(month: string, comAno = false): string {
  const [y, m] = month.split('-').map(Number);
  const curto = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
  // `set./25` só quando o eixo atravessa o ano. Uma série de 12 meses tem o MESMO mês nas duas
  // pontas, e "set. … set." lê como se nada tivesse acontecido — visto no gráfico de Patrimônio.
  return comAno ? `${curto}/${String(y).slice(2)}` : curto;
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
  /** Ano aberto no sheet; `null` = sheet fechado. */
  const [sheet, setSheet] = useState<string | null>(null);

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
      {/*
        O título deixou de ser só rótulo e virou a PORTA do salto de ano. As setas resolvem ±1;
        voltar catorze meses custava catorze toques (o achado 5 da auditoria). Continua sendo
        `header` para o leitor de tela — é o que diz onde a pessoa está —, mas agora com hint e
        alvo de 44pt.
      */}
      <Pressable
        accessibilityRole="header"
        accessibilityLabel={monthTitle(month)}
        accessibilityHint="Escolher outro mês ou ano"
        onPress={() => {
          Haptics.selectionAsync();
          setSheet(month.slice(0, 4));
        }}
        style={({ pressed }) => [styles.label, { opacity: pressed ? 0.5 : 1 }]}>
        <ThemedText type="smallBold" themeColor={onHero ? 'onHeroMuted' : 'text'}>
          {monthTitle(month)}
        </ThemedText>
      </Pressable>
      {arrow(1)}

      <MonthSheet
        year={sheet}
        selected={month}
        onPick={(m) => {
          setSheet(null);
          onChange(m);
        }}
        onChangeYear={setSheet}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

/**
 * Grade de 12 meses com passo de ANO — o "período livre" da Fase 4.
 *
 * Sheet próprio em vez de um seletor de biblioteca: nenhuma lib de picker está aprovada no
 * projeto (mesma decisão registrada no `Segmented`, que também é feito à mão). Doze alvos e duas
 * setas resolvem o caso real — "quero ver março do ano passado" — em dois toques.
 *
 * **Sem limite de ano**, igual às setas: elas sempre andaram para trás e para frente sem trava, e
 * um teto aqui criaria a única fronteira do app que o usuário descobriria batendo nela.
 */
function MonthSheet({
  year,
  selected,
  onPick,
  onChangeYear,
  onClose,
}: {
  year: string | null;
  selected: string;
  onPick: (month: string) => void;
  onChangeYear: (year: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();

  return (
    <Sheet visible={year !== null} onClose={onClose}>
        <View style={styles.sheetHead}>
          <Button label="Cancelar" variant="ghost" size="sm" onPress={onClose} />
          <ThemedText type="smallBold">Escolher mês</ThemedText>
          {/* Espelha a largura do "Cancelar" para o título ficar no centro ÓPTICO. */}
          <View style={styles.sheetSpacer} />
        </View>

        <View style={styles.yearRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ano anterior, ${Number(year) - 1}`}
            hitSlop={8}
            onPress={() => {
              Haptics.selectionAsync();
              onChangeYear(String(Number(year) - 1));
            }}
            style={({ pressed }) => [
              styles.arrow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Icon name="chevron.left" size="sm" color="tint" />
          </Pressable>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.yearLabel}>
            {year}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Próximo ano, ${Number(year) + 1}`}
            hitSlop={8}
            onPress={() => {
              Haptics.selectionAsync();
              onChangeYear(String(Number(year) + 1));
            }}
            style={({ pressed }) => [
              styles.arrow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Icon name="chevron.right" size="sm" color="tint" />
          </Pressable>
        </View>

        <View style={styles.grid}>
          {Array.from({ length: 12 }, (_, i) => {
            const value = `${year}-${String(i + 1).padStart(2, '0')}`;
            const ativo = value === selected;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: ativo }}
                accessibilityLabel={monthTitle(value)}
                onPress={() => onPick(value)}
                style={({ pressed }) => [
                  styles.cell,
                  {
                    backgroundColor: ativo
                      ? theme.tint
                      : pressed
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                  },
                ]}>
                <ThemedText type="smallBold" themeColor={ativo ? 'onTint' : 'text'}>
                  {monthShort(value)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Space.xs,
  },
  arrow: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Sem `flex: 1`: o seletor é uma PÍLULA, não uma barra.
   *
   * Esticado, os dois chevrons iam parar nas pontas da tela e o controle lia como navegação de
   * página — no desenho ele é um chip compacto que diz apenas de que mês a tela está falando.
   */
  label: {
    minHeight: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  sheetSpacer: {
    width: HitTarget,
  },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  yearLabel: {
    flex: 1,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.md,
    padding: Space.lg,
  },
  cell: {
    // Três colunas: `(100% - 2 gaps) / 3`.
    width: '30%',
    flexGrow: 1,
    height: HitTarget,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
