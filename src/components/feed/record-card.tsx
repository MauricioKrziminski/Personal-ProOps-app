import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { categoryIcon } from '@/design/category-icons';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { metaDoRegistro, type CardDaFala } from '@/lib/activity-feed';

function iconeDo(card: CardDaFala): IconName {
  const r = card.registro;
  if (!r) return card.verbo === 'apagou' ? 'trash' : 'checkmark.circle';
  switch (r.kind) {
    case 'transaction':
    case 'recurring':
      return categoryIcon(r.category, r.tx_kind);
    case 'installment_plan':
      return 'creditcard';
    case 'reminder':
      return 'bell';
    case 'note':
      return 'note.text';
    case 'account':
      return r.account_type === 'credit_card' ? 'creditcard' : 'wallet.pass';
    case 'goal':
      return 'target';
    case 'debt':
      return 'banknote';
  }
}

/**
 * O registro que a fala virou, como ele está AGORA (o RPC lê a linha atual). Alterado ganha a
 * pílula; o que não existe mais aparece esmaecido e não abre nada.
 */
export function RecordCard({ card, onPress }: { card: CardDaFala; onPress?: () => void }) {
  const theme = useTheme();
  const r = card.registro;
  const comSinal = r?.kind === 'transaction' || r?.kind === 'recurring';
  const valor =
    r?.amount_cents == null ? null : comSinal && r.tx_kind === 'expense' ? -r.amount_cents : r.amount_cents;

  const corpo = (
    <View
      style={[
        styles.card,
        { backgroundColor: r ? theme.surface : theme.backgroundElement, borderColor: theme.cardBorder },
      ]}>
      <View style={[styles.selo, { backgroundColor: r ? theme.backgroundElement : theme.surface }]}>
        <Icon name={iconeDo(card)} size="sm" color={r ? 'text' : 'textSecondary'} />
      </View>
      <View style={styles.textos}>
        <ThemedText type="headline" themeColor={r ? 'text' : 'textSecondary'} style={styles.semEncolher}>
          {card.rotulo}
        </ThemedText>
        {r ? (
          <View style={styles.meta}>
            <ThemedText type="caption" themeColor="textSecondary">
              {metaDoRegistro(r)}
            </ThemedText>
            {card.verbo === 'alterou' ? (
              <View style={[styles.pilula, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="caption" themeColor="textSecondary">
                  alterado
                </ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {valor != null ? (
        <Money
          cents={valor}
          variant="ticker"
          tone={comSinal && valor > 0 ? 'success' : 'text'}
          signed={comSinal}
        />
      ) : null}
    </View>
  );

  if (!onPress) return corpo;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`Abrir ${card.rotulo}`} onPress={onPress}>
      {corpo}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  selo: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: Space.half },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.xs },
  pilula: { paddingHorizontal: Space.sm, paddingVertical: 1, borderRadius: Radius.pill },
});
