import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { useCoresSuaves, useOpacidadeSuave } from '@/components/motion/cores-suaves';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { NOTE_COLOR_NAMES, type NoteColorName } from '@/constants/theme';
import { noteInk, notePalette } from '@/design/note-colors';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

/**
 * Escolher a cor de uma nota ou de uma pasta.
 *
 * ## A amostra é o cartão em miniatura
 *
 * A cor pinta o cartão INTEIRO e o editor desde 25/09/2026 (`design.md` §2b). O anel da amostra
 * tem o fundo EXATO que o cartão vai ter (`notePalette`), e o disco no meio a tinta cheia — quem
 * escolhe vê a cor que vai morar na lista, não um tom que não aparece em lugar nenhum.
 *
 * ⚠️ "Sem cor" é a PRIMEIRA opção e é o padrão. Uma paleta sem saída obrigaria a escolher uma
 * cor para toda nota nova, e a maioria das notas não quer cor nenhuma.
 *
 * ## Três por linha, e cada uma com o NOME (14/09/2026)
 *
 * ⚠️ Antes as amostras eram discos nus embrulhando por largura — davam 6 numa linha e 3 órfãs na
 * outra, o que lê como acidente, não como grade. Nove opções (sem cor + oito) fecham 3×3 exato
 * em qualquer largura, e `33,333%` por célula não depende de medir a tela.
 *
 * O nome embaixo não é enfeite: **é o vocabulário que o agente entende**. Quem leu "turquesa"
 * aqui sabe que dá para mandar *"pinta a lista de turquesa"* no WhatsApp — e é a única parte da
 * interface que ensina isso. (O agente também aceita o apelido do dia a dia, "azul" e "verde",
 * mas o nome canônico é o que fecha a volta com a tela.)
 */
export function ColorPicker({
  visible,
  value,
  title = 'Cor',
  onClose,
  onPick,
}: {
  visible: boolean;
  value: NoteColorName | null;
  title?: string;
  onClose: () => void;
  onPick: (color: NoteColorName | null) => void;
}) {
  const escolher = (cor: NoteColorName | null) => {
    onPick(cor);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader title={title} onClose={onClose} />
      <View style={styles.corpo}>
        <GradeDeCores value={value} onPick={escolher} />
      </View>
    </Sheet>
  );
}

/**
 * A grade de "Sem cor" + as oito, INLINE — para quem já mora numa folha (a da categoria), onde
 * abrir o `ColorPicker` seria folha dentro de folha (`Modal` dentro de `Modal` no Android).
 */
export function GradeDeCores({
  value,
  onPick,
}: {
  value: NoteColorName | null;
  onPick: (color: NoteColorName | null) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const escolher = (cor: NoteColorName | null) => {
    Haptics.selectionAsync();
    onPick(cor);
  };
  return (
    <View style={styles.grade}>
      <Amostra
        selecionada={value === null}
        fundo={theme.backgroundElement}
        tinta={theme.textSecondary}
        label="Sem cor"
        vazia
        onPress={() => escolher(null)}
      />
      {NOTE_COLOR_NAMES.map((cor) => (
        <Amostra
          key={cor}
          selecionada={value === cor}
          fundo={notePalette(cor, scheme, theme)?.surface ?? theme.backgroundElement}
          tinta={noteInk(cor, scheme) ?? theme.textSecondary}
          label={cor[0].toUpperCase() + cor.slice(1)}
          onPress={() => escolher(cor)}
        />
      ))}
    </View>
  );
}

function Amostra({
  selecionada,
  fundo,
  tinta,
  label,
  vazia = false,
  onPress,
}: {
  selecionada: boolean;
  fundo: string;
  tinta: string;
  label: string;
  vazia?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const anel = useCoresSuaves({ backgroundColor: fundo, borderColor: selecionada ? tinta : theme.cardBorder });
  const texto = useCoresSuaves({ color: selecionada ? theme.text : theme.textSecondary });
  const disco = useOpacidadeSuave(selecionada ? 0 : 1);
  const check = useOpacidadeSuave(selecionada ? 1 : 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selecionada }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.alvo}>
      {({ pressed }) => (
        <>
        <Animated.View
          style={[
            styles.anel,
            anel,
            { opacity: pressed ? 0.6 : 1 },
          ]}>
            <Animated.View
              style={[
                styles.disco,
                disco,
                // "Sem cor" mostra o contorno vazio: um disco cinza leria como uma nona cor.
                vazia
                  ? { borderWidth: StyleSheet.hairlineWidth, borderColor: tinta }
                  : { backgroundColor: tinta },
              ]}
            />
            <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, styles.check, check]}>
              <Icon name="checkmark" size="md" color="text" />
            </Animated.View>
        </Animated.View>
        {/* Sem `textTransform: 'capitalize'`: ele sobe a inicial de CADA palavra e escrevia
            "Sem Cor". A maiúscula vem de quem monta o rótulo. */}
        <Animated.Text key={fontScale} android_hyphenationFrequency="none" style={[Type.caption, styles.rotulo, texto]}>
          {label}
        </Animated.Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.lg, paddingHorizontal: Space.lg, paddingBottom: Space.xxxl },
  /** Sem `gap` no contêiner: com células em porcentagem ele empurra a terceira para a linha
      seguinte. O respiro é `paddingVertical` de cada célula. */
  grade: { flexDirection: 'row', flexWrap: 'wrap' },
  alvo: { width: '33.333%', alignItems: 'center', gap: Space.sm, paddingVertical: Space.md },
  anel: {
    width: HitTarget + 8,
    height: HitTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: 2,
  },
  disco: { width: 20, height: 20, borderRadius: Radius.pill },
  check: { alignItems: 'center', justifyContent: 'center' },
  rotulo: { flexShrink: 0 },
});
