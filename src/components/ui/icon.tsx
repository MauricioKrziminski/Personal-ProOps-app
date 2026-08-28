import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { IconSize } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/constants/theme';

type IconName = SymbolViewProps['name'];
/** Nomes de Material Symbol que o `expo-symbols` aceita no Android/web. */
type MaterialName = NonNullable<Extract<IconName, object>['android']>;

interface IconProps {
  /** Nome do SF Symbol (iOS). O equivalente Material do Android sai do mapa abaixo. */
  name: IconName;
  size?: keyof typeof IconSize | number;
  /** Chave de cor do tema. Ícone nunca recebe hex. */
  color?: ThemeColor;
  weight?: SymbolViewProps['weight'];
}

/**
 * SF Symbol → Material Symbol.
 *
 * **`expo-symbols` NÃO traduz nome sozinho.** No Android o `SymbolView` só resolve o nome quando
 * ele vem no formato objeto (`{ ios, android }`); recebendo a string de um SF Symbol ele acha
 * `null` e renderiza o `fallback` — que era `undefined`. Resultado: **todo ícone do app sumia no
 * Android**, e ninguém viu porque nenhuma tela tinha sido aberta lá.
 *
 * O mapa mora aqui, e não nas telas, porque `Icon` é o único caminho para ícone no app: 84 nomes
 * em ~36 telas passam por esta função.
 */
const MATERIAL: Record<string, MaterialName> = {
  archivebox: 'archive',
  airplane: 'flight',
  'bitcoinsign.circle': 'currency_bitcoin',
  book: 'menu_book',
  briefcase: 'work',
  car: 'directions_car',
  circle: 'circle',
  dumbbell: 'fitness_center',
  gift: 'card_giftcard',
  graduationcap: 'school',
  heart: 'favorite',
  lightbulb: 'lightbulb',
  'pause.circle': 'pause_circle',
  'pencil.circle': 'edit',
  pills: 'medication',
  pin: 'push_pin',
  'play.circle': 'play_circle',
  shippingbox: 'inventory_2',
  'arrow.down.doc': 'download',
  'arrow.triangle.2.circlepath': 'sync',
  'arrow.up': 'arrow_upward',
  'arrow.uturn.backward': 'undo',
  banknote: 'payments',
  bell: 'notifications',
  'bell.badge': 'notifications_active',
  'bell.fill': 'notifications',
  'bell.slash': 'notifications_off',
  'building.columns': 'account_balance',
  calendar: 'calendar_today',
  cart: 'shopping_cart',
  'chart.bar': 'bar_chart',
  'chart.bar.doc.horizontal': 'assessment',
  'chart.line.uptrend.xyaxis': 'trending_up',
  'chart.pie': 'pie_chart',
  'chart.pie.fill': 'pie_chart',
  checkmark: 'check',
  'checkmark.circle': 'check_circle',
  'checkmark.circle.fill': 'check_circle',
  'checkmark.seal.fill': 'verified',
  'chevron.right': 'chevron_right',
  'arrow.down.circle': 'arrow_circle_down',
  'arrow.down.left': 'south_west',
  'arrow.down.right': 'south_east',
  'arrow.left.arrow.right': 'swap_horiz',
  'arrow.left.arrow.right.circle': 'swap_horizontal_circle',
  'arrow.up.circle': 'arrow_circle_up',
  'arrow.up.right': 'north_east',
  'chevron.down': 'expand_more',
  'chevron.left': 'chevron_left',
  'chevron.up': 'expand_less',
  clock: 'schedule',
  'clock.arrow.circlepath': 'history',
  creditcard: 'credit_card',
  'creditcard.and.123': 'credit_card',
  'creditcard.trianglebadge.exclamationmark': 'credit_card_off',
  'doc.badge.plus': 'note_add',
  'doc.text': 'description',
  'doc.text.magnifyingglass': 'find_in_page',
  'dollarsign.circle': 'paid',
  'ellipsis.circle': 'more_horiz',
  'exclamationmark.circle.fill': 'error',
  'exclamationmark.triangle': 'warning',
  'exclamationmark.triangle.fill': 'warning',
  folder: 'folder',
  house: 'home',
  'line.3.horizontal.decrease': 'filter_list',
  'list.bullet': 'list',
  lock: 'lock',
  magnifyingglass: 'search',
  'note.text': 'description',
  paperclip: 'attach_file',
  paperplane: 'send',
  'paperplane.fill': 'send',
  pencil: 'edit',
  person: 'person',
  'person.2': 'group',
  'person.2.fill': 'group',
  'person.badge.plus': 'person_add',
  'person.crop.circle': 'account_circle',
  'person.crop.circle.badge.questionmark': 'help',
  'person.fill': 'person',
  phone: 'phone',
  'pin.fill': 'push_pin',
  plus: 'add',
  'plus.circle': 'add_circle',
  'plus.circle.fill': 'add_circle',
  'plus.square.on.square': 'library_add',
  'questionmark.circle': 'help',
  'questionmark.folder': 'folder_open',
  'rectangle.portrait.and.arrow.right': 'logout',
  'rectangle.split.3x1': 'view_column',
  repeat: 'repeat',
  sparkles: 'auto_awesome',
  'square.and.arrow.down': 'download',
  'square.and.arrow.up': 'share',
  'square.and.pencil': 'edit_square',
  storefront: 'storefront',
  'sun.max': 'light_mode',
  'sun.max.fill': 'light_mode',
  tablecells: 'table_chart',
  tag: 'label',
  target: 'flag',
  'text.badge.checkmark': 'playlist_add_check',
  'text.quote': 'format_quote',
  trash: 'delete',
  tray: 'inbox',
  'wallet.bifold': 'account_balance_wallet',
  'wallet.pass': 'wallet',
  'wand.and.stars': 'auto_fix_high',
  xmark: 'close',
  'xmark.circle': 'cancel',
};

/**
 * O único caminho para ícone no app.
 *
 * Existe para matar dois padrões: emoji fazendo papel de ícone (proibido pela regra de design) e
 * glyph de texto (`‹` no voltar, `＋` no FAB) desenhado à mão.
 */
export function Icon({ name, size = 'md', color = 'text', weight = 'regular' }: IconProps) {
  const theme = useTheme();
  const px = typeof size === 'number' ? size : IconSize[size];

  // Ícone fora do mapa vira `circle` silencioso no Android — foi assim que a `chevron.left` da
  // navegação de mês virou um círculo vazio. Em dev isso grita.
  if (__DEV__ && typeof name === 'string' && !MATERIAL[name]) {
    console.warn(`[Icon] "${name}" não está no mapa SF → Material; vai cair em "circle" no Android.`);
  }

  // Nome já no formato objeto (o caller escolheu o glyph de cada plataforma) passa direto.
  const resolved: IconName =
    typeof name === 'string'
      ? { ios: name, android: MATERIAL[name] ?? 'circle', web: MATERIAL[name] ?? 'circle' }
      : name;

  return <SymbolView name={resolved} size={px} tintColor={theme[color]} weight={weight} />;
}
