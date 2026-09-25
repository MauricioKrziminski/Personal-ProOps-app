import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useBRL } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isoToBR } from '@/lib/dates';
import type { ItemDaLinha } from '@/lib/debt-history';

/** O nó do trilho mede isto; o trilho é centrado nele. */
const NO = 12;

/**
 * O contrato inteiro numa linha do tempo, agrupado por ano (23/09/2026).
 *
 * Substituiu uma tabela de seis colunas em letra `footnote`, que rolava na horizontal — a queixa
 * foi *"os textos estão muito pequenos e a tabela não é bonita"*. Uma parcela é uma linha só, em
 * letra de corpo: o número dela, quando vence e o valor. Juros e amortização por parcela, que só
 * existem no modo com juros, descem para uma linha de apoio (e o "—" do modo simples sumiu).
 *
 * O estado se lê pela FORMA do nó, não por cor (monocromático, design.md §2b): preenchido de
 * tinta = paga; preenchido de cinza = estimada (veio da contagem, sem lançamento); anel = a
 * próxima; vazio = futura. A próxima é a única linha com fundo — é a resposta da tela.
 */
export function DebtTimeline({ anos }: { anos: { ano: string; itens: ItemDaLinha[] }[] }) {
  const theme = useTheme();
  // Dinheiro dentro de frase obedece ao "esconder saldo" — `Money` é bloco e não cabe aqui.
  const brl = useBRL();
  // As pontas do trilho: a primeira linha não tem fio acima, a última não tem abaixo.
  const primeiraDeTodas = anos[0]?.itens[0];
  const ultimaDeTodas = anos.at(-1)?.itens.at(-1);

  return (
    <View style={styles.wrap}>
      {anos.map(({ ano, itens }) => (
        <View key={ano} style={styles.ano}>
          <ThemedText type="smallBold" accessibilityRole="header" style={[tabular, styles.cabecalhoAno]}>
            {ano}
          </ThemedText>
          {itens.map((item) => {
            const primeira = item === primeiraDeTodas;
            const ultima = item === ultimaDeTodas;
            const proxima = item.estado === 'proxima';
            const quando =
              item.estado === 'paga'
                ? `paga em ${isoToBR(item.iso)}`
                : item.estado === 'estimada'
                  ? `paga · por volta de ${isoToBR(item.iso)}`
                  : proxima
                    ? `a próxima · vence ${isoToBR(item.iso)}`
                    : `vence ${isoToBR(item.iso)}`;
            return (
              <View
                key={item.n}
                accessible
                accessibilityLabel={`${item.n}ª parcela, ${quando}, ${brl(item.cents)}`}
                style={[styles.linha, proxima ? { backgroundColor: theme.backgroundSelected } : null]}>
                <View style={styles.trilho}>
                  <View
                    style={[
                      styles.fio,
                      styles.fioCima,
                      { backgroundColor: primeira ? 'transparent' : theme.separator },
                    ]}
                  />
                  <View
                    style={[
                      styles.fio,
                      styles.fioBaixo,
                      { backgroundColor: ultima ? 'transparent' : theme.separator },
                    ]}
                  />
                  <View
                    style={[
                      styles.no,
                      item.estado === 'paga'
                        ? { backgroundColor: theme.tintFill, borderColor: theme.tintFill }
                        : item.estado === 'estimada'
                          ? { backgroundColor: theme.textSecondary, borderColor: theme.textSecondary }
                          : proxima
                            ? { backgroundColor: theme.surface, borderColor: theme.tint, borderWidth: 3 }
                            : { backgroundColor: theme.surface, borderColor: theme.separator },
                    ]}
                  />
                </View>
                <View style={styles.texto}>
                  <ThemedText type={proxima ? 'headline' : 'default'} style={tabular}>
                    {`${item.n}ª parcela`}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                    {item.jurosCents ? `${quando} · juros ${brl(item.jurosCents)}` : quando}
                  </ThemedText>
                </View>
                <Money
                  cents={item.cents}
                  variant={proxima ? 'headline' : 'body'}
                  tone={item.estado === 'futura' || proxima ? 'text' : 'textSecondary'}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.lg },
  // Sem `gap` entre as linhas: o trilho de uma encosta no da outra e a linha do tempo é contínua.
  ano: {},
  // O ano a `Space.md` das parcelas dele, como todo rótulo e o que ele nomeia (§2): com `xs` ele
  // encostava no cartão destacado da próxima parcela (25/09/2026).
  cabecalhoAno: { paddingBottom: Space.md },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget + Space.md,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  trilho: { width: NO + 8, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  fio: { position: 'absolute', width: 2, left: (NO + 8) / 2 - 1 },
  fioCima: { top: 0, bottom: '50%' },
  fioBaixo: { top: '50%', bottom: 0 },
  no: {
    width: NO,
    height: NO,
    borderRadius: Radius.pill,
    borderWidth: 2,
  },
  texto: { flex: 1, gap: Space.half, paddingVertical: Space.sm },
});
