import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Sheet, SheetHeader } from '@/components/ui/sheet';
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
   * Rodapé DENTRO da mesma superfície, abaixo de um fio — a janela que o mês cobre e a régua
   * que a produz (`PeriodBar`). Sem ele o controle é só o passo de mês.
   */
  children?: React.ReactNode;
}

/**
 * Navegador de mês — UMA implementação para o app inteiro.
 *
 * `transactions.tsx` e `budgets.tsx` tinham a mesma função duplicada com visual e
 * acessibilidade diferentes (setas desenhadas como texto `‹`/`›`, sem label). Aqui a seta é
 * `Icon` (SF Symbol) e cada uma diz para onde vai.
 *
 * ## Ele virou uma SUPERFÍCIE, e isso reverte uma decisão anterior (11/09/2026)
 *
 * Era uma linha solta com `alignSelf: 'flex-start'`, e o comentário de então dizia que esticar
 * faria dele "navegação de página". O argumento estava certo sobre o desenho ANTIGO — duas setas
 * de 44pt e um texto no meio, sem nada em volta, espalhados até as bordas da tela. O que ele não
 * previu é o que sobra quando esse controle é o primeiro elemento abaixo do header: texto nu com
 * ar em volta, que é a queixa literal do dono do produto (*"está tendo espaço vazio para cima
 * sem necessidade"*, *"dá para melhorar o componente de passar e voltar o mês"*).
 *
 * Dentro de um card com contorno, as setas passam a ser DELE e não da tela; o vazio acima vira a
 * distância entre dois blocos, que é exatamente o que ele é. As setas caíram de 44 para 36 de
 * geometria com `hitSlop` — o alvo continua acima dos 44pt exigidos (§11) e o bloco encolhe 16pt
 * de altura, que era metade do "espaço vazio".
 */
export function MonthPicker({ month, onChange, children }: MonthPickerProps) {
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
      hitSlop={Space.sm}
      onPress={step(delta)}
      style={({ pressed }) => [
        styles.arrow,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <Icon name={delta < 0 ? 'chevron.left' : 'chevron.right'} size="sm" color="tint" />
    </Pressable>
  );

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
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
          <ThemedText type="smallBold">{monthTitle(month)}</ThemedText>
        </Pressable>
        {arrow(1)}
      </View>

      {children ? (
        <>
          <View style={[styles.divisor, { backgroundColor: theme.separator }]} />
          <View style={styles.rodape}>{children}</View>
        </>
      ) : null}

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
        <SheetHeader title="Escolher mês" onClose={onClose} />

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
  card: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.sm,
  },
  arrow: {
    width: HitTarget - Space.sm,
    height: HitTarget - Space.sm,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * `flex: 1` porque agora o controle É a largura do bloco: o mês fica no centro ÓPTICO entre as
   * duas setas, sem contrapeso inventado. Com fonte grande ele quebra a linha e o card cresce —
   * "Setembro de 2026" é identificador e identificador não trunca (design.md §7).
   */
  label: {
    flex: 1,
    minHeight: HitTarget - Space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  divisor: {
    height: StyleSheet.hairlineWidth,
  },
  rodape: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
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
