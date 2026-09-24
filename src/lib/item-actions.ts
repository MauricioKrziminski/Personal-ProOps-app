import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { SFSymbol } from 'sf-symbols-typescript';

export interface ItemAction {
  label: string;
  /** Opcional só quando a entrada é um submenu (`actions`) — aí ela abre, não executa. */
  onPress?: () => void;
  destructive?: boolean;
  /** Ação visível mas indisponível — some do `Alert` de emergência, que só cabe duas. */
  disabled?: boolean;
  /** Estado ligado: a pasta em que a nota já está. `isOn` no iOS, check no sheet do Android. */
  selected?: boolean;
  /** SF Symbol — só o menu nativo do iOS desenha; sheet e `Alert` ignoram. */
  icon?: SFSymbol;
  /**
   * Submenu. No iOS vira `Link.Menu` aninhado; no Android, **um segundo sheet** — que é o
   * natural lá, e melhor do que despejar dez pastas na lista principal.
   */
  actions?: ItemAction[];
  /**
   * Em que lado a ação aparece ao ARRASTAR o card (`Deslizavel`, spec 2026-09-23-arrastar-card).
   * `fora` é a ação que repete o toque curto ("Ver detalhe"): não entra no arrasto e não faz o
   * "Mais" aparecer.
   */
  arrasto?: 'direita' | 'esquerda' | 'fora';
  /** Pode executar ao arrastar até o fim — só quando a tela oferece "Desfazer" no aviso. */
  desfaz?: boolean;
  /** Rótulo de uma palavra para o botão do arrasto (88dp); o menu usa `label`, a frase inteira. */
  curto?: string;
}

interface SheetRequest {
  title: string;
  message?: string;
  actions: ItemAction[];
}

/**
 * O Android não tem menu de contexto nativo em RN, e `Alert` **corta silenciosamente a partir do
 * terceiro botão** — some justamente a última ação, que costuma ser a destrutiva.
 *
 * Por isso o Android renderiza um sheet próprio (`AndroidActionSheet`), montado uma vez no layout
 * raiz. Ele registra aqui o seu setter; se por algum motivo não estiver montado, caímos no `Alert`
 * com no máximo duas ações, que é o que ele exibe sem mentir.
 */
let androidSheet: ((request: SheetRequest | null) => void) | null = null;

export function registerAndroidSheet(setter: (request: SheetRequest | null) => void) {
  androidSheet = setter;
  return () => {
    androidSheet = null;
  };
}

/**
 * Menu de ações de um item, no idioma de cada plataforma.
 *
 * `Link.Menu` do expo-router (o context menu com preview) é **iOS-only**; usar só ele deixaria o
 * Android sem ação nenhuma na linha.
 */
/** Entrada com submenu abre outro menu; entrada normal executa. */
function press(title: string, action?: ItemAction) {
  if (!action) return;
  if (action.actions?.length) {
    showItemActions(action.label, action.actions);
    return;
  }
  action.onPress?.();
}

export function showItemActions(title: string, actions: ItemAction[], message?: string) {
  Haptics.selectionAsync();

  if (Platform.OS === 'ios') {
    const destructiveIndex = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: ['Cancelar', ...actions.map((a) => a.label)],
        cancelButtonIndex: 0,
        destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex + 1 : undefined,
      },
      (index) => {
        if (index > 0) press(title, actions[index - 1]);
      }
    );
    return;
  }

  if (androidSheet) {
    androidSheet({ title, message, actions });
    return;
  }

  // Rede de segurança: melhor duas ações honestas do que quatro com a última sumindo.
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    ...actions.filter((a) => !a.disabled).slice(0, 2).map((a) => ({
      text: a.label,
      style: a.destructive ? ('destructive' as const) : ('default' as const),
      onPress: () => press(title, a),
    })),
  ]);
}

/**
 * Confirmação destrutiva. A contagem/consequência vai no `message`, nunca só no título — é assim
 * que se apaga mais do que se queria.
 */
export function confirmDestructive(
  title: string,
  confirmLabel: string,
  onConfirm: () => void,
  message?: string
) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: ['Cancelar', confirmLabel],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 1,
      },
      (index) => index === 1 && onConfirm()
    );
    return;
  }

  // Duas opções cabem no Alert do Android sem truncar. Sem mensagem, a pergunta vai no CORPO: o
  // `Alert` troca mensagem ausente por '' e o Android ainda reserva a área dela — "Sair da
  // conta?" saía com um vão vazio entre o título e os botões.
  Alert.alert(message ? title : '', message ?? title, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
