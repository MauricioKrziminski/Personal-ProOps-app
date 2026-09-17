import { useCallback, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SymbolViewProps } from 'expo-symbols';

import { progressoDeEntrada, useRelogioDeEntrada } from '@/components/motion/entrada';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { centroDoSlot, distanciaDaAba, folgaDaMola, posicaoDesenhada } from '@/design/tab-pill';
import { Elevation, Motion, Radius, Space, Type } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

/** Altura da pílula, sem a safe area. */
const BAR_H = 68;
/** O respiro interno da pílula, dos lados. */
const PAD = 6;
/** O círculo claro atrás do ícone ativo. */
const DIAMETRO = 36;
/** Onde o círculo (e os ícones) começam, a partir do topo da pílula. */
const TOPO = 7;
/** Calha lateral: a barra flutua, não encosta nas bordas. */
const SIDE = Space.lg;
/** A subida da barra na entrada: logo depois dos primeiros blocos da tela. */
const ATRASO_DA_BARRA_MS = 120;
const DURACAO_DA_BARRA_MS = 520;
/** Quanto o rótulo pode passar da largura do slot (metade de cada lado). */
const SOBRA = 14;

/**
 * Quanto a barra ocupa por cima do conteúdo — **fora** da safe area.
 *
 * A barra é `position: absolute`, então nada reserva esse espaço sozinho: sem somar isto ao
 * padding inferior das raízes de aba, a última linha de toda lista fica embaixo dela.
 */
export const TAB_BAR_SPACE = BAR_H + Space.sm;
/**
 * O piso de qualquer coisa FLUTUANTE sobre a barra (o FAB). `TAB_BAR_SPACE` é só a altura
 * ocupada — encostar nele deixa o botão colado na pílula.
 */
export const TAB_BAR_CLEARANCE = TAB_BAR_SPACE + Space.lg;

export interface PillTab {
  name: string;
  label: string;
  icon: SymbolViewProps['name'];
  badge?: number;
}

/**
 * A barra de abas do **Android**: uma pílula escura, e um círculo claro que desliza até o ícone
 * da aba ativa — a barra dos vídeos de referência (Suave, 16/09/2026). Substituiu o berço
 * recortado (`CurvedTabBar`).
 *
 * ## Por que só no Android
 *
 * No iOS a barra é a `NativeTabs` em Liquid Glass, que o sistema desenha melhor do que qualquer
 * coisa nossa. No Android a barra do Material 3 é uma laje reta, e é ali que um desenho próprio
 * paga. A divisão mora no primitivo (`app-tabs.android.tsx`), nunca numa tela.
 *
 * ## O ícone dentro do círculo é RECORTADO, não trocado
 *
 * O círculo é uma `View` com `overflow: hidden`, e dentro dele mora uma segunda fileira de
 * ícones — escuros — transladada ao contrário. O ícone escuro aparece exatamente onde o círculo
 * está, pixel a pixel, inclusive no meio do caminho entre duas abas. Trocar a cor por estado
 * deixaria o círculo chegar carregando o ícone errado (o estado vem da rota, a posição vem do
 * dedo), e um cross-fade por distância borraria os dois ícones no meio da troca.
 *
 * ## A mola começa no DEDO
 *
 * `activeIndex` vem dos segmentos da URL e só muda quando a tela de destino monta. A mola sai no
 * toque, na UI thread, enquanto a tela nova monta na JS thread; o efeito abaixo continua para a
 * navegação que vem de fora (notificação, link). Mola `tab`, com quique — decisão declarada em
 * §5 do design; a folga (`tab-pill.ts`) impede o círculo de sair da pílula nas pontas.
 *
 * ## A entrada
 *
 * Toda vez que o app fica visível — a abertura, a entrada numa conta, o desbloqueio — a barra
 * sobe de baixo da tela junto com a tinta saindo, como no vídeo (`useRelogioDeEntrada`).
 */
