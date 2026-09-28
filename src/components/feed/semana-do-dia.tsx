import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { useBRL, useConceal } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
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
/** Quantas marcas cabem na coluna antes de virar "+N". */
const MARCAS = 3;
/** O círculo do número do dia, em dp à fonte padrão: cresce com a fonte do sistema. */
const CIRCULO = 28;
/**
 * Teto da fonte no EIXO (dia da semana, número e círculo). Sete colunas iguais não têm para onde
 * quebrar — o mesmo motivo do teto da barra de abas. Medido num iPhone de 375pt (coluna de 44pt):
 * "dom" cabe até 1,66× e o círculo até 1,59×; sem teto, no tamanho de acessibilidade "dom" partia
 * em "do / m" e o círculo invadia o vizinho (28/09/2026). Os tamanhos comuns (até ~1,35×) passam
 * inteiros.
 */
const TETO_DO_EIXO = 1.5;

/** Anima um deslocamento vertical que NASCE no valor real e só anda quando ele muda (§5). */
function useDeslocamento(alvo: number) {
  const reduzir = useReducedMotion();
  const valor = useSharedValue(alvo);
  const anterior = useRef(alvo);
  useEffect(() => {
    if (anterior.current === alvo) return;
    anterior.current = alvo;
    valor.set(reduzir ? alvo : withTiming(alvo, { duration: Motion.duration.slow, easing: Motion.easing.out }));
  }, [alvo, valor, reduzir]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: valor.get() }] }));
}

/**
 * Uma coluna da semana. A barra é uma cápsula de altura cheia DESLIZADA para dentro de uma caixa
 * que corta (`translateY`), nunca uma altura animada: só `transform` anima (§5), e esticar com
 * `scaleY` achataria a ponta arredondada. A que passa do teto fica cheia.
 */
function Barra({ fracao, cor, opacidade }: { fracao: number; cor: string; opacidade: number }) {
  const altura = Math.min(ALTURA, Math.max(PISO, Math.round(fracao * ALTURA)));
  const estilo = useDeslocamento(ALTURA - altura);
  return (
    <View style={styles.trilho}>
      <Animated.View style={[styles.barra, { backgroundColor: cor, opacity: opacidade }, estilo]} />
    </View>
  );
}

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
      {/* Dia vazio: um ponto CHEIO na cor do fio — contorno com raio de pílula sai quadrado no Android. */}
      {pontos === 0 && dia.aEntrar === 0 ? <View style={[styles.ponto, { backgroundColor: theme.separator }]} /> : null}
    </View>
  );
}

