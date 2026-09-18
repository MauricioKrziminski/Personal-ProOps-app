import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Icon } from '@/components/ui/icon';
import { useTabletSheetContext } from '@/components/ui/sheet';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * O cabeçalho de uma TAREFA — sheet e tela modal, o mesmo desenho.
 *
 * **✕ à esquerda, título no meio, ação primária à direita.** Uma regra só, para as duas
 * superfícies (decisão do dono do produto, 13/09/2026).
 *
 * ## O que ele substitui
 *
 * Três mecanismos e SEIS implementações, com o ✕ em lados diferentes:
 *
 * - `SheetHeader` (18 sites): ✕ à DIREITA;
 * - `modalOptions` no `_layout.tsx` (3 telas): ✕ à esquerda, **sem um único token de espaço** —
 *   um `<Pressable hitSlop={12}>` cru. Era a queixa literal, *"ta colado o titulo no botao de
 *   fechar"*;
 * - quatro cabeçalhos escritos à mão, com quatro paddings verticais, título em 15/21 contra os
 *   20/26 do primitivo, ✕ de 24px contra 16px, e **dois contrapesos mortos de 72px** — os mesmos
 *   que a doc do `Sheet` já dizia ter removido.
 *
 * ## Por que a tela modal não usa mais o header do navegador
 *
 * ⚠️ `react-native-screens` (`ScreenStackHeaderConfig.kt:374-382`) roda `toolbar.title = null`
 * sempre que existe um subview `LEFT` customizado. Com o ✕ ali, as três telas modais renderizavam
 * no Android **sem título nenhum** — "Novo lançamento" e "Editar lançamento" eram a mesma tela na
 * tela. Não era ajuste de padding; era título deletado. Elas passam a `headerShown: false` e
 * desenham este cabeçalho no conteúdo.
 *
 * Custo aceito: no iOS essas três perdem a palavra "Cancelar" e a pílula de vidro do
 * `Stack.Toolbar` no "Salvar". É o que "uma chrome só" significa — os 18 sheets já eram assim.
 *
 * ⚠️ **Tela EMPURRADA não usa isto.** Lá o header é do navegador, com `<Stack.Title>` e large
 * title (`design.md` §8), e o `ScrollView` precisa ser a raiz para o título colapsar.
 *
 * ## O respiro do topo mora aqui
 *
 * ⚠️ Ele saiu do `Sheet` e veio para cá porque este componente é o primeiro filho dos 22 sheets
 * **e** das 3 telas modais. No iOS as duas superfícies são o mesmo `pageSheet`, que já começa
 * abaixo da status bar; no Android tanto o `Modal` quanto o `StackPresentation.MODAL` ocupam a
 * janela inteira, e sem o inset o ✕ nasce em cima do relógio. É a mesma conta de antes — mudou de
 * dono, não de valor.
 *
 * `telaCheia` é o terceiro caso: uma tela EMPURRADA sem header do navegador (a Carteira), que
 * nas duas plataformas começa no topo da janela — o inset entra também no iOS.
 *
 * O **pegador** fica nas duas: as duas fecham arrastando para baixo no iOS, e ele é a única coisa
 * na tela que diz isso. (No Android ele é decorativo — já era, nos 22 sheets.)
 */
export function TaskHeader({
  title,
  subtitle,
  onClose,
  action,
  telaCheia = false,
}: {
  title: string;
  /** Uma linha de estado sob o título ("de hoje até 10/12/2026"). */
  subtitle?: string;
  onClose: () => void;
  /**
   * Ação primária da tarefa (Salvar, Criar, Somar), à DIREITA.
   *
   * ⚠️ Continua sendo um `ReactNode` com este nome porque `simple-finance-ui.test.ts` visita
   * `node.props.action` para achar o "Salvar" — seis asserções ficam cegas se virar objeto.
   */
  action?: React.ReactNode;
  /** Tela cheia sem header do navegador: soma a safe area de cima também no iOS. */
  telaCheia?: boolean;
}) {
  const theme = useTheme();
  const vidro = supportsLiquidGlass();
  const insets = useSafeAreaInsets();
  const insideTabletDialog = useTabletSheetContext();

  return (
    <View
      style={[
        styles.head,
        { paddingTop: (telaCheia || (Platform.OS === 'android' && !insideTabletDialog) ? insets.top : 0) + Space.sm },
      ]}>
      <View style={[styles.grabber, { backgroundColor: theme.separator }]} />
      <View style={styles.headRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          hitSlop={Space.sm}
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            { backgroundColor: vidro ? 'transparent' : pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          {vidro ? <GlassBackdrop fallbackColor={theme.backgroundElement} radius={Radius.pill} /> : null}
          <Icon name="xmark" size="sm" color="textSecondary" />
        </Pressable>
        <View style={styles.headText}>
          <ThemedText type="subtitle">{title}</ThemedText>
          {subtitle ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: Space.lg,
    // `paddingTop` é inline: soma o inset do Android.
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
  /*
    O título ocupa o meio e CEDE: `ThemedText` já traz `flexShrink: 1`, então um título longo a
    1,3× quebra em duas linhas e o cabeçalho cresce — nunca trunca (§7).
  */
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
