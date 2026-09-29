import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { empilhaLadrilhos, larguraMinimaDoLadrilho } from '@/design/tile-math';
import { Elevation, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { DinheiroEncolhe } from '@/components/ui/money';

export interface TileProps {
  /** `fill` divide uma `TileRow`; `half` e `wide` são células da `TileGrid`. */
  layout?: 'fill' | 'half' | 'wide';
  icon?: IconName;
  label: string;
  value?: ReactNode;
  caption?: string;
  /** Minigráfico no canto (anel, minicurva). Toma o lugar da seta. */
  visual?: ReactNode;
  /** Faixa embaixo do valor (a barra do "já caiu"). */
  footer?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

const LAYOUT: Record<NonNullable<TileProps['layout']>, ViewStyle> = {
  /*
    `minWidth` é a válvula da régua 384dp × fonte 1,3: abaixo dela o rótulo partiria no meio da
    palavra ("Vencend/o", medido no emulador). Com a fileira em `flexWrap`, o terceiro ladrilho
    desce de linha antes disso.
  */
  fill: { flexGrow: 1, flexBasis: 0, minWidth: 96 },
  // `flexBasis` 40% + `flexGrow`: duas por linha repartindo o `gap`, e a última ímpar ocupa a linha.
  half: { flexGrow: 1, flexBasis: '40%', minWidth: 0 },
  wide: { flexBasis: '100%' },
};

/**
 * O que a fileira/grade decidiu para os ladrilhos dela (`empilhar`) e por onde cada um informa o
 * mínimo que precisa. Fora de uma fileira, o ladrilho segue o `layout` que recebeu.
 */
const Fileira = createContext<{ empilhar: boolean; informar: (id: string, minimo: number) => void } | null>(null);

/**
 * O ladrilho do mosaico: superfície branca, canto 18, ícone num selo, rótulo, valor e um slot de
 * minigráfico. Press em escala (é bloco, não linha — §5).
 *
 * **A linha inteira só quando MEDIR que não cabe** (29/09/2026, *"somente quando realmente for
 * necessário"*). O ladrilho mede, sem restrição de largura, a palavra mais larga (rótulo e
 * legenda: palavra não parte) e o valor inteiro (que encolhe até `ENCOLHE_ATE`), e informa à
 * fileira o mínimo que precisa. A fileira decide por TODOS: cabendo na metade, repartem igual;
 * não cabendo, todos ocupam a linha inteira. A troca antiga pela fonte do sistema (acima de
 * 1,15×) empilhava cedo demais — e sem ela, a 2,14× saía "Orçament/os" e o valor a 50%.
 */
export function Tile({
  layout = 'fill',
  icon,
  label,
  value,
  caption,
  visual,
  footer,
  onPress,
  accessibilityLabel,
}: TileProps) {
  const theme = useTheme();
  const scheme = useScheme();

  const [medida, setMedida] = useState({ palavra: 0, valor: 0 });
  const meuMinimo = Math.max(
    (LAYOUT[layout].minWidth as number | undefined) ?? 0,
    larguraMinimaDoLadrilho(medida.palavra, medida.valor, Space.lg),
  );
  /*
    Quem decide é a fileira, com o MAIOR mínimo de todos e a largura que ela mede. Um `minWidth`
    por ladrilho foi tentado e devolvido: o flexbox parte do mínimo de cada um e reparte o resto
    (o par saía 169 × 188), e com `flexWrap` o Yoga deixava a fileira com a altura de UMA linha,
    o ladrilho de baixo por cima do bloco seguinte.
  */
  const id = useId();
  const fileira = useContext(Fileira);
  const informar = fileira?.informar;
  useEffect(() => {
    informar?.(id, meuMinimo);
    return () => informar?.(id, 0);
  }, [informar, id, meuMinimo]);
  const forma = layout === 'wide' || fileira?.empilhar ? LAYOUT.wide : LAYOUT[layout];

  const palavras = `${label} ${caption ?? ''}`.split(/\s+/).filter(Boolean);
  const medidor = (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.medidor}>
      <View
        style={styles.medidorColuna}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setMedida((m) => (m.palavra === w ? m : { ...m, palavra: w }));
        }}>
        {palavras.map((p, i) => (
          <ThemedText key={i} type="footnote" style={styles.semEncolher}>
            {p}
          </ThemedText>
        ))}
      </View>
      <View
        style={styles.medidorColuna}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setMedida((m) => (m.valor === w ? m : { ...m, valor: w }));
        }}>
        {/* O valor por inteiro, sem encolher: é a largura NATURAL que decide. */}
        <DinheiroEncolhe.Provider value={false}>{value}</DinheiroEncolhe.Provider>
      </View>
    </View>
  );

  const corpo = (
    <View
      style={[
        styles.tile,
        { backgroundColor: theme.surface, borderColor: theme.cardBorder, boxShadow: Elevation[scheme].raised },
      ]}>
      {medidor}
      <View style={styles.topo}>
        {icon ? (
          <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
            <Icon name={icon} size="sm" color="text" />
          </View>
        ) : (
          <View />
        )}
        {visual ?? (onPress ? <Icon name="arrow.up.right" size="xs" color="textSecondary" /> : null)}
      </View>
      <View style={styles.base}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {label}
        </ThemedText>
        {/* Ladrilho tem largura fixa: o valor encolhe para caber (`DinheiroEncolhe`). */}
        <DinheiroEncolhe.Provider value>{value}</DinheiroEncolhe.Provider>
        {caption ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {caption}
          </ThemedText>
        ) : null}
      </View>
      {footer}
    </View>
  );

  /*
    ⚠️ A `key` troca com a forma: no Fabric o `flexBasis` de uma view JÁ MONTADA não atualiza (o
    `half` seguia em 40% e o `fill` em 0 depois de a fileira mandar empilhar — Entra e Sai viraram
    lascas). Remontar a moldura é raro (só quando a fileira troca de decisão) e a medida mora no
    `Tile`, que não remonta.
  */
  const chave = layout === 'wide' || fileira?.empilhar ? 'linha-inteira' : 'repartido';
  if (!onPress) return <View key={chave} style={forma}>{corpo}</View>;
  /*
    A forma mora numa `View` comum, nunca no `PressableScale`: ele é uma view ANIMADA, e trocar
    `flexBasis`/`flexGrow` dela depois de montada ficava preso no valor antigo — ao empilhar, Entra
    e Sai viravam duas lascas de 40pt (29/09/2026; a mesma armadilha do `Segmented`, design.md §5).
  */
  return (
    <View key={chave} style={forma}>
      <PressableScale
        haptic="selection"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        style={styles.preenche}>
        {corpo}
      </PressableScale>
    </View>
  );
}

