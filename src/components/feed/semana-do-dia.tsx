import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useBRL } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { legendaDoDia, type DiaDaSemana, type Semana } from '@/lib/today-sections';

/** A altura útil das colunas: o `teto` da semana ocupa ela inteira. */
const ALTURA = 88;
/** A coluna nunca some: um dia sem gasto é um ponto na base, não um buraco na semana. */
const PISO = 4;
const LARGURA_DA_BARRA = 14;
/** Tracejado da régua, em dp. */
const TRACO = 4;
const VAO = 4;

/**
 * Uma coluna da semana. A barra é uma cápsula de altura cheia DESLIZADA para dentro de uma caixa
 * que corta (`translateY`), nunca uma altura animada: só `transform` anima (§5), e esticar com
 * `scaleY` achataria a ponta arredondada. Nasce no valor real e só anima quando ele muda — a lição
 * da barra de progresso que ficou em 0% no Android.
 */
function Barra({ fracao, cor, opacidade }: { fracao: number; cor: string; opacidade: number }) {
  const reduzir = useReducedMotion();
  const altura = Math.max(PISO, Math.round(fracao * ALTURA));
  const deslocamento = useSharedValue(ALTURA - altura);
  const anterior = useRef(altura);

  useEffect(() => {
    if (anterior.current === altura) return;
    anterior.current = altura;
    deslocamento.set(
      reduzir
        ? ALTURA - altura
        : withTiming(ALTURA - altura, { duration: Motion.duration.slow, easing: Motion.easing.out })
    );
  }, [altura, deslocamento, reduzir]);

  const estilo = useAnimatedStyle(() => ({ transform: [{ translateY: deslocamento.get() }] }));

  return (
    <View style={styles.trilho}>
      <Animated.View style={[styles.barra, { backgroundColor: cor, opacity: opacidade }, estilo]} />
    </View>
  );
}

/** Quantas marcas cabem na coluna antes de virar "+N". */
const MARCAS = 3;

/**
 * O dia que vem: MARCAS, não barra — um ponto por compromisso (até três) e um verde se entra
 * dinheiro. A régua do futuro é outra (o vencimento, fatura inclusive), e uma barra dela ao lado das
 * barras de gasto teria a mesma cara dizendo outra coisa (`semanaDoDia`).
 */
function Marcas({ dia }: { dia: DiaDaSemana }) {
  const theme = useTheme();
  const pontos = Math.min(MARCAS, dia.previstos);
  const alem = dia.previstos - pontos;
  return (
    <View style={styles.marcas}>
      {alem > 0 ? (
        <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
          {`+${alem}`}
        </ThemedText>
      ) : null}
      {dia.aEntrar > 0 ? <View style={[styles.ponto, { backgroundColor: theme.success }]} /> : null}
      {Array.from({ length: pontos }, (_, i) => (
        <View key={i} style={[styles.ponto, { backgroundColor: theme.textSecondary }]} />
      ))}
      {pontos === 0 && dia.aEntrar === 0 ? (
        <View style={[styles.ponto, styles.vazio, { borderColor: theme.separator }]} />
      ) : null}
    </View>
  );
}

/**
 * A semana da Hoje (28/09/2026): três dias para trás, hoje no meio, três para a frente — com a
 * régua tracejada do que dá para gastar por dia.
 *
 * ⚠️ **De propósito, nada aqui parece o gráfico do Financeiro.** Lá é uma curva de saldo sobre o
 * bloco de tinta ("como o ciclo fecha"); aqui são colunas em cápsula sobre papel ("como está a minha
 * semana"), e o eixo é um CALENDÁRIO: o dia de hoje é o número dentro do círculo de tinta.
 *
 * - O que SAIU é barra (cinza; hoje em tinta; acima da régua em âmbar — atenção, não erro).
 * - O que VEM é marca: um ponto por compromisso e um verde se entra dinheiro (`Marcas`).
 * - Tocar num dia troca a frase de cima por ele; o háptico é o de seleção.
 */
