import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { NOTE_COLOR_NAMES, type NoteColorName } from '@/constants/theme';
import { noteInk, noteTile } from '@/design/note-colors';
import { HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

/**
 * Escolher a cor de uma nota ou de uma pasta.
 *
 * ## Por que a amostra é um DISCO e não um quadrado preenchido
 *
 * A cor aqui não pinta superfície nenhuma — ela vai virar um trilho de 3px na borda do cartão e
 * o fundo do ladrilho do ícone da pasta. Uma grade de quadrados grandes prometeria um cartão
 * inteiro colorido, que é justamente o que este design recusou (`design.md` §2b: a cor é
 * conteúdo do usuário e vive em geometria fechada).
 *
 * O disco mostra a tinta cheia, que é o que o trilho usa, dentro de um anel do mesmo tom — a
 * mesma relação tinta/superfície que o ladrilho terá.
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
  const theme = useTheme();
  const scheme = useScheme();

  const escolher = (cor: NoteColorName | null) => {
    Haptics.selectionAsync();
    onPick(cor);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader title={title} onClose={onClose} />
      <View style={styles.corpo}>
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
              fundo={noteTile(cor, theme.surface, scheme) ?? theme.backgroundElement}
              tinta={noteInk(cor, scheme) ?? theme.textSecondary}
              label={cor[0].toUpperCase() + cor.slice(1)}
              onPress={() => escolher(cor)}
            />
          ))}
        </View>
        <ThemedText type="footnote" themeColor="textSecondary">
          A cor marca a nota na lista e o ícone da pasta. Ela não muda mais nada.
        </ThemedText>
      </View>
    </Sheet>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selecionada }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.alvo}>
      {({ pressed }) => (
        <>
        <View
          style={[
            styles.anel,
            {
              backgroundColor: fundo,
              borderColor: selecionada ? tinta : theme.cardBorder,
              opacity: pressed ? 0.6 : 1,
            },
          ]}>
          {selecionada ? (
            <Animated.View entering={FadeIn.duration(Motion.duration.fast)}>
              <Icon name="checkmark" size="md" color="text" />
            </Animated.View>
          ) : (
            <View
              style={[
                styles.disco,
                // "Sem cor" mostra o contorno vazio: um disco cinza leria como uma nona cor.
                vazia
                  ? { borderWidth: StyleSheet.hairlineWidth, borderColor: tinta }
                  : { backgroundColor: tinta },
              ]}
            />
          )}
        </View>
        {/* Sem `textTransform: 'capitalize'`: ele sobe a inicial de CADA palavra e escrevia
            "Sem Cor". A maiúscula vem de quem monta o rótulo. */}
        <ThemedText type="caption" themeColor={selecionada ? 'text' : 'textSecondary'}>
          {label}
        </ThemedText>
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
});