/** A régua tracejada: anda JUNTO com as barras quando o teto muda (mesmo tempo, mesma curva). */
function Regua({ altura, largura, cor }: { altura: number; largura: number; cor: string }) {
  const estilo = useDeslocamento(ALTURA - altura);
  const tracos = largura > 0 ? Math.floor(largura / (TRACO + VAO)) : 0;
  return (
    <Animated.View style={[styles.regua, estilo]}>
      {Array.from({ length: tracos }, (_, i) => (
        <View key={i} style={[styles.traco, { backgroundColor: cor }]} />
      ))}
    </Animated.View>
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
 * - Tocar num dia troca a frase de cima por ele; o háptico é o de seleção. A frase tem sempre a
 *   mesma altura (uma linha de estado reservada), então o gráfico nunca pula ao trocar de dia.
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
  const { concealed } = useConceal();
  const { fontScale } = useWindowDimensions();
  const [largura, setLargura] = useState(0);
  const dia = semana.dias.find((d) => d.day === escolhido) ?? semana.dias.find((d) => d.tipo === 'hoje')!;
  const frase = legendaDoDia(dia);
  const alturaDaRegua = semana.linha === null ? null : Math.min(ALTURA, Math.round((semana.linha / semana.teto) * ALTURA));
  const circulo = Math.round(CIRCULO * Math.min(Math.max(1, fontScale), TETO_DO_EIXO));
  /** No leitor de tela, o valor escondido é "valor oculto" — `brl` devolveria as bolinhas. */
  const falar = (cents: number) => (concealed ? 'valor oculto' : brl(cents));

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
    <Card style={styles.card}>
      <View accessibilityLiveRegion="polite" style={styles.frase}>
        <View style={styles.cabeca}>
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.cresce}>
            {`${frase.quando} · ${frase.rotulo}`}
          </ThemedText>
          {/* A legenda da régua mora aqui, não no gráfico: lá dentro ela caía sobre as marcas. */}
          {semana.linha !== null ? (
            <View style={styles.legenda}>
              <View style={styles.amostra}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.traco, { backgroundColor: theme.textSecondary }]} />
                ))}
              </View>
              <ThemedText type="caption" themeColor="textSecondary">
                por dia
              </ThemedText>
            </View>
          ) : null}
        </View>
        {/* UM texto, com o `Money` aninhado: em peças soltas numa linha que quebra, cada uma
            quebrava sozinha e a linha de base desalinhava (§3). */}
        <ThemedText type="footnote" themeColor="success">
          <Money cents={frase.valor} variant="title2" tone={frase.tom} />
          {frase.entrada ? `  ${frase.entrada.rotulo} ${brl(frase.entrada.valor)}` : null}
        </ThemedText>
        {/* A linha do estado existe SEMPRE (um espaço quando não há estado): trocar de dia não pode
            fazer o gráfico pular uma linha. */}
        <ThemedText type="caption" themeColor="textSecondary">
          {frase.estado ?? ' '}
        </ThemedText>
      </View>

      <View style={styles.grafico}>
        {/* A régua e a base moram atrás das colunas; as colunas é que se tocam. */}
        <View pointerEvents="none" onLayout={medir} style={styles.fundo}>
          <View style={[styles.base, { backgroundColor: theme.separator }]} />
          {alturaDaRegua !== null ? (
            <Regua altura={alturaDaRegua} largura={largura} cor={theme.textSecondary} />
          ) : null}
        </View>

        <View style={styles.colunas}>
          {semana.dias.map((d) => {
            const selecionado = d.day === dia.day;
            const f = legendaDoDia(d);
            const valorFalado = f.vazio ? 'nada previsto' : `${f.rotulo} ${falar(f.valor)}`;
            return (
              <Pressable
                key={d.day}
                accessibilityRole="button"
                accessibilityState={{ selected: selecionado }}
                accessibilityLabel={[
                  `${f.quando}: ${valorFalado}`,
                  f.entrada ? `${f.entrada.rotulo} ${falar(f.entrada.valor)}` : null,
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
                  maxFontSizeMultiplier={TETO_DO_EIXO}
                  themeColor={d.tipo === 'hoje' || selecionado ? 'text' : 'textSecondary'}
                  style={styles.semana}>
                  {d.semana}
                </ThemedText>
                {/* `collapsable={false}`: sem fundo, o Fabric achata esta View no Android e, quando o
                    fundo do escolhido chega depois, o raio não volta — o círculo saía QUADRADO
                    (medido com e sem, os dois depois de recarregar do zero). */}
                <View
                  collapsable={false}
                  style={[
                    styles.numero,
                    { minWidth: circulo, height: circulo },
                    // Escolhido é um círculo SUAVE; o círculo cheio de tinta já é o hoje.
                    d.tipo === 'hoje'
                      ? { backgroundColor: theme.tintFill }
                      : selecionado
                        ? { backgroundColor: theme.backgroundSelected }
                        : null,
                  ]}>
                  <ThemedText
                    type="small"
                    maxFontSizeMultiplier={TETO_DO_EIXO}
                    themeColor={d.tipo === 'hoje' ? 'onTint' : 'text'}
                    style={tabular}>
                    {d.numero}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Space.lg },
  frase: { gap: Space.half },
  cabeca: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  cresce: { flex: 1 },
  legenda: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexShrink: 0 },
  amostra: { flexDirection: 'row', gap: 2 },
  grafico: { position: 'relative' },
  /** O fundo cobre só a faixa das barras (a base fica no pé delas, acima dos rótulos). */
  fundo: { position: 'absolute', left: 0, right: 0, top: 0, height: ALTURA },
  base: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
  /** Nasce no topo do fundo e desce pelo `translateY` até a altura do "por dia". */
  regua: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', gap: VAO, opacity: 0.5 },
  traco: { width: TRACO, height: 1 },
  colunas: { flexDirection: 'row', justifyContent: 'space-between' },
  coluna: { flex: 1, alignItems: 'center', gap: Space.xs, minHeight: HitTarget },
  trilho: { height: ALTURA, width: LARGURA_DA_BARRA, overflow: 'hidden' },
  barra: {
    height: ALTURA,
    width: LARGURA_DA_BARRA,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  /** As marcas assentam na base, como as barras: a coluna tem a mesma altura nos dois casos. */
  marcas: { height: ALTURA, alignItems: 'center', justifyContent: 'flex-end', gap: Space.xs, paddingBottom: Space.xs },
  ponto: { width: 7, height: 7, borderRadius: Radius.pill, borderCurve: 'continuous' },
  semana: { marginTop: Space.xs },
  numero: {
    paddingHorizontal: Space.xs,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