export function SemanaDoDia({
  semana,
  escolhido,
  onEscolher,
}: {
  semana: Semana;
  escolhido: string;
  onEscolher: (day: string) => void;
}) {
  const theme = useTheme();
  const brl = useBRL();
  const [largura, setLargura] = useState(0);
  const dia = semana.dias.find((d) => d.day === escolhido) ?? semana.dias.find((d) => d.tipo === 'hoje')!;
  const frase = legendaDoDia(dia, semana.linha, brl);
  const alturaDaRegua = semana.linha === null ? null : Math.round((semana.linha / semana.teto) * ALTURA);
  const tracos = largura > 0 ? Math.floor(largura / (TRACO + VAO)) : 0;

  const medir = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setLargura((antes) => (antes === w ? antes : w));
  };

  /*
    Hoje em tinta; o que passou na tinta secundária a 45% (80% quando escolhido) — os cinzas de
    superfície (`backgroundSelected`) somem sobre o card branco. Acima da régua, âmbar.
  */
  const corDa = (d: DiaDaSemana) => {
    if (d.acima) return theme.warning;
    return d.tipo === 'hoje' ? theme.text : theme.textSecondary;
  };
  const opacidadeDa = (d: DiaDaSemana, selecionado: boolean) =>
    d.tipo === 'hoje' || d.acima ? 1 : selecionado ? 0.8 : 0.45;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View accessibilityLiveRegion="polite" style={styles.frase}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {`${frase.quando} · ${frase.rotulo}`}
        </ThemedText>
        <Money cents={frase.valor} variant="title2" tone={dia.acima ? 'warning' : 'text'} />
        {/* A linha do estado existe SEMPRE (um espaço quando não há estado): trocar de dia não pode
            fazer o gráfico pular uma linha para cima. */}
        <ThemedText type="caption" themeColor="textSecondary">
          {frase.estado ?? '\u00a0'}
        </ThemedText>
      </View>

      <View style={styles.grafico}>
        {/* A régua e a base moram atrás das colunas; as colunas é que se tocam. */}
        <View pointerEvents="none" onLayout={medir} style={styles.fundo}>
          <View style={[styles.base, { backgroundColor: theme.separator }]} />
          {alturaDaRegua !== null ? (
            <View style={[styles.regua, { bottom: alturaDaRegua }]}>
              {Array.from({ length: tracos }, (_, i) => (
                <View key={i} style={[styles.traco, { backgroundColor: theme.textSecondary }]} />
              ))}
            </View>
          ) : null}
          {alturaDaRegua !== null ? (
            <ThemedText
              type="caption"
              themeColor="textSecondary"
              // Régua perto do topo: o rótulo vai para BAIXO dela — acima, com fonte grande, ele
              // encavalava o tracejado.
              style={[
                styles.rotuloDaRegua,
                alturaDaRegua > ALTURA / 2
                  ? { top: ALTURA - alturaDaRegua + Space.xs }
                  : { bottom: alturaDaRegua + Space.xs },
              ]}>
              por dia
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.colunas}>
          {semana.dias.map((d) => {
            const selecionado = d.day === dia.day;
            const f = legendaDoDia(d, semana.linha, brl);
            return (
              <Pressable
                key={d.day}
                accessibilityRole="button"
                accessibilityState={{ selected: selecionado }}
                accessibilityLabel={[
                  f.rotulo === 'nada previsto' ? `${f.quando}: nada previsto` : `${f.quando}: ${f.rotulo} ${brl(f.valor)}`,
                  f.estado,
                ]
                  .filter(Boolean)
                  .join(', ')}
                onPress={() => {
                  if (selecionado) return;
                  Haptics.selectionAsync();
                  onEscolher(d.day);
                }}
                style={styles.coluna}>
                {d.tipo === 'futuro' ? (
                  <Marcas dia={d} />
                ) : (
                  <Barra fracao={d.saiu / semana.teto} cor={corDa(d)} opacidade={opacidadeDa(d, selecionado)} />
                )}
                <ThemedText
                  type="caption"
                  themeColor={d.tipo === 'hoje' || selecionado ? 'text' : 'textSecondary'}
                  style={styles.semana}>
                  {d.semana}
                </ThemedText>
                {/* `collapsable={false}`: sem fundo, o Fabric achata esta View no Android e, quando o
                    fundo do escolhido chega depois, o raio não volta — o círculo saía QUADRADO. */}
                <View
                  collapsable={false}
                  style={[
                    styles.numero,
                    // Escolhido é um círculo SUAVE, não contorno: borda com raio de pílula sai
                    // quadrada no Android, e o círculo cheio de tinta já é o hoje.
                    d.tipo === 'hoje'
                      ? { backgroundColor: theme.tintFill }
                      : selecionado
                        ? { backgroundColor: theme.backgroundSelected }
                        : null,
                  ]}>
                  <ThemedText type="small" themeColor={d.tipo === 'hoje' ? 'onTint' : 'text'} style={tabular}>
                    {d.numero}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.lg,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  frase: { gap: Space.half },
  grafico: { position: 'relative' },
  /** O fundo cobre só a faixa das barras (a base fica no pé delas, acima dos rótulos). */
  fundo: { position: 'absolute', left: 0, right: 0, top: 0, height: ALTURA },
  base: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  regua: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: VAO, opacity: 0.5 },
  traco: { width: TRACO, height: 1 },
  rotuloDaRegua: { position: 'absolute', right: 0 },
  colunas: { flexDirection: 'row', justifyContent: 'space-between' },
  coluna: { flex: 1, alignItems: 'center', gap: Space.xs, minHeight: 44 },
  trilho: { height: ALTURA, width: LARGURA_DA_BARRA, overflow: 'hidden', justifyContent: 'flex-start' },
  barra: {
    height: ALTURA,
    width: LARGURA_DA_BARRA,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  /** As marcas assentam na base, como as barras: a coluna tem a mesma altura nos dois casos. */
  marcas: { height: ALTURA, alignItems: 'center', justifyContent: 'flex-end', gap: Space.xs, paddingBottom: Space.xs },
  ponto: { width: 7, height: 7, borderRadius: Radius.pill },
  vazio: { borderWidth: 1, backgroundColor: 'transparent' },
  semana: { marginTop: Space.xs },
  numero: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: Space.xs,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
