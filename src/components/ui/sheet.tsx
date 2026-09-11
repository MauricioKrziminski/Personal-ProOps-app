import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Sheet modal — o único caminho para `Modal presentationStyle="pageSheet"` no app.
 *
 * Existiam TREZE cópias do mesmo par `<Modal><View style={[styles.sheet, { backgroundColor }]}>`,
 * uma por tela, e todas carregavam o mesmo defeito: no iOS o `pageSheet` desce sozinho abaixo da
 * status bar, mas **no Android o `Modal` ocupa a tela inteira** e o cabeçalho nasce por cima do
 * relógio e dos ícones de bateria. Em Patrimônio isso deixava o **"Salvar" atrás do ícone de
 * wifi** — ação primária inalcançável, num sheet que grava no banco.
 *
 * Consertar treze vezes era garantir que a décima quarta tela nascesse errada. A diferença entre
 * as plataformas é um VALOR (o respiro do topo) e a árvore é a mesma, então ela mora aqui dentro
 * por `Platform.select` — mecanismo 2 de `frontend.md`.
 *
 * Envolve a moldura e o TECLADO; cabeçalho e rolagem continuam sendo decisão de cada tela, porque
 * são diferentes de verdade entre um form de conta e uma lista de tags.
 *
 * ⚠️ **O teclado mora aqui porque dez telas abrem sheet com formulário dentro.** Nenhuma delas
 * tratava o teclado: tocar num campo abria o teclado POR CIMA dele e a pessoa digitava às cegas.
 * Resolver dez vezes é garantir que a décima primeira nasça errada — a mesma lição do respiro do
 * topo, logo acima.
 *
 * `KeyboardAvoidingView` do `react-native-keyboard-controller`, não o do React Native: o `Modal`
 * do RN é uma JANELA separada no Android, e o da plataforma calcula o deslocamento a partir da
 * janela principal. `automaticOffset` existe exatamente para isto — ele mede onde a view está de
 * verdade, contando header de navegação e modal.
 *
 * `behavior="padding"` encolhe o container, e AQUI isso é o certo (ao contrário da tela de login,
 * onde derrubava tudo): o cabeçalho tem altura fixa e o corpo é um `ScrollView` de `flex: 1`, então
 * encolher é exatamente o que o `adjustResize` nativo faria — o cabeçalho com Cancelar/Salvar fica
 * onde está e quem cede altura é a rolagem.
 */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  /** Arrastar para baixo (iOS) e o botão voltar (Android) passam por aqui. */
  onClose: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.groupedBackground,
            paddingTop: Platform.OS === 'android' ? insets.top : 0,
          },
        ]}>
        <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.sheet}>
          {children}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/**
 * O cabeçalho de um `Sheet` — **pegador, título e o botão de fechar**, com o respiro que dez
 * cópias à mão não tinham.
 *
 * ⚠️ **Ele existe pelo mesmo motivo que o `Sheet` existiu**: eram ~10 cabeçalhos escritos à mão
 * (`sheetHead`, `sheetHeader`, `horizonteTopo`), com três nomes, dois paddings verticais
 * diferentes e um contrapeso de largura chutada para "centralizar" o título. A queixa do dono do
 * produto foi sobre o resultado disso: *"o botão fechar horrivelmente feio, colado com o top, sem
 * padding/margin"* — no Android o `Modal` começa no topo da janela, então um `paddingVertical`
 * pequeno cola o botão na status bar.
 *
 * ## O desenho
 *
 * O título fica à ESQUERDA e o fechar é um X circular à direita. O padrão antigo
 * (`Cancelar` · título centrado · contrapeso invisível) gastava a linha inteira para centrar uma
 * palavra e ainda exigia que cada tela adivinhasse a largura do contrapeso — se ela errasse, o
 * título ficava torto. Alinhado à esquerda, o título é o primeiro que se lê, o X é onde a mão já
 * procura, e não há nada para espelhar.
 *
 * O **pegador** (a barrinha) não é enfeite: no iOS o `pageSheet` fecha arrastando para baixo e
 * nada na tela dizia isso; ele também é o que dá ao topo um começo — sem ele, o título nasce
 * grudado na borda por mais padding que se ponha.
 */
export function SheetHeader({
  title,
  subtitle,
  onClose,
  action,
}: {
  title: string;
  /** Uma linha de estado sob o título ("de hoje até 10/12/2026"). */
  subtitle?: string;
  onClose: () => void;
  /** Ação primária do sheet (Salvar), à esquerda do X. */
  action?: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={styles.head}>
      <View style={[styles.grabber, { backgroundColor: theme.separator }]} />
      <View style={styles.headRow}>
        <View style={styles.headText}>
          <ThemedText type="subtitle">{title}</ThemedText>
          {subtitle ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {action}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          hitSlop={Space.sm}
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Icon name="xmark" size="sm" color="textSecondary" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  head: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    paddingBottom: Space.md,
    gap: Space.md,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    alignSelf: 'center',
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  headText: {
    flex: 1,
    gap: Space.half,
  },
  /*
    32 de geometria com `hitSlop` de 8 fecha os 44pt de alvo (design.md §11) sem o disco pesar
    como um botão de ação — ele é a saída, não o que a pessoa veio fazer aqui.
  */
  close: {
    width: HitTarget - Space.md,
    height: HitTarget - Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
