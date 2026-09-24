import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Motion, Radius, Space } from '@/design/tokens';
import { dispensarDica, useDica } from '@/hooks/use-dicas';
import { useTheme } from '@/hooks/use-theme';
import { DICAS, type DicaId, type Tela } from '@/lib/dicas';

/**
 * A dica no lugar (spec `2026-09-24-dicas-e-guia-design.md`): um card pequeno, colado no que ele
 * explica, com um bico apontando para ele. Não escurece, não bloqueia, não flutua — é conteúdo
 * da tela, como o TipKit inline. Some no "Entendi" ou quando a pessoa usa o recurso
 * (`usarDica`, chamado pelo próprio gesto).
 *
 * Quem decide SE aparece é `useDica` (uma por tela, a da vez). A tela só a põe onde o alvo está —
 * e só no conteúdo carregado, nunca no esqueleto.
 */
export function Dica({ id, tela, bico = 'cima' }: { id: DicaId; tela: Tela; bico?: 'cima' | 'baixo' }) {
  const theme = useTheme();
  const visivel = useDica(id, tela);
  if (!visivel) return null;
  const dica = DICAS.find((d) => d.id === id)!;
  const cor = { backgroundColor: theme.surface, borderColor: theme.cardBorder };

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.duration.base)}
      exiting={FadeOut.duration(Motion.duration.fast)}
      accessibilityRole="summary"
      style={bico === 'cima' ? styles.comBicoEmCima : styles.comBicoEmBaixo}>
      <View style={[styles.card, cor]}>
        <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
          <Icon name={dica.icone as IconName} size="sm" color="text" />
        </View>
        {/* `flexShrink: 0` no texto: dentro de `entering`, encolhido não se remede (design.md §3). */}
        <View style={styles.coluna}>
          <ThemedText type="small" style={styles.texto}>
            {dica.texto}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Entendi, fechar a dica"
            hitSlop={Space.md}
            onPress={() => {
              Haptics.selectionAsync();
              dispensarDica(id, tela);
            }}
            style={({ pressed }) => [styles.entendi, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="smallBold" style={styles.sublinhado}>
              Entendi
            </ThemedText>
          </Pressable>
        </View>
      </View>
      {/*
        O bico é um quadrado girado DEPOIS do card, com borda só nos dois lados de fora: a metade
        de dentro tem a cor do card e apaga o contorno dele ali, sem um traço cruzando a base.
      */}
      <View style={[styles.bico, bico === 'cima' ? styles.bicoCima : styles.bicoBaixo, cor]} />
    </Animated.View>
  );
}

const BICO = 12;
/** Girado 45°, o quadrado ocupa a diagonal: a ponta encosta na borda do contêiner. */
const DIAGONAL = BICO * Math.SQRT2;
const SELO = 32;

const styles = StyleSheet.create({
  comBicoEmCima: { paddingTop: DIAGONAL / 2 },
  comBicoEmBaixo: { paddingBottom: DIAGONAL / 2 },
  bico: {
    position: 'absolute',
    // Alinhado ao selo: é ele que aponta para o alvo.
    left: Space.md + SELO / 2 - BICO / 2,
    width: BICO,
    height: BICO,
    transform: [{ rotate: '45deg' }],
  },
  bicoCima: { top: (DIAGONAL - BICO) / 2, borderTopWidth: 1, borderLeftWidth: 1 },
  bicoBaixo: { bottom: (DIAGONAL - BICO) / 2, borderBottomWidth: 1, borderRightWidth: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  selo: {
    width: SELO,
    height: SELO,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coluna: { flex: 1, minWidth: 0, gap: Space.xs },
  texto: { flexShrink: 0, maxWidth: '100%' },
  entendi: { alignSelf: 'flex-start', minHeight: 24, justifyContent: 'center' },
  sublinhado: { textDecorationLine: 'underline' },
});
