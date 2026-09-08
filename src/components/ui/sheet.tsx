import { Modal, Platform, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
});
