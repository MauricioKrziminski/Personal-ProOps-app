import { Modal, Platform, StyleSheet, View } from 'react-native';
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
 * Envolve só a moldura: cabeçalho, rolagem e teclado continuam sendo decisão de cada tela, porque
 * são diferentes de verdade entre um form de conta e uma lista de tags.
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
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
});
