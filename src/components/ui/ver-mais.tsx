import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Space } from '@/design/tokens';

/**
 * O botão de "ver mais" das listas longas (24/09/2026): o que falta vem por toque, um passo por
 * vez — nunca a lista inteira de uma vez. Some quando não falta nada. `carregando` é para a lista
 * paginada no servidor, enquanto a próxima página chega.
 */
export function VerMais({
  restantes,
  onPress,
  carregando = false,
}: {
  /** Quantos ainda não aparecem; `null` quando o servidor não diz o total (há mais, sem número). */
  restantes: number | null;
  onPress: () => void;
  carregando?: boolean;
}) {
  if (restantes === 0) return null;
  return (
    <View style={styles.wrap}>
      <Button
        label={restantes == null ? 'Ver mais' : `Ver mais (${restantes})`}
        variant="secondary"
        size="sm"
        loading={carregando}
        onPress={onPress}
        style={styles.centro}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Respiro dos DOIS lados (07/10/2026): dentro de um `Section` o "Ver mais" é um filho como as
  // linhas, e só com `paddingTop` a pílula encostava no fio da linha seguinte — no ciclo, o
  // "Ver mais (15)" das compras ficava colado no "Pagamento da fatura" logo abaixo.
  wrap: { paddingVertical: Space.sm },
  // O `Button` abraça o conteúdo à esquerda; o "Ver mais" fica no meio, embaixo da lista.
  centro: { alignSelf: 'center' },
});
