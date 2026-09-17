import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { RingGauge } from '@/components/ui/ring-gauge';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { showItemActions } from '@/lib/item-actions';
import { progresso, type Passo } from '@/lib/setup-steps';

/**
 * O card de quem acabou de chegar: três passos ligados a dado real, com o anel do progresso.
 * Some sozinho quando os três estão feitos (a tela decide), e "Agora não" esconde neste aparelho.
 */
export function SetupChecklist({
  passos,
  onOpen,
  onHide,
}: {
  passos: readonly Passo[];
  onOpen: (p: Passo) => void;
  onHide: () => void;
}) {
  const theme = useTheme();
  const { feitos, total } = progresso(passos);
  const faltam = total - feitos;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.topo}>
        <RingGauge
          value={feitos / total}
          size={48}
          stroke={5}
          tone="success"
          accessibilityLabel={`${feitos} de ${total} passos feitos`}>
          <ThemedText type="code" style={tabular}>{`${feitos}/${total}`}</ThemedText>
        </RingGauge>
        <View style={styles.titulos}>
          <ThemedText type="headline">Primeiros passos</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {faltam === 1 ? 'Falta 1' : `Faltam ${faltam}`}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mais opções dos primeiros passos"
          hitSlop={(HitTarget - 32) / 2}
          onPress={() => showItemActions('Primeiros passos', [{ label: 'Agora não', icon: 'eye.slash', onPress: onHide }])}
          style={[styles.mais, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="ellipsis" size="sm" color="text" />
        </Pressable>
      </View>
      <View>
        {passos.map((p) => (
          <LinhaDoPasso key={p.id} passo={p} onOpen={onOpen} />
        ))}
      </View>
    </View>
  );
}

function LinhaDoPasso({ passo, onOpen }: { passo: Passo; onOpen: (p: Passo) => void }) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const marca = useSharedValue(passo.feito ? 1 : 0);
  const antes = useRef(passo.feito);

  // Só a TRANSIÇÃO anima (aberto → feito); montar já feito não pula (a lição do alfinete de Notas).
  useEffect(() => {
    if (antes.current === passo.feito) return;
    antes.current = passo.feito;
    const alvo = passo.feito ? 1 : 0;
    marca.set(reduzido ? alvo : withSpring(alvo, Motion.spring.encaixe));
  }, [passo.feito, marca, reduzido]);

  const preenchido = useAnimatedStyle(() => ({
    opacity: marca.get(),
    transform: [{ scale: 0.6 + marca.get() * 0.4 }],
  }));

  const conteudo = (pressed: boolean) => (
    <View style={[styles.passo, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <View style={[styles.caixa, { borderColor: passo.feito ? theme.success : theme.separator }]}>
        <Animated.View style={[styles.caixaCheia, { backgroundColor: theme.success }, preenchido]}>
          <Icon name="checkmark" size="xs" color="onTint" />
        </Animated.View>
      </View>
      <ThemedText
        type="default"
        themeColor={passo.feito ? 'textSecondary' : 'text'}
        style={[styles.passoTexto, passo.feito && styles.riscado]}>
        {passo.titulo}
      </ThemedText>
      {passo.feito ? null : <Icon name="chevron.right" size="sm" color="textSecondary" />}
    </View>
  );

  if (passo.feito) return conteudo(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={passo.titulo} onPress={() => onOpen(passo)}>
      {({ pressed }) => conteudo(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.md,
    paddingTop: Space.lg,
    paddingBottom: Space.sm,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  topo: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg },
  titulos: { flex: 1, minWidth: 0, gap: Space.half },
  mais: { width: 32, height: 32, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  passo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget + Space.sm,
    paddingHorizontal: Space.lg,
  },
  caixa: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caixaCheia: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passoTexto: { flex: 1 },
  riscado: { textDecorationLine: 'line-through' },
});
