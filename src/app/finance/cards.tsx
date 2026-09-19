import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';

import { CardFace, FaceEmVoo } from '@/components/finance/card-face';
import { useFlight, useFlightAnchor, useFlightHidden } from '@/components/motion/flight-layer';
import { PressableScale } from '@/components/motion/pressable-scale';
import { useBRL } from '@/components/ui/conceal';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useCardSummary, type CardSummary } from '@/hooks/use-finance';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import {
  diasAte as daysUntil,
  estadoDaFatura as estadoFatura,
  outrasFaturas,
  prazoLabel,
} from '@/lib/card-status';

/**
 * Cartões — "quanto vou pagar de cartão, e quando?".
 *
 * **A regra de ciclo mora no banco.** O trigger `set_invoice` chama `private.invoice_window` e
 * resolve a fatura de cada compra; aqui a tela só LÊ `closing_date`/`due_date` prontos. Nenhuma
 * aritmética de ciclo em TS — comparar uma data que o servidor mandou com hoje não é recalcular
 * ciclo, é ler prazo.
 *
 * **Cartão é conta comum em partida dobrada:** a compra já contou como gasto, e o pagamento da
 * fatura é uma transferência (`pay_invoice`). Esta tela nunca oferece lançar fatura como despesa.
 */

/** Faixa de erro da tela. Não é o destaque — a tela já tem o dela. */
function ErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={styles.band}>
      <Icon name="exclamationmark.triangle.fill" size="lg" color="danger" />
      <ThemedText type="small" style={styles.centered}>
        {message}
      </ThemedText>
      <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onRetry} />
    </Card>
  );
}

/** Card tocável: press-in de 120 ms com `scale`, o feedback de bloco (linha de lista usa fundo). */
function PressCard({
  onPress,
  accessibilityLabel,
  acoes = [],
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  /** Os botões de DENTRO do card, que o leitor de tela não alcança aninhados. */
  acoes?: { nome: string; rotulo: string; onPress: () => void }[];
  children: React.ReactNode;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={acoes.map((a) => ({ name: a.nome, label: a.rotulo }))}
      onAccessibilityAction={(e) => acoes.find((a) => a.nome === e.nativeEvent.actionName)?.onPress()}
      haptic="selection"
      onPress={onPress}>
      <Card style={styles.card}>{children}</Card>
    </PressableScale>
  );
}

const MINIATURA = 56;

/**
 * O cartão em miniatura no cabeçalho de cada bloco — a porta desta tela para a Carteira.
 *
 * Botão PRÓPRIO dentro do card: o card continua abrindo a fatura, e a miniatura leva o cartão
 * voando até o carrossel (e o recebe de volta ao fechar, pela âncora `miniatura:<id>`, quando o
 * cartão mostrado ainda é ele — deslizou para outro, a Carteira sai só no `fade`). Abrir por aqui
 * NÃO muda o cartão da frente da pilha: só o toque num cartão da Carteira escolhe.
 */
/** Abrir a Carteira num cartão, voando a partir da miniatura dele. */
function useAbrirNaCarteira() {
  const { voar } = useFlight();
  return (card: CardSummary) => {
    const id = card.account_id;
    const atrasada = Number(card.overdue_count ?? 0) > 0;
    void voar({
      de: `miniatura:${id}`,
      poseDe: 'deitado',
      esconderDe: `miniatura:${id}`,
      para: 'vitrine',
      posePara: 'em-pe',
      esconderPara: `vitrine:${id}`,
      desenho: (progresso) => <FaceEmVoo nome={card.name} atrasada={atrasada} progresso={progresso} />,
    }).then((ok) => ok && router.push({ pathname: '/finance/wallet', params: { card: id, origem: 'miniatura' } }));
  };
}

