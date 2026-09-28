import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { CardFace } from '@/components/finance/card-face';
import { COLUNA_DA_HORA } from '@/components/feed/grupo-do-dia';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { useBRL } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import type { ThemeColor } from '@/constants/theme';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isoToBR } from '@/lib/dates';
import type { ResumoDoAtrasado, Tom } from '@/lib/today-sections';
import { transicaoDeLayout } from '@/components/motion/transicao';

const COR_DA_META: Record<Tom, ThemeColor> = {
  danger: 'danger',
  warning: 'warning',
  success: 'success',
  neutral: 'textSecondary',
};

export interface AgendaItemProps {
  title: string;
  meta: string;
  metaTone: Tom;
  cents: number;
  valueTone: 'danger' | 'success' | 'text';
  icon: IconName;
  /** Compra no cartão: a minifase do emissor no lugar do ícone (cor do banco DENTRO do cartão). */
  cartao?: string | null;
  action?: { label: string; icon: IconName; onPress: () => void };
  onPress?: () => void;
}

/**
 * Um compromisso do dia: conta, fatura, prestação, entrada ou compra que vai postar — uma LINHA
 * de `GrupoDoDia`, não um card (28/09/2026).
 *
 * Era um card por item com escala no toque; sete faturas atrasadas viravam sete cards vermelhos
 * empilhados. Linha de lista responde com realce de fundo, nunca escala (§5).
 *
 * ⚠️ **`Animated.View` POR FORA do tocável** — `createAnimatedComponent(Pressable)` não aplica
 * estilo em função, e a linha já virou coluna por isso (ver o histórico da Hoje).
 *
 * ⚠️ **Botão dentro de linha tocável vira ação de acessibilidade da linha**: o leitor de tela não
 * alcança botão dentro de botão.
 */
export function AgendaItem({ title, meta, metaTone, cents, valueTone, icon, cartao, action, onPress }: AgendaItemProps) {
  const theme = useTheme();
  const brl = useBRL();

  const corpo = (pressed: boolean) => (
    <View style={[styles.linha, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <View style={styles.coluna}>
        {cartao ? (
          <CardFace nome={cartao} largura={36} style={styles.mini} />
        ) : (
          <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
            <Icon name={icon} size="sm" color="text" />
          </View>
        )}
      </View>
      <View style={styles.textos}>
        {/* Título e valor na mesma linha; sem espaço, o valor desce — o título nunca parte (§3). */}
        <View style={styles.topo}>
          <ThemedText type="default" style={styles.titulo}>
            {title}
          </ThemedText>
          <View style={styles.direita}>
            <Money cents={cents} variant="ticker" tone={valueTone} />
          </View>
        </View>
        {/* O estado à esquerda e a ação que o resolve à direita, na mesma linha. */}
        <View style={styles.base}>
          <ThemedText type="caption" themeColor={COR_DA_META[metaTone]}>
            {meta}
          </ThemedText>
          {action ? (
            <View style={styles.direita}>
              <Button label={action.label} icon={action.icon} size="sm" variant="secondary" onPress={action.onPress} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <Animated.View layout={transicaoDeLayout} exiting={FadeOut.duration(Motion.duration.exit)}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${brl(cents)}, ${meta}`}
          accessibilityActions={action ? [{ name: 'activate' }, { name: 'acao', label: action.label }] : undefined}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'acao') action?.onPress();
            else onPress();
          }}
          onPress={onPress}>
          {({ pressed }) => corpo(pressed)}
        </Pressable>
      ) : (
        corpo(false)
      )}
    </Animated.View>
  );
}

function entradasNaoCairam(n: number): string {
  return `${n} ${n === 1 ? 'entrada não caiu' : 'entradas não caíram'}`;
}

/**
 * O atrasado numa linha só, recolhida (28/09/2026) — o padrão do Todoist: a contagem, o total e
 * desde quando, e um toque abre as linhas no lugar, cada uma com a ação dela.
 *
 * Vermelho só no ÍCONE e no NÚMERO: a linha inteira em vermelho é a parede de culpa que a pesquisa
 * mandou evitar. Receita que não caiu não é conta: não soma no valor, vem escrita embaixo.
 */
export function LinhaDoAtrasado({
  resumo,
  aberto,
  onAlternar,
}: {
  resumo: ResumoDoAtrasado;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const theme = useTheme();
  const brl = useBRL();
  const temConta = resumo.contas > 0;
  const titulo = temConta
    ? `${resumo.contas} ${resumo.contas === 1 ? 'conta atrasada' : 'contas atrasadas'}`
    : entradasNaoCairam(resumo.entradas);
  const legenda = [
    `desde ${isoToBR(resumo.desde).slice(0, 5)}`,
    temConta && resumo.entradas > 0 ? entradasNaoCairam(resumo.entradas) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: aberto }}
      accessibilityLabel={`${titulo}, ${brl(temConta ? resumo.contasCents : resumo.entradasCents)}, ${legenda}`}
      accessibilityHint={aberto ? 'Recolhe a lista' : 'Mostra cada uma'}
      onPress={() => {
        Haptics.selectionAsync();
        onAlternar();
      }}>
      {({ pressed }) => (
        <View style={[styles.linha, styles.centro, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <View style={styles.coluna}>
            <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
              <Icon name="exclamationmark.triangle" size="sm" color={temConta ? 'danger' : 'warning'} />
            </View>
          </View>
          <View style={styles.textos}>
            <View style={styles.topo}>
              <ThemedText type="headline" style={styles.titulo}>
                {titulo}
              </ThemedText>
              <View style={[styles.direita, styles.valorComSeta]}>
                <Money
                  cents={temConta ? resumo.contasCents : resumo.entradasCents}
                  variant="ticker"
                  tone={temConta ? 'danger' : 'warning'}
                />
                <Icon name={aberto ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />
              </View>
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              {legenda}
            </ThemedText>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centro: { alignItems: 'center' },
  valorComSeta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  linha: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  coluna: { minWidth: COLUNA_DA_HORA, flexShrink: 0 },
  selo: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mini: { flexShrink: 0, marginTop: Space.xs },
  textos: { flex: 1, minWidth: 0, gap: Space.xs },
  topo: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Space.md, rowGap: Space.half },
  titulo: { flexShrink: 0, maxWidth: '100%' },
  // `marginLeft: auto` mantém o valor e a ação encostados à direita mesmo quando descem de linha.
  direita: { marginLeft: 'auto' },
  base: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Space.md, rowGap: Space.sm, minHeight: 20 },
});