function useFileira() {
  const [minimos, setMinimos] = useState<Record<string, number>>({});
  const [largura, setLargura] = useState(0);
  const informar = useCallback((id: string, minimo: number) => {
    setMinimos((m) => (m[id] === minimo ? m : { ...m, [id]: minimo }));
  }, []);
  const empilhar = empilhaLadrilhos(Math.max(0, ...Object.values(minimos)), largura, Space.md);
  const valor = useMemo(() => ({ empilhar, informar }), [empilhar, informar]);
  const medir = useCallback((e: LayoutChangeEvent) => setLargura(e.nativeEvent.layout.width), []);
  return { valor, medir };
}

/** Ladrilhos lado a lado, repartindo a largura. */
export function TileRow({ children }: { children: ReactNode }) {
  const { valor, medir } = useFileira();
  return (
    <Fileira.Provider value={valor}>
      <View style={styles.linha} onLayout={medir}>
        {children}
      </View>
    </Fileira.Provider>
  );
}

/** O mosaico: duas colunas, `wide` ocupa a linha. */
export function TileGrid({ children }: { children: ReactNode }) {
  const { valor, medir } = useFileira();
  return (
    <Fileira.Provider value={valor}>
      <View style={styles.grade} onLayout={medir}>
        {children}
      </View>
    </Fileira.Provider>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    gap: Space.md,
    padding: Space.lg,
    minHeight: 112,
    /*
      O conteúdo desce logo abaixo do ícone; a sobra fica no PÉ do ladrilho. Com
      `space-between`, dois ladrilhos lado a lado de alturas iguais e conteúdos de tamanhos
      diferentes empurravam o par de números para linhas de base diferentes — e abriam um vão
      no meio do mais curto (medido nos dois: "Entra R$ 0,00" ao lado de "Sai", que tem legenda
      e barra). Alinhados pelo topo, os dois valores ficam na mesma linha.
    */
    justifyContent: 'flex-start',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  /*
    O medidor mede sem restrição: largo e fora da vista, com as colunas no tamanho do conteúdo.
    Absoluto, não mexe no layout; invisível, sem toque e fora do leitor de tela.
  */
  medidor: { position: 'absolute', left: 0, top: 0, width: 10000, opacity: 0 },
  medidorColuna: { position: 'absolute', left: 0, top: 0, alignItems: 'flex-start' },
  semEncolher: { flexShrink: 0 },
  preenche: { flexGrow: 1 },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  selo: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  base: { gap: Space.half },
  linha: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
});
