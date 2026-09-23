import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/finance/chip';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

type Exemplo = {
  id: 'gasto' | 'lembrete' | 'nota';
  frase: string;
  icon: 'cart' | 'bell' | 'note.text';
  tipo: string;
  titulo: string;
  apoio: string;
  /** Só o lançamento tem valor — e ele é SAÍDA, então vem com o sinal. */
  cents?: number;
};

/**
 * Uma frase de cada natureza do produto: dinheiro, lembrete e nota. São as três promessas que
 * este passo escrevia em texto ("fale do seu jeito", "o app organiza", "e avisa antes") —
 * agora MOSTRADAS: a pessoa toca e vê o que a frase vira.
 */
const EXEMPLOS: readonly Exemplo[] = [
  {
    id: 'gasto',
    frase: 'Gastei 45 no mercado',
    icon: 'cart',
    tipo: 'lançamento',
    titulo: 'Mercado',
    apoio: 'alimentação · hoje',
    cents: -4500,
  },
  {
    id: 'lembrete',
    frase: 'Me lembra do aluguel todo dia 5',
    icon: 'bell',
    tipo: 'lembrete',
    titulo: 'Aluguel',
    apoio: 'todo dia 5 · 9h',
  },
  {
    id: 'nota',
    frase: 'Anota: comprar pão',
    icon: 'note.text',
    tipo: 'nota',
    titulo: 'comprar pão',
    apoio: 'em Notas',
  },
];

/** Quando o primeiro exemplo toca sozinho: depois de o passo terminar de entrar. */
const AUTOPLAY_MS = 1400;

/**
 * "Primeira frase" — o passo ① do onboarding ensina FAZENDO (23/09/2026, spec
 * `2026-09-23-onboarding-hibrido-design.md`).
 *
 * A pesquisa foi clara: tutorial em cartões na abertura não ensina (NN/g) — quem ensina é o
 * produto funcionando na frente da pessoa (Duolingo, Headspace, Things). Tocar num exemplo sobe a
 * frase num balão, do lado da pessoa, e o resultado se MONTA embaixo, do lado do app, como na
 * Conversa organizada da Hoje. É demonstração: **nada é gravado**, e o cartão diz "exemplo".
 *
 * O primeiro exemplo toca sozinho uma vez, para o passo mostrar o produto mesmo a quem só aperta
 * "Continuar". Trocar de exemplo troca a cena em cross-fade. Com Reduce Motion, tudo é fade.
 */
export function PrimeiraFrase() {
  const [escolhido, setEscolhido] = useState<Exemplo['id'] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setEscolhido((atual) => atual ?? 'gasto'), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, []);

  const exemplo = EXEMPLOS.find((e) => e.id === escolhido) ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.pilulas}>
        {EXEMPLOS.map((e) => (
          <Chip
            key={e.id}
            label={e.frase}
            selected={escolhido === e.id}
            onPress={() => {
              Haptics.selectionAsync();
              setEscolhido(e.id);
            }}
          />
        ))}
      </View>
      {/* A área tem altura mínima: a cena entra sem empurrar o rodapé do passo. */}
      <View style={styles.palco}>{exemplo ? <Cena key={exemplo.id} exemplo={exemplo} /> : null}</View>
    </View>
  );
}

function Cena({ exemplo }: { exemplo: Exemplo }) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  // O cartão "pousa" ~300 ms depois do balão: é aí que vai o háptico, não no toque.
  const pouso = reduzido ? 0 : Motion.duration.base + 120;

  useEffect(() => {
    const t = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), pouso);
    return () => clearTimeout(t);
  }, [pouso]);

  const balaoEntra = reduzido
    ? FadeIn.duration(Motion.duration.base)
    : FadeInDown.duration(Motion.duration.base).easing(Motion.easing.out);
  const cartaoEntra = reduzido
    ? FadeIn.duration(Motion.duration.base)
    : FadeInUp.delay(pouso).duration(Motion.duration.slow).easing(Motion.easing.out);

  return (
    <Animated.View exiting={FadeOut.duration(Motion.duration.fast)} style={styles.cena}>
      <Animated.View
        entering={balaoEntra}
        style={[styles.balao, { backgroundColor: theme.tintFill }]}
        accessibilityLabel={`Você escreve: ${exemplo.frase}`}>
        {/* `flexShrink: 0`: texto dentro de `entering` encolhido não se remede (design.md §3). */}
        <ThemedText style={[styles.semEncolher, { color: theme.onTint }]}>{exemplo.frase}</ThemedText>
      </Animated.View>

      <Animated.View
        entering={cartaoEntra}
        accessible
        accessibilityLabel={`O app organiza: ${exemplo.tipo}, ${exemplo.titulo}, ${exemplo.apoio}. É um exemplo, nada foi salvo.`}
        style={[styles.cartao, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
        <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
          <Icon name={exemplo.icon} size="md" color="text" />
        </View>
        <View style={styles.textos}>
          <ThemedText type="meta" themeColor="textSecondary" style={styles.semEncolher}>
            {`exemplo · ${exemplo.tipo}`}
          </ThemedText>
          <ThemedText type="headline" style={styles.semEncolher}>
            {exemplo.titulo}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.semEncolher}>
            {exemplo.apoio}
          </ThemedText>
        </View>
        {exemplo.cents != null ? (
          <Money cents={exemplo.cents} variant="headline" tone="auto" concealable={false} />
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.lg },
  pilulas: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  palco: { minHeight: HitTarget * 4 },
  cena: { gap: Space.md },
  balao: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.lg,
    borderBottomRightRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  cartao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  selo: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: { flex: 1, minWidth: 0, gap: Space.half },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
});
