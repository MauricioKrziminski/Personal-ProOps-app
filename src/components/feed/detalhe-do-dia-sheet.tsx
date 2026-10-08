import { StyleSheet, View } from 'react-native';

import { LinhaDaConta } from '@/components/finance/detalhe-do-ciclo-sheet';
import { ThemedText } from '@/components/themed-text';
import { Row, Section } from '@/components/ui/row';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { PainelDoDia } from '@/lib/today-spend';

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * "Como chego nesse valor" da Hoje (08/10/2026): o toque no dinheiro do dia abre a CONTA dele, como
 * o painel de Finanças — não um menu de destinos sem relação com o número. Os valores são os mesmos
 * que montaram o card (`spendable`: caixa e o que vence até a próxima entrada; os dias até lá).
 */
export function DetalheDoDiaSheet({
  visible,
  onClose,
  painel,
  caixa,
  comprometido,
  ate,
  entrada,
  diasLivres,
  atalhos,
}: {
  visible: boolean;
  onClose: () => void;
  painel: PainelDoDia;
  caixa: number;
  comprometido: number;
  /** Até quando o livre vale: a próxima entrada, ou o fim do ciclo. */
  ate: string | null;
  entrada: string | null;
  diasLivres: number | null;
  atalhos: readonly { label: string; onPress: () => void }[];
}) {
  const theme = useTheme();
  const livre = caixa - comprometido;
  const vence = ate
    ? entrada ? `− Vence antes de entrar dinheiro (${ddmm(ate)})` : `− Vence até o fim do ciclo (${ddmm(ate)})`
    : '− Vence até o fim do ciclo';
  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader title="Como chego nesse valor" onClose={onClose} />
      <SheetScroll contentContainerStyle={styles.corpo}>
        <View style={styles.bloco}>
          <LinhaDaConta rotulo="Em conta hoje" cents={caixa} forte />
          <LinhaDaConta rotulo={vence} cents={-comprometido} tone="danger" />
        </View>
        <View style={[styles.bloco, styles.total, { borderColor: theme.cardBorder }]}>
          <LinhaDaConta rotulo={ate ? `= Livre até ${ddmm(ate)}` : '= Livre'} cents={livre} forte tone={livre < 0 ? 'danger' : 'text'} />
          {painel.modo === 'porDia' && diasLivres ? (
            <>
              <LinhaDaConta rotulo="÷ Dias até lá" cents={0} texto={`${diasLivres} ${diasLivres === 1 ? 'dia' : 'dias'}`} />
              <LinhaDaConta rotulo="= Dá para gastar por dia" cents={painel.cents} forte />
            </>
          ) : null}
        </View>
        {atalhos.length > 0 ? (
          <Section>
            {atalhos.map((a) => <Row key={a.label} title={a.label} onPress={a.onPress} />)}
          </Section>
        ) : null}
        <View style={styles.bloco}>
          <ThemedText type="smallBold">Como é calculado</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            O dinheiro em conta hoje menos o que vence até a próxima entrada de dinheiro (ou até o fim
            do ciclo), dividido pelos dias até lá. Faturas contam no vencimento.
          </ThemedText>
        </View>
      </SheetScroll>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  bloco: { gap: Space.sm },
  // 1dp, como o fio do `Card`: `hairlineWidth` é um pixel físico e some em escala.
  total: { paddingTop: Space.md, borderTopWidth: 1 },
});
