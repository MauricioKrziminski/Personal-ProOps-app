import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** O nó do trilho mede isto; o trilho é centrado nele. */
const NO = 12;

/**
 * paga = nó cheio de tinta; estimada = cheio de cinza (contada, sem lançamento); proxima = anel e a
 * linha com fundo (é a resposta da lista); futura = vazio; item = ponto pequeno (um item de
 * dentro de algo, sem ordem de pagamento — as compras de uma fatura).
 */
export type EstadoNoTempo = 'paga' | 'estimada' | 'proxima' | 'futura' | 'item';

export interface ItemNoTempo {
  chave: string;
  titulo: string;
  apoio?: string;
  cents: number;
  estado: EstadoNoTempo;
  accessibilityLabel: string;
  onPress?: () => void;
}

/**
 * A lista que se ABRE dentro de outra coisa, num desenho só (08/10/2026, *"quando abrir uma lista
 * de algo que eu expandi ele tem que ficar bonito e padronizado"*): as parcelas de um
 * financiamento, de uma compra parcelada, as compras de uma fatura. Nasceu como a linha do tempo da
 * dívida (23/09/2026) e virou genérica: o trilho à esquerda liga os itens e diz que são PARTE de
 * algo, o título e a linha de apoio em letra de corpo, o valor à direita.
 *
 * O estado se lê pela FORMA do nó, não por cor (monocromático, design.md §2b). Os grupos (anos,
 * por exemplo) partilham um trilho só: a primeira linha não tem fio acima, a última não tem abaixo.
 */
export function LinhaDoTempo({ grupos }: { grupos: { titulo?: string; itens: ItemNoTempo[] }[] }) {
  const theme = useTheme();
  const primeira = grupos.find((g) => g.itens.length > 0)?.itens[0];
  const ultima = [...grupos].reverse().find((g) => g.itens.length > 0)?.itens.at(-1);

  return (
    <View style={styles.wrap}>
      {grupos.map((g, i) =>
        g.itens.length === 0 ? null : (
          <View key={g.titulo ?? i}>
            {g.titulo ? (
              <ThemedText type="smallBold" accessibilityRole="header" style={[tabular, styles.cabecalho]}>
                {g.titulo}
              </ThemedText>
            ) : null}
            {g.itens.map((item) => {
              const proxima = item.estado === 'proxima';
              return (
                <Pressable
                  key={item.chave}
                  accessibilityRole={item.onPress ? 'button' : undefined}
                  accessibilityLabel={item.accessibilityLabel}
                  disabled={!item.onPress}
                  onPress={item.onPress}
                  // Linha de lista: o toque acende o FUNDO, sem escala (design §5).
                  style={({ pressed }) => [
                    styles.linha,
                    proxima || pressed ? { backgroundColor: theme.backgroundSelected } : null,
                  ]}>
                  <View style={styles.trilho}>
                    <View style={[styles.fio, styles.fioCima, { backgroundColor: item === primeira ? 'transparent' : theme.separator }]} />
                    <View style={[styles.fio, styles.fioBaixo, { backgroundColor: item === ultima ? 'transparent' : theme.separator }]} />
                    <View
                      style={[
                        styles.no,
                        item.estado === 'paga'
                          ? { backgroundColor: theme.tintFill, borderColor: theme.tintFill }
                          : item.estado === 'estimada'
                            ? { backgroundColor: theme.textSecondary, borderColor: theme.textSecondary }
                            : proxima
                              ? { backgroundColor: theme.surface, borderColor: theme.tint, borderWidth: 3 }
                              : item.estado === 'item'
                                ? [styles.noItem, { backgroundColor: theme.textSecondary, borderColor: theme.textSecondary }]
                                : { backgroundColor: theme.surface, borderColor: theme.separator },
                      ]}
                    />
                  </View>
                  <View style={styles.texto}>
                    <ThemedText type={proxima ? 'headline' : 'default'} style={tabular}>
                      {item.titulo}
                    </ThemedText>
                    {item.apoio ? (
                      <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                        {item.apoio}
                      </ThemedText>
                    ) : null}
                  </View>
                  <Money
                    cents={item.cents}
                    variant={proxima ? 'headline' : 'body'}
                    tone={item.estado === 'paga' || item.estado === 'estimada' ? 'textSecondary' : 'text'}
                  />
                  {item.onPress ? <Icon name="chevron.right" size="sm" color="textSecondary" /> : null}
                </Pressable>
              );
            })}
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.lg },
  // O cabeçalho a `Space.md` dos itens dele, como todo rótulo e o que ele nomeia (§2).
  cabecalho: { paddingBottom: Space.md },
  // Sem `gap` entre as linhas: o trilho de uma encosta no da outra e a linha do tempo é contínua.
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
  no: { width: NO, height: NO, borderRadius: Radius.pill, borderWidth: 2 },
  noItem: { width: NO / 2, height: NO / 2 },
  texto: { flex: 1, gap: Space.half, paddingVertical: Space.sm },
});
