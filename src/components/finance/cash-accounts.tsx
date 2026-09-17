import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { useBRL } from '@/components/ui/conceal';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ACCOUNT_TYPES } from '@/lib/accounts';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { Caixa, LinhaDeCaixa } from '@/lib/account-cash';

const SEM_CONTA: IconName = 'questionmark.circle';

function glifo(tipo: string): IconName {
  return (ACCOUNT_TYPES.find((t) => t.value === tipo)?.icon as IconName) ?? SEM_CONTA;
}

/**
 * "Nas contas": o dinheiro que EXISTE agora, e de onde ele sai.
 *
 * É a outra metade do herói — ele diz quanto DÁ para gastar até o fim do ciclo (já descontando o
 * que vem), este diz quanto está na conta neste instante. As duas perguntas são feitas todo dia e
 * só uma delas tinha resposta na Hoje.
 *
 * ⚠️ **O total é a soma das linhas de baixo** (`caixaDasContas` garante, com teste). Cartão fica
 * de fora: ele tem fatura, não saldo.
 */
export function CashAccounts({ caixa, onOpen }: { caixa: Caixa; onOpen: (l: LinhaDeCaixa) => void }) {
  const theme = useTheme();
  const brl = useBRL();
  const negativo = caixa.total < 0;

  return (
    <Card style={styles.card}>
      <View style={styles.topo}>
        <Money
          cents={caixa.total}
          variant="money"
          tone={negativo ? 'danger' : 'text'}
          concealable
        />
        {caixa.aReceber > 0 ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {`mais ${brl(caixa.aReceber)} que ainda vão cair`}
          </ThemedText>
        ) : null}
      </View>

      {caixa.linhas.map((l) => (
        <Pressable
          key={l.id ?? 'sem-conta'}
          accessibilityRole="button"
          accessibilityLabel={l.nome}
          onPress={() => onOpen(l)}
          style={({ pressed }) => [
            styles.linha,
            { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
          ]}>
          <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
            <Icon name={glifo(l.tipo)} size="sm" color="text" />
          </View>
          <View style={styles.meio}>
            <ThemedText type="default">{l.nome}</ThemedText>
            {l.aReceber > 0 ? (
              <ThemedText type="caption" themeColor="textSecondary">
                {`${brl(l.aReceber)} a receber`}
              </ThemedText>
            ) : null}
          </View>
          <Money cents={l.cents} variant="ticker" tone={l.cents < 0 ? 'danger' : 'plain'} concealable />
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Space.xs },
  // O total respira mais que as linhas: é ele que responde a pergunta do bloco.
  topo: { gap: Space.half, paddingBottom: Space.sm },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.xs,
    marginHorizontal: -Space.xs,
    paddingHorizontal: Space.xs,
    borderRadius: Radius.sm,
  },
  selo: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  meio: { flex: 1, gap: Space.half },
});
