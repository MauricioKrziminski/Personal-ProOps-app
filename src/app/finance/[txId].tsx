import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { useBRL } from '@/components/ui/conceal';
import { ErrorCard } from '@/components/error-card';
import { currentMonth, monthTitle } from '@/components/finance/month-picker';
import { Card } from '@/components/ui/card';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { HeaderActions } from '@/components/ui/header-actions';
import { describeRRule } from '@/lib/rrule-text';
import { paymentMethodLabel } from '@/lib/payment-method';
import { EXPENSE_PATTERN_LABELS, EXPENSE_NECESSITY_LABELS } from '@/lib/expense-classification';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  DEBT_KINDS,
  SUGGESTED_CATEGORIES,
  useAccounts,
  useAparencia,
  useCategoriesUsed,
  useDeleteTransaction,
  useInvoiceHead,
  useInstallmentPlanResumo,
  useRecurringSerie,
  useSaveTransaction,
  useTransaction,
  type Transaction,
} from '@/hooks/use-finance';
import { useApagarComAlcance } from '@/hooks/use-apagar-com-alcance';
import { alvoDoLancamento } from '@/lib/apagar-com-alcance';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { detalheDoPagamento } from '@/lib/confirmar-baixa';
import { foldCategory, mergeCategories } from '@/lib/categories-merge';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive } from '@/lib/item-actions';
import { dueLabel, estadoDaLinha, settleLabel } from '@/lib/settle-labels';
import { dataLocalDe, isoToBR } from '@/lib/dates';
import { paramsDaCopia, podeDuplicar } from '@/lib/duplicar';
import { useSalvarFavorito, NOME_REPETIDO } from '@/hooks/use-favoritos';
import { useNomeDoFavorito } from '@/components/finance/nome-do-favorito';
import { useConfirmarBaixa } from '@/components/finance/confirmar-baixa';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { hrefDoLancamento, hrefDoLancar } from '@/lib/lancar';
import { useBillReminderFor } from '@/hooks/use-bill-reminders';
import { alvosDoAberto, hrefDoLembrete, resumoDosAvisos } from '@/lib/lembrete-de-conta';

/**
 * Lançamento (detalhe) — a tela que faltava.
 *
 * Até aqui, tocar num lançamento abria direto o formulário de edição: para **ler** era preciso
 * entrar na tela que altera. Este detalhe mostra o que o app já coletava e nunca exibia
 * (`merchant`, `invoice_id`, `installment_no`, o parse da IA) e deixa a edição a um toque.
 */

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: 'criado no app',
  import: 'importado de extrato',
  recurring: 'gerado por recorrência',
};

const SOURCE_ICON: Record<Transaction['source'], SymbolViewProps['name']> = {
  whatsapp: 'bubble.left',
  app: 'iphone',
  import: 'square.and.arrow.down',
  recurring: 'arrow.triangle.2.circlepath',
};

const KIND_LABEL: Record<Transaction['kind'], string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
};

/** `2026-08-23` → `23 de agosto de 2026`. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** Um menu nativo, não uma lista: as mais usadas; o resto é o formulário (a busca do seletor). */
const CATEGORIAS_NO_MENU = 10;