function Miniatura({ card, onPress }: { card: CardSummary; onPress: () => void }) {
  const id = card.account_id;
  const { prender, aoPosicionar } = useFlightAnchor(`miniatura:${id}`);
  const oculto = useFlightHidden(`miniatura:${id}`);
  const atrasada = Number(card.overdue_count ?? 0) > 0;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${card.name} na carteira`}
      haptic="light"
      hitSlop={Space.sm}
      onPress={onPress}>
      <Animated.View ref={prender} onLayout={aoPosicionar} style={oculto}>
        <CardFace nome={card.name} largura={MINIATURA} atrasada={atrasada} />
      </Animated.View>
    </PressableScale>
  );
}

export default function CardsScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const cards = useCardSummary();
  const abrirNaCarteira = useAbrirNaCarteira();

  // Ordem de urgência, não alfabética: atrasada primeiro, depois quem vence antes.
  // `isError` e não só `data`: o TanStack GUARDA o resultado anterior quando o refetch
  // falha, e sem este corte a lista seguia afirmando números embaixo da faixa que acabou
  // de dizer que não conseguiu carregar. Zerar aqui cobre lista, contadores e destaque de
  // uma vez; os estados vazios já checam `isError` e continuam calados.
  const lista = (cards.isError ? [] : [...(cards.data ?? [])]).sort((a, b) => {
    const da = a.due_date ? daysUntil(a.due_date) : Number.MAX_SAFE_INTEGER;
    const db = b.due_date ? daysUntil(b.due_date) : Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  const totalAPagar = lista.reduce((s, c) => s + Number(c.unpaid_total_cents ?? 0), 0);
  const proximo = lista.find((c) => c.due_date && Number(c.unpaid_total_cents ?? 0) > 0);
  // `unpaid_total_cents` inclui OUTRAS faturas e parcelas futuras. O painel lateral fala de
  // UMA fatura, então só pode mostrar o saldo aberto da fatura escolhida pela RPC.
  const contexto = lista.find(
    (c) => c.invoice_id && c.due_date && Number(c.invoice_open_cents ?? c.invoice_total_cents ?? 0) > 0
  );

  const irParaFatura = (card: CardSummary) => {
    if (!card.invoice_id) {
      router.push('/finance/accounts');
      return;
    }
    router.push({ pathname: '/finance/invoice/[id]', params: { id: card.invoice_id } });
  };

  const loading = cards.isLoading ? (
    <>
      <Skeleton height={120} radius={Radius.lg} />
      <Skeleton height={160} radius={Radius.md} />
      <Skeleton height={160} radius={Radius.md} />
    </>
  ) : null;

  const error = cards.isError ? (
    <ErrorBand message="Não deu para carregar seus cartões." onRetry={cards.refetch} />
  ) : null;

  {/* O único destaque da tela: com N cartões, a pergunta da tela não tem resposta visível.
      Com UM cartão ele repetia o mesmo número do card logo abaixo, palavra por palavra
      (total, nome e vencimento) — soma de um item não é resumo, é eco. */}
  const hero = !cards.isError && lista.length > 1 ? (
    <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
      <Card style={styles.hero}>
        <HeroLabel>Total a pagar</HeroLabel>
        <Money cents={totalAPagar} variant="money" />
        <ThemedText type="small" themeColor="textSecondary" style={tabular}>
          {proximo?.due_date
            ? `${proximo.name} ${prazoLabel(proximo.due_date, 'vence')} · ${formatDateBR(proximo.due_date)}`
            : 'Nenhuma fatura em aberto'}
        </ThemedText>
      </Card>
    </Animated.View>
  ) : null;

  const portfolio = (
    <>
      {lista.map((card, index) => {
        const estado = estadoFatura(card);
        const atrasadas = Number(card.overdue_count ?? 0);
        const totalFatura = Number(card.invoice_total_cents ?? 0);
        const naoPago = Number(card.unpaid_total_cents ?? 0);
        const limite = Number(card.credit_limit_cents ?? 0);
        const livre = Number(card.available_limit_cents ?? 0);
        const pct = limite > 0 ? naoPago / limite : 0;
        // A barra soma todas as não pagas; o que nem o número grande nem a faixa de atraso mostram
        // vira uma oração na linha do limite.
        const outras = outrasFaturas(card, estado);
        const podePagar = estado === 'Fechada' || estado === 'Atrasada';

        return (
          <Animated.View
            key={card.account_id}
            /*
              A faixa de atraso e o cartão são DOIS blocos dentro do mesmo `Animated.View`, e o
              `gap` do `Screen` só separa irmãos — sem este `gap` a faixa nascia colada no card
              de baixo, como se fosse o cabeçalho dele. São coisas diferentes: uma leva à fatura
              mais antiga, a outra é a fatura corrente.
            */
            style={styles.cartaoBloco}
            entering={FadeInDown.duration(Motion.duration.slow).delay(
              Math.min(index * Motion.stagger.step, Motion.stagger.cap)
            )}>
            {/* O card mostra a fatura CORRENTE. Fatura vencida não pode sumir por
                causa disso — ela vira a faixa acima, que leva direto à mais antiga. */}
            {atrasadas > 0 && card.oldest_overdue_invoice_id ? (
              <Section>
                <Row
                  icon="exclamationmark.triangle.fill"
                  destructive
                  title={
                    atrasadas === 1
                      ? 'Fatura atrasada'
                      : `${atrasadas} faturas atrasadas`
                  }
                  subtitle={brl(Number(card.overdue_total_cents ?? 0))}
                  onPress={() =>
                    router.push({
                      pathname: '/finance/invoice/[id]',
                      params: { id: card.oldest_overdue_invoice_id! },
                    })
                  }
                />
              </Section>
            ) : null}

            <PressCard
              onPress={() => irParaFatura(card)}
              acoes={[
                { nome: 'carteira', rotulo: 'Abrir na carteira', onPress: () => abrirNaCarteira(card) },
                ...(podePagar && totalFatura > 0
                  ? [{ nome: 'paguei', rotulo: 'Paguei', onPress: () => irParaFatura(card) }]
                  : []),
              ]}
              accessibilityLabel={`${card.name}, ${estado ? `fatura ${estado.toLowerCase()}` : 'sem fatura aberta'}, ${formatBRL(totalFatura)}${card.due_date ? `, ${prazoLabel(card.due_date, 'vence')}` : ''}`}>
              <View style={styles.cardHead}>
                <Miniatura card={card} onPress={() => abrirNaCarteira(card)} />
                <ThemedText type="smallBold" style={styles.cardName}>
                  {card.name}
                </ThemedText>
                {/* estado como PALAVRA, nunca só cor */}
                <View style={styles.badge}>
                  {estado === 'Atrasada' ? (
                    <Icon name="exclamationmark.triangle.fill" size="sm" color="danger" />
                  ) : null}
                  <ThemedText
                    type="footnote"
                    themeColor={estado === 'Atrasada' ? 'danger' : 'textSecondary'}>
                    {estado ?? 'Sem fatura aberta'}
                  </ThemedText>
                </View>
              </View>

              <Money
                cents={totalFatura}
                variant="title"
                tone={estado === 'Atrasada' ? 'danger' : 'text'}
              />

              <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                {card.invoice_id && card.closing_date && card.due_date
                  ? `${prazoLabel(card.closing_date, 'fecha')} · vence ${formatDateBR(card.due_date)}`
                  : `Nenhuma compra neste ciclo${card.closing_date ? ` · ${prazoLabel(card.closing_date, 'fecha')}` : ''}`}
              </ThemedText>

              {limite > 0 ? (
                <>
                  <ProgressBar
                    value={naoPago}
                    max={limite}
                    tone={pct >= 1 ? 'danger' : pct >= 0.7 ? 'warning' : 'tint'}
                  />
                  <ThemedText
                    type="footnote"
                    themeColor={livre < 0 ? 'danger' : 'textSecondary'}
                    style={tabular}>
                    {livre < 0
                      ? `${brl(Math.abs(livre))} acima do limite de ${brl(limite)}`
                      : `${brl(livre)} livre de ${brl(limite)}`}
                    {outras > 0 ? ` · inclui ${brl(outras)} de outras faturas` : ''}
                  </ThemedText>
                </>
              ) : null}

              {podePagar && totalFatura > 0 ? (
                <Button
                  label="Paguei"
                  variant="secondary"
                  size="sm"
                  onPress={() => irParaFatura(card)}
                />
              ) : null}
            </PressCard>
          </Animated.View>
        );
      })}

      {/* A tela de histórico existia e a única porta era Financeiro > Gerenciar >
          "Faturas anteriores" — longe de quem está olhando o cartão. */}
      {!cards.isLoading && !cards.isError && lista.length > 0 ? (
        <Section>
          <Row
            icon="calendar"
            title="Faturas anteriores"
            onPress={() => router.push('/finance/invoices')}
          />
        </Section>
      ) : null}

      {!cards.isLoading && !cards.isError && lista.length === 0 ? (
        <EmptyState
          icon="creditcard"
          title="Nenhum cartão cadastrado"
          hint="Cadastre o cartão com o dia que fecha e o dia que vence. Aí é só mandar “parcelei a geladeira em 12x no Nubank” no WhatsApp."
          action={{ label: 'Cadastrar cartão', onPress: () => router.push('/finance/accounts') }}
        />
      ) : null}
    </>
  );

  /**
   * No tablet, a decisão fica ao lado da vitrine: a lista mantém cartões e ações intactos,
   * enquanto este painel responde qual fatura merece atenção agora. O valor vem do resumo
   * servido pelo banco; não existe total estimado ou cálculo de ciclo nesta tela.
   */
  const currentStatement = cards.isLoading ? (
    <Skeleton height={196} radius={Radius.md} />
  ) : cards.isError ? null : (
    <Card style={styles.contextCard}>
      <HeroLabel>Fatura em foco</HeroLabel>
      {contexto ? (
        <>
          <View style={styles.contextHead}>
            <View style={styles.contextLabels}>
              <ThemedText type="smallBold">{contexto.name}</ThemedText>
              <ThemedText type="footnote" themeColor={estadoFatura(contexto) === 'Atrasada' ? 'danger' : 'textSecondary'}>
                {estadoFatura(contexto) ?? 'Sem fatura aberta'}
              </ThemedText>
            </View>
            <Money
              cents={Number(contexto.invoice_open_cents ?? contexto.invoice_total_cents ?? 0)}
              variant="subhead"
              tone={estadoFatura(contexto) === 'Atrasada' ? 'danger' : 'text'}
            />
          </View>
          <ThemedText type="footnote" themeColor="textSecondary">
            em aberto nesta fatura
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
            {contexto.closing_date && contexto.due_date
              ? `${prazoLabel(contexto.closing_date, 'fecha')} · vence ${formatDateBR(contexto.due_date)}`
              : 'Nenhuma compra neste ciclo'}
          </ThemedText>
          {contexto.invoice_id ? (
            <Button label="Abrir fatura" variant="secondary" size="sm" onPress={() => irParaFatura(contexto)} />
          ) : null}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Nenhuma fatura em aberto. Os cartões continuam disponíveis para consultar a carteira.
        </ThemedText>
      )}
    </Card>
  );

  const decisionSupport = (
    <View style={styles.paneBody}>
      {hero}
      {currentStatement}
    </View>
  );

  const compactBody = (
    <>
      {loading}
      {error}
      {hero}
      {portfolio}
    </>
  );

  const tabletBody = (
    <AdaptivePanes
      main={
        <View style={styles.paneBody}>
          {loading}
          {error}
          {portfolio}
        </View>
      }
      support={decisionSupport}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="cards-tablet-workspace"
    />
  );

  return (
    // Sem `refreshing={isRefetching}` (§6 do design): o `Screen` já segue o gesto, e a revalidação
    // que a Carteira dispara fazia o indicador girar sozinho ao voltar para cá.
    <Screen grouped wide={tablet} onRefresh={() => cards.refetch()}>
      <Stack.Screen
        options={{
          title: 'Cartões',
        }}
      />

      <HeaderActions
        actions={[{ label: 'Novo cartão', icon: 'plus', onPress: () => router.push('/finance/accounts') }]}
      />

      {tablet ? tabletBody : compactBody}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cartaoBloco: { gap: Space.sm },
  hero: {
    gap: Space.sm,
  },
  card: {
    gap: Space.sm,
  },
  paneBody: {
    gap: Space.lg,
  },
  contextCard: {
    gap: Space.sm,
  },
  contextHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  contextLabels: {
    flex: 1,
    gap: Space.xs,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  cardName: {
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  band: {
    alignItems: 'center',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
});
