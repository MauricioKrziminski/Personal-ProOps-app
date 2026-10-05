import { useIsFocused } from 'expo-router';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ToastOutlet } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { classifyWindow } from '@/design/adaptive-window';
import { abaixoDoDialogo, tabletSheetFrame } from '@/design/adaptive-sheet';
import { Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { travaNaTela } from '@/lib/trava-na-tela';

const TabletSheetContext = createContext(false);
/**
 * Do fundo da folha até a base da janela — o que o teclado cobre sem cobrir a folha. `null` no
 * formSheet do iPad, que o próprio UIKit move.
 */
const AbaixoDaFolha = createContext<number | null>(0);

/**
 * O corpo de formulário que nasceu para uma folha, montado numa TELA modal (`/finance/lancar`):
 * lá não há folha para descontar o pé, e a rolagem leva a moldura da tela — a mesma do lançamento.
 */
export const FormularioEmTela = createContext(false);

/**
 * A moldura de formulário em tela cheia: calha, largura máxima e o pé seguro (a barra de gestos ou
 * de tarefas). Os três corpos do formulário único usam ESTA, para trocar de tipo não mexer na tela.
 * As laterais seguras vêm do contêiner da pilha (`Screen scroll={false}`).
 */
export function molduraEmTela(abaixo: number) {
  return {
    paddingTop: Space.md,
    paddingHorizontal: Space.lg,
    paddingBottom: abaixo + Space.xxl,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  } as const;
}

/**
 * A rolagem de uma folha com campo. É a MESMA do `Screen` (`KeyboardAwareScrollView`): com o
 * teclado aberto, o campo tocado sobe até ficar ACIMA dele com folga, e a rolagem alcança o fim
 * do formulário. Com o `ScrollView` comum a folha encolhia e o campo parava colado na borda do
 * teclado — no tablet, com a dica embaixo dele escondida (medido em 26/09/2026).
 *
 * ⚠️ **Ela é o ÚNICO mecanismo de teclado da folha.** A rolagem abre no fim um espaço do
 * tamanho do teclado, contando que o fundo dela está na base da tela. Com o
 * `KeyboardAvoidingView` do `Sheet` encolhendo a folha por cima, os dois somavam: rolando até o
 * fim com o teclado aberto sobrava um vão vazio da altura do teclado (tablet, 27/09/2026). A
 * folha não encolhe mais; o que a rolagem desconta é a distância do fundo dela até a base da
 * janela (`AbaixoDaFolha`: a borda segura do celular, o vão sob o diálogo centrado do tablet) — a
 * mesma régua do `extraKeyboardSpace` negativo da documentação. Por isso ela é o ÚLTIMO filho da
 * folha, e o fundo dela é o fundo da folha.
 *
 * A distância é CONTA, não medida: `measureInWindow` no iPhone devolveu a folha 62pt mais baixa
 * durante a subida do teclado, e o fim do formulário ficou atrás dele. E a conta vale já no
 * primeiro quadro, quando o campo com `autoFocus` abre o teclado na montagem.
 */
export function SheetScroll(props: ScrollViewProps & { children?: React.ReactNode }) {
  const abaixo = useContext(AbaixoDaFolha);
  const emTela = useContext(FormularioEmTela);
  const insets = useSafeAreaInsets();
  if (emTela) {
    return (
      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        {...props}
        contentContainerStyle={[props.contentContainerStyle, molduraEmTela(insets.bottom)]}
      />
    );
  }
  if (abaixo === null) {
    // formSheet do iPad: o UIKit sobe a folha para fora do teclado (e deitado ela pode não caber).
    // Só o iOS sabe onde ela parou; o ajuste nativo mede a sobreposição de verdade e rola até o
    // campo. É ramo só de iOS — no Android a prop não faria nada.
    return <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" {...props} />;
  }
  return (
    <KeyboardAwareScrollView
      bottomOffset={Space.xl}
      extraKeyboardSpace={-abaixo}
      keyboardShouldPersistTaps="handled"
      {...props}
    />
  );
}

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
 * Envolve a moldura e a área segura. **O cabeçalho é obrigatório e é o `TaskHeader`** — a rolagem
 * continua sendo decisão de cada tela, porque ela é diferente de verdade entre um form de conta e
 * uma lista de tags.
 *
 * ⚠️ **O respiro do topo saiu daqui** (13/09/2026) e foi para o `TaskHeader`, que é o primeiro
 * filho dos 22 sheets E das 3 telas modais — as duas superfícies precisavam do mesmo inset, e
 * mantê-lo aqui obrigaria a tela modal a reimplementá-lo. Somar nos dois lugares dobra o padding.
 *
 * ⚠️ **O teclado é da rolagem, `SheetScroll`** — toda folha com campo tem uma, e ela é a ÚNICA
 * peça que reage ao teclado. Até 27/09/2026 a folha também encolhia (`KeyboardAvoidingView`), e
 * os dois mecanismos somavam: ver `SheetScroll`. O teclado passa POR CIMA da parte de baixo da
 * folha (no tablet, do diálogo), e a rolagem desconta exatamente o que ficou coberto.
 *
 * ⚠️ **A área segura mora aqui também** (26/09/2026, Galaxy Tab deitado: *"a parte de baixo do
 * modal fica sobreposta pela barra de tarefas"*). O `Modal` desenha de ponta a ponta, por baixo da
 * barra de status, da de navegação e da barra de TAREFAS do tablet — que é inset de baixo como a
 * de navegação. Cada folha somava (ou não) o seu `insets.bottom`, e o diálogo do tablet media o
 * quadro pela janela inteira. Agora:
 * - **diálogo do tablet**: o quadro cabe dentro da área segura (`tabletSheetFrame` com os
 *   insets) e o fundo escurecido deixa as quatro bordas livres;
 * - **folha do celular** (e a `pageSheet` do iPhone): a borda de baixo e as laterais (recorte da
 *   câmera deitado) viram padding da folha — que a `SheetScroll` mede e desconta do teclado;
 * - o `formSheet` do iPad é centrado e não encosta em borda nenhuma: não soma nada.
 * O conteúdo de cada folha NÃO soma `insets` — somaria duas vezes.
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
  const modalVisible = visible && focused;
  const [presentation, setPresentation] = useState({ visible: modalVisible, tablet });
  // No Android, trocar animationType recria o Dialog nativo. A apresentação pertence à
  // abertura, não à largura de cada render: só a próxima abertura adota outro tipo de janela.
  // Ajustar no render evita abrir primeiro com a apresentação antiga e recriá-la num efeito.
  if (presentation.visible !== modalVisible || (!modalVisible && presentation.tablet !== tablet)) {
    setPresentation({ visible: modalVisible, tablet });
  }
  const iosTablet = Platform.OS === 'ios' && presentation.tablet;
  const androidTabletPresentation = Platform.OS === 'android' && presentation.tablet;
  // Transparência atualiza as flags do Dialog existente, sem recriá-lo. Acompanha o fundo.
  const androidTablet = Platform.OS === 'android' && tablet;
  const insets = useSafeAreaInsets();
  const frame = tabletSheetFrame(width, height, insets);
  const abaixo = androidTablet ? abaixoDoDialogo(width, height, insets) : iosTablet ? null : insets.bottom;

  // A tela anterior pode continuar montada no Stack depois de um deep link ou logout. Um
  // Modal nativo sobrevive à troca da rota por baixo dele; o foco do navegador o esconde no
  // mesmo render, e em seguida limpamos o estado para que não reapareça ao voltar.
  useEffect(() => {
    if (!focused && visible) onClose();
  }, [focused, visible, onClose]);

  return (
    <Modal
      visible={modalVisible}
      animationType={androidTabletPresentation ? 'fade' : 'slide'}
      presentationStyle={iosTablet ? 'formSheet' : androidTabletPresentation ? 'overFullScreen' : 'pageSheet'}
      transparent={androidTablet}
      supportedOrientations={iosTablet ? ['portrait', 'landscape'] : undefined}
      // Voltar com a trava do app na tela não fecha a folha que ela cobre.
      onRequestClose={() => {
        if (!travaNaTela()) onClose();
      }}>
      {/* O `Modal` é outra janela: gesto do gesture-handler (arrastar um card) precisa da raiz aqui dentro. */}
      <GestureHandlerRootView style={styles.raizDoGesto}>
        {/* Uma folha aberta de dentro do formulário em tela volta a ser folha. */}
        <FormularioEmTela.Provider value={false}>
          <AbaixoDaFolha.Provider value={abaixo}>
            {/* A moldura adapta o layout sem trocar a árvore que possui o formulário. */}
            <View style={[styles.raizDoGesto, androidTablet && { backgroundColor: theme.overlay }]}>
              {androidTablet && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fechar janela"
                  onPress={onClose}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <View
                pointerEvents={androidTablet ? 'box-none' : undefined}
                style={androidTablet ? [
                  styles.dialogHost,
                  {
                    paddingTop: insets.top + Space.lg,
                    paddingBottom: insets.bottom + Space.lg,
                    paddingLeft: insets.left + Space.lg,
                    paddingRight: insets.right + Space.lg,
                  },
                ] : styles.raizDoGesto}>
                <TabletSheetContext.Provider value={androidTablet}>
                  <View
                    accessibilityViewIsModal={androidTablet || undefined}
                    style={[
                      androidTablet ? styles.dialogPanel : styles.sheet,
                      { backgroundColor: theme.groupedBackground },
                      androidTablet ? {
                        width: frame.width,
                        maxHeight: frame.height,
                      } : {
                        paddingBottom: iosTablet ? 0 : insets.bottom,
                        paddingLeft: iosTablet ? 0 : insets.left,
                        paddingRight: iosTablet ? 0 : insets.right,
                      },
                    ]}>
                    {children}
                    <ToastOutlet />
                  </View>
                </TabletSheetContext.Provider>
              </View>
            </View>
          </AbaixoDaFolha.Provider>
        </FormularioEmTela.Provider>
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