export default function TransactionDetailScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const params = useLocalSearchParams<{ txId: string; month?: string }>();
  const txId = params.txId;
  // O mês só serve para voltar ao formulário no contexto certo.
  const month = params.month ?? currentMonth();

  // Busca por ID, não dentro da lista do mês. Procurar na lista fazia lançamento
  // antigo — ou além do `limit(200)` do mês — cair em "não existe mais", que é a
  // mesma tela de um registro apagado de verdade.
  const list = useTransaction(txId);
  const tx = list.data;

  const accounts = useAccounts();
  // As categorias do USUÁRIO, por uso, no submenu "Mudar categoria" — as 13 sugestões sozinhas
  // escondiam as que ele usa ("roupa", "eletrônicos") justamente onde ele ia trocá-las.
  const categoriasUsadas = useCategoriesUsed();
  const aparencia = useAparencia();
  // Só o que o detalhe desenha de cada vizinho, cada um pelo id e numa ida: a fatura (mês e
  // vencimento), a compra desta parcela e a série. Cada uma só liga se o lançamento tem o vínculo.
  const invoice = useInvoiceHead(tx?.invoice_id ?? undefined);
  const plans = useInstallmentPlanResumo(tx?.installment_plan_id);
  const plano = plans.data ?? undefined;
  const series = useRecurringSerie(tx?.recurring_id);
  const serie = series.data ?? undefined;
  // Lembrete de conta: o do alvo "só esta" OU o da série/compra. Hooks antes de qualquer return.
  const alvosLembrete = tx ? alvosDoAberto({ tipo: 'lancamento', tx }) : null;
  const lembreteSo = useBillReminderFor(alvosLembrete?.so ?? null);
  const lembreteTodas = useBillReminderFor(alvosLembrete?.todas ?? null);
  const lembrete = lembreteSo ?? lembreteTodas;
  const salvarFavorito = useSalvarFavorito();
  const nomeDoFavorito = useNomeDoFavorito();
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  // Voltar só no sucesso do hook: depois do desmonte o callback da mutação não dispara.
  const { apagar } = useApagarComAlcance(() => router.back());
  // "Paguei" confirma o valor numa folha curta (25/09/2026). Dada a baixa, volta para a lista.
  const baixa = useConfirmarBaixa({ aoConcluir: () => router.back() });
  // `refetch` ignora `enabled`: só refaz o que o lançamento realmente tem.
  const refresh = () => Promise.all([
    list.refetch(),
    tx?.invoice_id ? invoice.refetch() : null,
    tx?.installment_plan_id ? plans.refetch() : null,
    tx?.recurring_id ? series.refetch() : null,
  ]);

  const accountLabel = tx?.account_id
    ? ((accounts.data ?? []).find((a) => a.id === tx.account_id)?.name ?? null)
    : null;

  /** Reenvia o lançamento inteiro: o hook faz `update` com os campos que recebe. */
  const patch = (changes: Partial<{ category: string | null }>) => {
    if (!tx) return;
    save.mutate(
      {
        id: tx.id,
        expectedRevision: tx.edit_revision,
        kind: tx.kind,
        amount_cents: tx.amount_cents,
        category: tx.category,
        description: tx.description,
        account_id: tx.account_id,
        counterparty_account_id: tx.counterparty_account_id,
        occurred_at: tx.occurred_at,
        ...changes,
      },
      {
        onSuccess: () => toast({ message: 'Pronto, atualizei.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para salvar. Tenta de novo.', tone: 'error' }),
      }
    );
  };

  /** O favorito nasce com o título (ou o estabelecimento) do lançamento; renomear é na tela Favoritos. */
  const virarFavorito = () => {
    if (!tx) return;
    const padrao = tx.description || tx.merchant || tx.category || '';
    nomeDoFavorito.pedir(padrao, (name) => salvarFavorito.mutate({ name, modelo: tx }, {
      onSuccess: () => toast({ message: <><Forte>{name}</Forte> virou favorito.</>, tone: 'success' }),
      onError: (e: any) => toast({ message: e?.code === NOME_REPETIDO ? 'Já existe um favorito com esse nome.' : 'Não deu para salvar o favorito. Tenta de novo.', tone: 'error' }),
    }));
  };

  /** Abre o formulário pré-preenchido para hoje; a pessoa revisa e salva (uma intenção nova). */
  const duplicate = () => {
    if (!tx) return;
    router.push(hrefDoLancar('uma', paramsDaCopia(tx, isoToBR(localISODate()), plano?.installments).params));
  };

  /** Apagar é action sheet nativo, e a mensagem diz o que some. */
  const confirmDelete = () => {
    if (!tx) return;
    const what = `${formatBRL(tx.amount_cents)}${tx.category ? ` em ${tx.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(tx.id, {
          // `back` antes da invalidação: senão a tela repinta sem a transação e pisca "não existe".
          onSuccess: () => {
            router.back();
            toast({ message: `Apaguei ${what}.`, tone: 'success' });
          },
          onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para apagar. Tenta de novo.'), tone: 'error' }),
        }),
      tx.pays_invoice_id ? `${what}. O valor volta a faltar na fatura.` : `${what}. Isso não volta.`
    );
  };

  /*
    O PORTÃO DA TELA (Fase 5) — um portão para não entrarem em pipoca o nome da conta, a fatura em
    que a compra caiu e a série da recorrência. Ele continua, mas é RÁPIDO: o item nasce da lista
    em cache (sem ida), e fatura, compra e série são consultas enxutas por id que partem juntas,
    uma ida cada. O custo aceito: sem a linha na lista, o item ainda precede as três (cascata).

    ⚠️ **`invoice`, `plans` e `series` nascem desligadas** quando o lançamento não tem o vínculo
    (`enabled: Boolean(id)`), e é justamente por isso que `telaPronta` lê `fetchStatus`: sem isso,
    todo lançamento em dinheiro ficaria no skeleton para sempre.
  */
  const pronta = useTelaPronta(list, accounts, invoice, plans, series);

  if (!pronta) {
    return (
      <Screen grouped wide={tablet} onRefresh={refresh}>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <View style={styles.heroSkeleton}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="70%" height={46} />
        </View>
        <SkeletonRow />
        <SkeletonRow />
        <Skeleton height={120} radius={Radius.md} />
      </Screen>
    );
  }

  if (list.isError) {
    return (
      <Screen grouped wide={tablet} onRefresh={refresh}>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <ErrorCard onRetry={list.refetch} />
      </Screen>
    );
  }

  if (!tx) {
    return (
      <Screen grouped wide={tablet} onRefresh={refresh}>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <EmptyState
          icon="questionmark.folder"
          title="Isto não existe mais"
          hint="Esse lançamento pode ter sido apagado em outro aparelho."
          action={{ label: 'Ver lançamentos', onPress: () => router.replace('/finance/transactions') }}
        />
      </Screen>
    );
  }

  const title = tx.description || tx.merchant || tx.category || 'Lançamento';
  const created = dataLocalDe(tx.created_at);
  const signedAmount = tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents;
  const hoje = localISODate();
  const estado = estadoDaLinha(tx, hoje);
  // Pagamento de dívida: o que o valor pago carrega, embaixo do total (parcela + encargo/desconto,
  // ou amortização + juros). Lido da linha, então muda junto quando o valor é corrigido.
  const detalheDaDivida = detalheDoPagamento(tx, tx.debts?.calculation_mode, brl);

  const mainContent = (
    <>
      {/* O único destaque: é o que a pessoa veio conferir em três segundos. */}
      <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
        <Card style={styles.hero}>
          <HeroLabel accessibilityLabel={`${KIND_LABEL[tx.kind]} de ${brl(tx.amount_cents)}`}>
            {KIND_LABEL[tx.kind]}
          </HeroLabel>
          <Money
            cents={signedAmount}
            variant="money"
            tone={tx.kind === 'income' ? 'success' : tx.kind === 'transfer' ? 'textSecondary' : 'text'}
            signed={tx.kind !== 'transfer'}
          />
          {detalheDaDivida ? (
            <ThemedText type="small" style={tabular}>
              {detalheDaDivida}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={tabular}>
            {[longDate(tx.occurred_at), tx.category, tx.subcategories?.name, accountLabel].filter(Boolean).join(' · ')}
          </ThemedText>
        </Card>
      </Animated.View>

      {/* Previsto: a única faixa de status. `cleared` não precisa de rótulo. */}
      {tx.status === 'pending' ? (
        <Section
          /*
           * ⚠️ A CONDIÇÃO é o `status` — esta seção carrega o botão de dar baixa, e o dinheiro de
           * uma compra de cartão ainda não saiu. O que o `estadoDaLinha` decide é só o TÍTULO:
           * "Ainda não aconteceu" em cima de uma compra de semana passada era a mesma mentira da
           * pílula da lista.
           *
           * ⚠️ **`'não caiu'` (receita vencida) precisa do próprio texto.** Caindo no genérico de
           * despesa, uma receita que ainda não caiu lia "não saiu do caixa" — invertido. É a
           * mesma classe de erro que fez `settle-labels.ts` existir.
           *
           * O `else` final só sobra para `estado === null` numa linha `pending`: é a compra de
           * cartão que já ACONTECEU (não é `atrasado`/`previsto`/`não caiu`, que exigem data).
           * "Já aconteceu, mas ainda não saiu do caixa" é o texto certo para esse caso — não é
           * default preguiçoso.
           */
          title={
            estado === 'atrasado'
              ? 'Passou da data'
              : estado === 'não caiu'
                ? 'Ainda não caiu'
                : estado === 'previsto'
                  ? 'Ainda não aconteceu'
                  : 'Ainda não saiu do caixa'
          }>
          <Row
            title={dueLabel(tx.kind, tx.due_at ? formatDateBR(tx.due_at) : null, {
              onCard: tx.invoice_id !== null,
            })}
            icon="clock"
            trailing={
              <Button
                label={settleLabel(tx.kind)}
                size="sm"
                variant="secondary"
                onPress={() => baixa.abrir(tx.id)}
              />
            }
          />
        </Section>
      ) : null}
    </>
  );

  const supportContent = (
    <>
      {tx.kind === 'expense' && !tx.pays_invoice_id ? (
        <Section title="Classificação">
          <Row title={tx.expense_pattern ? EXPENSE_PATTERN_LABELS[tx.expense_pattern] : 'Não informado'}
            subtitle="Previsibilidade" chevron={false} />
          <Row title={tx.expense_necessity ? EXPENSE_NECESSITY_LABELS[tx.expense_necessity] : 'Não informado'}
            subtitle="Necessidade" chevron={false} />
        </Section>
      ) : null}
      {lembrete ? (
        <Section>
          <Row icon="bell" title={resumoDosAvisos(lembrete.avisos)}
            onPress={() => router.push(hrefDoLembrete({ tipo: 'lancamento', tx }, title))} />
        </Section>
      ) : null}
      <Section title="Como isso entrou">
        <Row title={SOURCE_LABEL[tx.source]} subtitle="Origem" icon={SOURCE_ICON[tx.source]} />
        <Row title={paymentMethodLabel(tx.payment_method)} subtitle="Forma de pagamento" icon="creditcard" />
        {tx.merchant ? <Row title={tx.merchant} subtitle="Estabelecimento" icon="storefront" /> : null}
        {created !== tx.occurred_at ? (
          <Row title={formatDateBR(created)} subtitle="Registrado em" icon="calendar" />
        ) : null}
      </Section>

      {(tx.invoice_id || tx.installment_plan_id || tx.recurring_id || tx.debt_id) && (
        <Section title="Faz parte de">
          {tx.debt_id ? (
            <Row
              title={
                tx.debt_payment_no && tx.debts?.installments
                  ? `Parcela ${tx.debt_payment_no} de ${tx.debts.installments}`
                  : tx.debt_payment_no
                    ? `Parcela ${tx.debt_payment_no}`
                    : 'Pagamento de dívida'
              }
              subtitle={tx.debts?.name ?? 'Ver dívida'}
              icon={DEBT_KINDS.find((k) => k.value === tx.debts?.kind)?.icon ?? 'doc.text'}
              accessibilityLabel="Ver a dívida que este pagamento abateu"
              onPress={() => router.push({ pathname: '/finance/debts', params: { id: tx.debt_id! } })}
            />
          ) : null}
          {tx.invoice_id ? (
            <Row
              title={
                invoice.data
                  ? `Fatura de ${monthTitle(invoice.data.reference_month.slice(0, 7))}`
                  : 'Fatura do cartão'
              }
              subtitle={
                invoice.data ? `vence ${formatDateBR(invoice.data.due_date)}` : 'Ver fatura'
              }
              icon="creditcard"
              accessibilityLabel="Ver a fatura em que essa compra caiu"
              onPress={() =>
                router.push({ pathname: '/finance/invoice/[id]', params: { id: tx.invoice_id! } })
              }
            />
          ) : null}
          {tx.recurring_id ? (
            <Row
              title={serie ? `Repete ${describeRRule(serie.rrule)}` : 'Faz parte de uma recorrência'}
              subtitle={
                serie
                  ? `${brl(serie.amount_cents)} por vez`
                  : 'Ver série'
              }
              icon="repeat"
              accessibilityLabel="Editar a série recorrente que gerou este lançamento"
              onPress={() =>
                router.push(hrefDoLancar('recorrente', { id: tx.recurring_id!, origem: 'serie' }))
              }
            />
          ) : null}
          {tx.installment_plan_id ? (
            <Row
              title={
                tx.installment_no && plano
                  ? `Parcela ${tx.installment_no} de ${plano.installments}`
                  : tx.installment_no
                    ? `Parcela ${tx.installment_no}`
                    : 'Compra parcelada'
              }
              subtitle={
                plano
                  ? // A data no topo é a da PARCELA (o mês em que ela cai); a da compra mora aqui.
                    `${brl(plano.total_cents)} no total · compra em ${formatDateBR(plano.first_occurred_at)}`
                  : 'Ver parcelas'
              }
              icon="rectangle.split.3x1"
              accessibilityLabel="Ver a compra parcelada inteira"
              onPress={() => router.push('/finance/installments')}
            />
          ) : null}
        </Section>
      )}
    </>
  );

  const compactBody = (
    <>
      {mainContent}
      {supportContent}
    </>
  );

  const tabletBody = (
    <AdaptivePanes
      main={<View style={styles.paneBody}>{mainContent}</View>}
      support={<View style={styles.paneBody}>{supportContent}</View>}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="transaction-detail-tablet-workspace"
    />
  );

  const acoesDeCategoria = [
    ...mergeCategories(categoriasUsadas.data ?? [], SUGGESTED_CATEGORIES, tx.category)
      .slice(0, CATEGORIAS_NO_MENU)
      .map((option) => {
        const icone = aparencia(option.label).icon;
        return {
          label: option.label,
          // o menu nativo só aceita o NOME do SF Symbol (toda a grade é nome)
          icon: typeof icone === 'string' ? icone : undefined,
          selected: !!tx.category && foldCategory(tx.category) === foldCategory(option.label),
          onPress: () => patch({ category: option.label }),
        };
      }),
    { label: 'Gerenciar categorias', icon: 'slider.horizontal.3' as const, onPress: () => router.push('/finance/categories') },
  ];

  return (
    <Screen
      grouped
      wide={tablet}
      onRefresh={refresh}>
      <Stack.Screen options={{ title }} />

      {/*
        UM componente desenha o header inteiro — botão e menu juntos.

        Declarar `<HeaderActions>` e `<HeaderMenu>` lado a lado PARECIA funcionar e não
        funcionava: os dois montam `headerRight` e `setOptions` faz merge raso, então no
        Android o menu apagava o "Editar" sem erro nenhum. Como toda lista do app desemboca
        aqui, editar um lançamento pelo app ficou inalcançável. `anti-slop.test.ts` prende.
      */}
      <HeaderActions
        actions={[
          {
            label: 'Editar',
            onPress: () => router.push(hrefDoLancamento(tx, { month })),
          },
        ]}
        menu={{
          title: 'Lançamento',
          actions: [
            ...(tx.pix_fee_for_transaction_id ? [] : [{
              label: 'Mudar categoria',
              icon: 'tag' as const,
              // Numa série, parcela ou dívida, a categoria tem alcance. O formulário pergunta
              // depois da edição; o atalho de uma escrita só ignoraria essa decisão.
              ...(tx.recurring_id || tx.installment_plan_id || tx.debt_id
                ? { onPress: () => router.push(hrefDoLancamento(tx, { month })) }
                : { actions: acoesDeCategoria }),
            }]),
            // Pagamento de dívida não duplica: a cópia seria um gasto solto, sem baixar a dívida.
            // A próxima parcela se paga no "Paguei" de Dívidas. O de FATURA também: a cópia seria
            // uma transferência para o cartão que a fatura não conta — paga-se de novo na fatura.
            ...(podeDuplicar(tx)
              ? [
                  { label: 'Duplicar', icon: 'plus.square.on.square' as const, onPress: duplicate },
                  { label: 'Virar favorito', icon: 'star' as const, onPress: virarFavorito },
                ]
              : []),
            // Pagamento de dívida, de fatura e juro do Pix não são conta a vencer.
            ...(tx.kind === 'expense' && !tx.debt_id && !tx.pays_invoice_id && !tx.pix_fee_for_transaction_id &&
                (tx.status === 'pending' || tx.recurring_id || tx.installment_plan_id || tx.invoice_id)
              ? [{
                  label: lembrete ? 'Editar lembrete' : tx.invoice_id && !tx.recurring_id && !tx.installment_plan_id ? 'Lembrar da fatura' : 'Lembrar',
                  icon: 'bell' as const,
                  onPress: () => router.push(hrefDoLembrete({ tipo: 'lancamento', tx }, title)),
                }]
              : []),
            {
              label: 'Apagar',
              icon: 'trash',
              destructive: true,
              onPress: () => {
                const alvo = alvoDoLancamento(tx, title);
                if (alvo) apagar(alvo);
                else confirmDelete();
              },
            },
          ],
        }}
      />

      {tablet ? tabletBody : compactBody}
      {baixa.folha}
      {nomeDoFavorito.folha}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  heroSkeleton: {
    gap: Space.md,
  },
  paneBody: {
    gap: Space.lg,
    minWidth: 0,
  },
});