export function PillTabBar({
  tabs,
  activeIndex,
  onSelect,
}: {
  tabs: PillTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const { width: tela } = useWindowDimensions();

  const barW = tela - SIDE * 2;
  const interna = barW - PAD * 2;
  const slot = interna / tabs.length;
  const folga = folgaDaMola(slot, DIAMETRO, PAD);

  const progresso = useSharedValue(activeIndex);
  const animarPara = useCallback(
    (destino: number) => {
      'worklet';
      progresso.set(withSpring(destino, Motion.spring.tab));
    },
    [progresso]
  );
  useEffect(() => {
    animarPara(activeIndex);
  }, [activeIndex, animarPara]);

  const posicao = useDerivedValue(() => posicaoDesenhada(progresso.get(), tabs.length, folga));
  const esquerda = useDerivedValue(() => centroDoSlot(posicao.get(), slot) - DIAMETRO / 2);

  const circulo = useAnimatedStyle(() => ({ transform: [{ translateX: esquerda.get() }] }));
  const contraCirculo = useAnimatedStyle(() => ({ transform: [{ translateX: -esquerda.get() }] }));

  // A entrada: a barra sobe toda vez que o app fica visível (abertura, conta, desbloqueio) —
  // o mesmo relógio da cascata das raízes. Coberta, ela desce por baixo da camada.
  const descida = BAR_H + insets.bottom + Space.lg;
  const { relogio, assentado } = useRelogioDeEntrada(ATRASO_DA_BARRA_MS, DURACAO_DA_BARRA_MS);
  const entrada = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progressoDeEntrada(relogio.get())) * descida }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.raiz, { paddingBottom: insets.bottom + Space.sm }, assentado ? styles.noLugar : entrada]}>
      <View
        style={[
          styles.pilula,
          {
            width: barW,
            backgroundColor: theme.heroSurface,
            borderColor: theme.heroSeparator,
            boxShadow: Elevation[scheme].floating,
          },
        ]}>
        {/* A fileira de baixo: ícones claros, rótulos e os alvos de toque. */}
        <View style={styles.fileira}>
          {tabs.map((tab, i) => {
            const ativo = i === activeIndex;
            return (
              <Pressable
                key={tab.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: ativo }}
                accessibilityLabel={tab.badge ? `${tab.label}, ${tab.badge} pendentes` : tab.label}
                onPress={() => {
                  if (ativo) return;
                  Haptics.selectionAsync();
                  // A mola primeiro, a navegação depois: invertido, o `navigate` ocupa a JS
                  // thread antes de a animação existir.
                  animarPara(i);
                  onSelect(i);
                }}
                style={[styles.slot, { width: slot }]}>
                <View style={styles.lugarDoIcone}>
                  <Icon name={tab.icon} size="md" color="onHeroMuted" />
                </View>
                <Rotulo
                  label={tab.label}
                  largura={slot}
                  indice={i}
                  posicao={posicao}
                  ativo={theme.onHero}
                  inativo={theme.onHeroMuted}
                />
              </Pressable>
            );
          })}
        </View>

        {/* O círculo, com a fileira de ícones escuros recortada dentro dele. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.circulo, { backgroundColor: theme.onHero }, circulo]}>
          <Animated.View style={[styles.fileiraEscura, { width: interna }, contraCirculo]}>
            {tabs.map((tab) => (
              <View key={tab.name} style={[styles.slotEscuro, { width: slot }]}>
                <Icon name={tab.icon} size="md" color="heroSurface" />
              </View>
            ))}
          </Animated.View>
        </Animated.View>

        {/* Os contadores, por cima de tudo e parados no lugar do ícone. */}
        <View pointerEvents="none" style={styles.fileiraDeBadges}>
          {tabs.map((tab) => (
            <View key={tab.name} style={[styles.slotEscuro, { width: slot }]}>
              <Badge valor={tab.badge} />
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * O rótulo, com a cor seguindo a POSIÇÃO do círculo, não a rota. `Animated.Text` porque cor
 * animada precisa de componente animado; a escala vem de `Type.caption`.
 */
function Rotulo({
  label,
  largura,
  indice,
  posicao,
  ativo,
  inativo,
}: {
  label: string;
  largura: number;
  indice: number;
  posicao: SharedValue<number>;
  ativo: string;
  inativo: string;
}) {
  const estilo = useAnimatedStyle(() => ({
    color: interpolateColor(distanciaDaAba(posicao.get(), indice), [0, 1], [ativo, inativo]),
  }));
  return (
    // O único `maxFontSizeMultiplier` do app, e por um motivo estrutural: os cinco slots dividem
    // a largura em partes iguais e não há para onde quebrar. O teto sozinho não bastou — a
    // 384dp × 1,3 "Financeiro" virava "Financei…" —, e o `adjustsFontSizeToFit` do Android não
    // encolhe um `Animated.Text` de forma confiável. O rótulo ganha `SOBRA` além do slot: os
    // vizinhos dos nomes longos são curtos, e o texto não é recortado pela coluna.
    <Animated.Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.15}
      style={[Type.caption, styles.rotulo, { width: largura + SOBRA }, estilo]}>
      {label}
    </Animated.Text>
  );
}

/**
 * O contador da aba — "9+" no máximo.
 *
 * ⚠️ **A fonte NÃO escala aqui**, pelo mesmo motivo do `Icon`: o badge mora numa caixa de
 * geometria fixa, e a 1,3× o "9+" quebrava em duas linhas dentro de um oval alto. O texto é pedido
 * em `px / fontScale` e o RN multiplica de volta; `flexShrink: 0` impede o "+" de descer.
 */
function Badge({ valor }: { valor: number | undefined }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  if (!valor) return null;
  const escala = Platform.OS === 'android' ? Math.max(fontScale, 1) : 1;
  return (
    <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.heroSurface }]}>
      <ThemedText
        type="meta"
        themeColor="onTint"
        style={[styles.badgeTexto, { fontSize: Type.meta.fontSize / escala }]}>
        {valor > 9 ? '9+' : String(valor)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  /** O fim da subida, escrito pelo React (ver `useRelogioDeEntrada`). */
  noLugar: { transform: [{ translateY: 0 }] },
  raiz: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    // No Android o cartão da tela tem `elevation` (do `boxShadow` do `Card`), e elevação ganha de
    // ordem de irmãos: sem declarar a nossa, a lista desenharia POR CIMA da barra.
    zIndex: 10,
    elevation: 10,
  },
  pilula: {
    height: BAR_H,
    paddingHorizontal: PAD,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileira: { flexDirection: 'row', height: BAR_H },
  slot: { alignItems: 'center', paddingTop: TOPO, gap: 1 },
  lugarDoIcone: { width: DIAMETRO, height: DIAMETRO, alignItems: 'center', justifyContent: 'center' },
  circulo: {
    position: 'absolute',
    top: TOPO,
    left: PAD,
    width: DIAMETRO,
    height: DIAMETRO,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  fileiraEscura: { position: 'absolute', top: 0, left: 0, height: DIAMETRO, flexDirection: 'row' },
  slotEscuro: { height: DIAMETRO, alignItems: 'center', justifyContent: 'center' },
  fileiraDeBadges: {
    position: 'absolute',
    top: TOPO,
    left: PAD,
    right: PAD,
    height: DIAMETRO,
    flexDirection: 'row',
  },
  badge: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: 4,
    flexDirection: 'row',
    minWidth: 18,
    minHeight: 18,
    borderRadius: Radius.pill,
    borderWidth: 2,
    paddingHorizontal: Space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTexto: { flexShrink: 0 },
  rotulo: { textAlign: 'center' },
});
