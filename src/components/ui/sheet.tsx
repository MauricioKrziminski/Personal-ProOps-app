import { useIsFocused } from 'expo-router';
import { createContext, useContext, useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { ToastOutlet } from '@/components/ui/toast';
import { classifyWindow } from '@/design/adaptive-window';
import { tabletSheetFrame } from '@/design/adaptive-sheet';
import { useTheme } from '@/hooks/use-theme';

const TabletSheetContext = createContext(false);

/** TaskHeader omits the Android status-bar inset only inside a centered tablet dialog. */
export function useTabletSheetContext() {
  return useContext(TabletSheetContext);
}

/**
 * Sheet modal compartilhado: pageSheet no telefone, formSheet no iPad e diálogo limitado
 * no Android tablet. Conteúdo e ações continuam pertencendo a cada tarefa.
 *
 * Existiam TREZE cópias do mesmo par `<Modal><View style={[styles.sheet, { backgroundColor }]}>`,
 * uma por tela, e todas carregavam o mesmo defeito: no iOS o `pageSheet` desce sozinho abaixo da
 * status bar, mas **no Android o `Modal` ocupa a tela inteira** e o cabeçalho nasce por cima do
 * relógio e dos ícones de bateria. Em Patrimônio isso deixava o **"Salvar" atrás do ícone de
 * wifi** — ação primária inalcançável, num sheet que grava no banco.
 *
 * Consertar treze vezes era garantir que a décima quarta tela nascesse errada. O respiro do topo
 * e a apresentação da janela ficam centralizados aqui; no tablet Android, o painel limitado e
 * o fundo escurecido deixam a tarefa contextual sem esticar os campos por toda a tela.
 *
 * Envolve a moldura e o TECLADO. **O cabeçalho é obrigatório e é o `TaskHeader`** — a rolagem
 * continua sendo decisão de cada tela, porque ela é diferente de verdade entre um form de conta e
 * uma lista de tags.
 *
 * ⚠️ **O respiro do topo saiu daqui** (13/09/2026) e foi para o `TaskHeader`, que é o primeiro
 * filho dos 22 sheets E das 3 telas modais — as duas superfícies precisavam do mesmo inset, e
 * mantê-lo aqui obrigaria a tela modal a reimplementá-lo. Somar nos dois lugares dobra o padding.
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
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const tablet = classifyWindow(width) !== 'compact';
  const iosTablet = Platform.OS === 'ios' && tablet;
  const androidTablet = Platform.OS === 'android' && tablet;
  const frame = tabletSheetFrame(width, height);

  // A tela anterior pode continuar montada no Stack depois de um deep link ou logout. Um
  // Modal nativo sobrevive à troca da rota por baixo dele; o foco do navegador o esconde no
  // mesmo render, e em seguida limpamos o estado para que não reapareça ao voltar.
  useEffect(() => {
    if (!focused && visible) onClose();
  }, [focused, visible, onClose]);

  return (
    <Modal
      visible={visible && focused}
      animationType={androidTablet ? 'fade' : 'slide'}
      presentationStyle={iosTablet ? 'formSheet' : androidTablet ? 'overFullScreen' : 'pageSheet'}
      transparent={androidTablet}
      supportedOrientations={iosTablet ? ['portrait', 'landscape'] : undefined}
      onRequestClose={onClose}>
      {/* O `Modal` é outra janela: gesto do gesture-handler (arrastar um card) precisa da raiz aqui dentro. */}
      <GestureHandlerRootView style={styles.raizDoGesto}>
        {androidTablet ? (
        <KeyboardAvoidingView
          behavior="padding"
          automaticOffset
          style={[styles.dialogHost, { backgroundColor: theme.overlay }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar janela"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <TabletSheetContext.Provider value>
            <View
              accessibilityViewIsModal
              style={[
                styles.dialogPanel,
                {
                  width: frame.width,
                  maxHeight: frame.height,
                  backgroundColor: theme.groupedBackground,
                },
              ]}>
              {children}
              <ToastOutlet />
            </View>
          </TabletSheetContext.Provider>
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.sheet}>
            {children}
          </KeyboardAvoidingView>
          <ToastOutlet />
        </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  raizDoGesto: { flex: 1 },
  sheet: {
    flex: 1,
  },
  dialogHost: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialogPanel: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
});
