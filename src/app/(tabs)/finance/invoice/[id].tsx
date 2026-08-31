import { useMemo, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ItemLink } from '@/components/ui/item-link';
import { Field, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { HeaderMenu } from '@/components/ui/header-actions';
import { InvoicePager } from '@/components/finance/invoice-pager';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useCardInvoices,
  useDeleteTransaction,
  useInvoice,
  usePayInvoice,
  useSettleInvoice,
  type Transaction,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate, useRealtimeInvalidate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * Fatura — "o que tem nesta fatura, e como eu marco como paga?".
 *
 * A ação daqui é a de maior consequência do app: `pay_invoice` cria uma transferência de verdade
 * e mexe no patrimônio. Por isso o valor e a conta aparecem escritos no botão, o erro do banco é
 * traduzido em vez de virar "tenta de novo", e o pagamento acontece num sheet, não num `Alert`.
 *
 * **O total nunca é materializado** — sai da soma das compras da fatura. A soma ainda é feita no
 * cliente sobre `useInvoice` (o doc pede uma RPC `invoice_total`, que não existe): os filtros são
 * os mesmos do banco (`kind='expense'`), mas o dia em que a lista for paginada essa soma encolhe.
 */

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paid: 'Paga',
};

function mesLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** Máscara `dd/mm/aaaa`: o number-pad não tem a tecla `/`, então ela entra sozinha. */
function mascaraData(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** `dd/mm/aaaa` → ISO, ou null se a data não existe no calendário. */
function isoDeBR(valor: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  if (!m) return null;
  const [, d, mes, ano] = m;
  const data = new Date(Number(ano), Number(mes) - 1, Number(d));
  if (data.getDate() !== Number(d) || data.getMonth() !== Number(mes) - 1) return null;
  return `${ano}-${mes}-${d}`;
}

/**
 * `pay_invoice` levanta quatro exceções diferentes e três delas NÃO se resolvem tentando de novo.
 * Dizer "erro, tenta de novo" para "fatura já paga" é mandar o usuário repetir o que não falhou.
 */
function mensagemDoErro(erro: unknown): string {
  const texto = (erro as { message?: string })?.message ?? '';
  if (texto.includes('já paga')) return 'Esta fatura já consta como paga.';
  if (texto.includes('sem lançamentos')) return 'Esta fatura não tem compras para pagar.';
  if (texto.includes('próprio cartão')) return 'O cartão não pode pagar a si mesmo. Escolha outra conta.';
  if (texto.includes('não encontrada')) return 'Não encontrei esta fatura. Volte e abra de novo.';
  return 'Não deu para registrar o pagamento. Tenta de novo.';
}

/** Delega para o helper único: no Android o `Alert` cortaria opção, o sheet compartilhado não. */
function confirmaDestrutiva(opts: { title: string; message?: string; confirm: string; onConfirm: () => void }) {
  confirmDestructive(opts.title, opts.confirm, opts.onConfirm, opts.message);
}

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

export default function InvoiceScreen() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = useInvoice(id);
  const accounts = useAccounts();
  const pay = usePayInvoice();
  const settle = useSettleInvoice();
  const remove = useDeleteTransaction();

  // `useInvoice` só escuta `transactions`: o fechamento da fatura vem do finance-scheduler e
  // mudaria só `card_invoices` — sem isto, o status ficaria velho na tela até um refetch manual.
  useRealtimeInvalidate('card_invoices', ['invoice']);

  const [pagando, setPagando] = useState(false);
  const [payerId, setPayerId] = useState<string | null>(null);
  const [dataBR, setDataBR] = useState(() => formatDateBR(localISODate()));

  const fatura = invoice.data?.invoice;
  const compras = useMemo(() => invoice.data?.transactions ?? [], [invoice.data]);
  const cartao = (accounts.data ?? []).find((a) => a.id === fatura?.account_id);
  // o pagamento é transferência: só entram contas que guardam dinheiro, nunca o próprio cartão
  const pagadoras = (accounts.data ?? []).filter(
    (a) => a.type !== 'credit_card' && a.id !== fatura?.account_id
  );

  const total = compras
    .filter((t) => t.kind === 'expense')
    .reduce((soma, t) => soma + t.amount_cents, 0);

  const dias = useMemo(() => {
    const mapa = new Map<string, Transaction[]>();
    for (const t of compras) {
      const lista = mapa.get(t.occurred_at) ?? [];
      lista.push(t);
      mapa.set(t.occurred_at, lista);
    }
    return [...mapa.entries()].map(([data, itens]) => ({ data, itens }));
  }, [compras]);

  // Quem são as faturas vizinhas. A janela default do hook é o teto (60): com
  // janela curta, quem tem anos de cartão pararia de navegar num ponto arbitrário.
  const vizinhas = useCardInvoices(fatura?.account_id);

  const paga = fatura?.status === 'paid';
  const podePagar = Boolean(fatura) && !paga && total > 0;
  const dataISO = isoDeBR(dataBR);
  const pagadora = pagadoras.find((a) => a.id === payerId);

  const abrirPagamento = () => {
    // o erro do pagamento é mostrado DENTRO do sheet (toast fica atrás do Modal nativo)
    pay.reset();
    // pré-seleciona a conta cadastrada como pagadora do cartão — sem isso o usuário escolhe
    // a mesma conta todo mês. Só vale se ela ainda for uma pagadora válida (pode ter sido
    // arquivada ou virado cartão), senão o banco recusaria e o usuário não saberia por quê.
    const sugerida = pagadoras.find((a) => a.id === cartao?.payment_account_id);
    setPayerId(sugerida?.id ?? null);
    setDataBR(formatDateBR(localISODate()));
    setPagando(true);
  };

  const registrar = () => {
    if (!fatura || !payerId || !dataISO) return;
    pay.mutate(
      { invoiceId: fatura.id, accountId: payerId, paidAt: dataISO },
      {
        onSuccess: () => {
          setPagando(false);
          toast({ message: `Fatura paga com ${pagadora?.name ?? 'a conta escolhida'}.`, tone: 'success' });
        },
        onError: (erro) => toast({ message: mensagemDoErro(erro), tone: 'error' }),
      }
    );
  };

  const apagar = (tx: Transaction) =>
    confirmaDestrutiva({
      title: 'Apagar esta compra?',
      message: `${tx.description ?? 'Sem descrição'} · ${formatBRL(tx.amount_cents)}`,
      confirm: 'Apagar',
      onConfirm: () =>
        remove.mutate(tx.id, {
          onSuccess: () => toast({ message: 'Compra apagada.', tone: 'success' }),
          onError: () => toast({ message: 'Não deu para apagar a compra.', tone: 'error' }),
        }),
    });

  /**
   * Quitar SEM movimentar dinheiro.
   *
   * O caso é dado histórico: as parcelas retroativas criam faturas de meses
   * passados que, na vida real, já foram pagas antes de o app existir. Pagá-las
   * pelo botão normal criaria uma transferência e tiraria do saldo de HOJE um
   * dinheiro que saiu há meses.
   */
  const quitarSemCaixa = () => {
    if (!fatura) return;
    confirmDestructive(
      'Marcar como paga sem mexer no saldo?',
      'Marcar como paga',
      () => {
        settle.mutate(
          { invoiceId: fatura.id, paidAt: localISODate() },
          {
            onSuccess: () => toast({ message: 'Fatura marcada como paga.', tone: 'success' }),
            onError: () =>
              toast({ message: 'Não deu para marcar a fatura. Tenta de novo?', tone: 'error' }),
          },
        );
      },
      `A fatura fica quitada e nenhum lançamento de pagamento é criado — seu saldo não muda. Use quando ela já foi paga fora do app.`,
    );
  };

  const cabecalho = (
    <View style={styles.header}>
      {/* Andar entre meses. Antes o mês só existia como TÍTULO: para ver a fatura
          passada não havia caminho nenhum a partir daqui. */}
      {fatura && vizinhas.isLoading ? (
        /* reserva a altura da linha: sem isto o pager aparece depois da lista e
           empurra tudo para baixo — "zero salto de layout" é item do checklist */
        <Skeleton height={HitTarget} radius={Radius.pill} />
      ) : null}
      {fatura && (vizinhas.data?.length ?? 0) > 1 ? (
        <InvoicePager
          invoices={vizinhas.data ?? []}
          currentId={fatura.id}
          onChange={(destino) =>
            router.setParams({ id: destino })
          }
        />
      ) : null}

      {invoice.isLoading ? (
        <>
          <Skeleton height={140} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {invoice.isError ? (
        <ErrorBand message="Não deu para carregar esta fatura." onRetry={invoice.refetch} />
      ) : null}

      {/* O único destaque da tela. */}
      {fatura ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <View style={styles.heroTop}>
              <ThemedText type="small" themeColor="textSecondary">
                {STATUS_LABEL[fatura.status] ?? fatura.status}
                {cartao ? ` · ${cartao.name}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                {compras.length} {compras.length === 1 ? 'lançamento' : 'lançamentos'}
              </ThemedText>
            </View>
            <Money cents={total} variant="money" />
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              fecha {formatDateBR(fatura.closing_date)} · vence {formatDateBR(fatura.due_date)}
            </ThemedText>
            {paga && fatura.paid_at ? (
              <View style={styles.pagaLinha}>
                <Icon name="checkmark.circle.fill" size="md" color="success" />
                <ThemedText type="small" themeColor="success">
                  Paga em {formatDateBR(fatura.paid_at)}
                </ThemedText>
              </View>
            ) : null}
          </Card>
        </Animated.View>
      ) : null}
    </View>
  );

  const rodape = fatura ? (
    <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
      O pagamento entra como transferência: as compras já contaram como gasto quando foram feitas.
    </ThemedText>
  ) : null;

  return (
    <Screen scroll={false} grouped>
      <Stack.Screen
        options={{
          title: fatura ? `Fatura de ${mesLabel(fatura.reference_month)}` : 'Fatura',
        }}
      />

      <HeaderMenu
        title="Mais opções"
        actions={
          fatura
            ? [
                {
                  label: 'Ver todas as faturas',
                  icon: 'calendar',
                  onPress: () => router.push('/finance/invoices'),
                },
                {
                  label: 'Marcar como paga (sem mexer no saldo)',
                  icon: 'checkmark.circle',
                  disabled: paga,
                  onPress: quitarSemCaixa,
                },
              ]
            : []
        }
      />

      <FlatList
        data={dias}
        style={styles.flex}
        keyExtractor={(g) => g.data}
        contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + Space.xxxl }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={cabecalho}
        ListFooterComponent={rodape}
        ListEmptyComponent={
          fatura && !invoice.isLoading ? (
            <EmptyState
              icon="doc.text"
              title="Nenhuma compra nesta fatura"
              hint="Compras no cartão caem aqui sozinhas — é só mandar “paguei 80 no mercado no Nubank” no WhatsApp."
            />
          ) : null
        }
        renderItem={({ item, index }) => (
          <Animated.View
            entering={FadeInDown.duration(Motion.duration.slow).delay(
              Math.min(index * Motion.stagger.step, Motion.stagger.cap)
            )}>
            <Section title={formatDateBR(item.data)}>
              {item.itens.map((tx) => {
                const prevista = tx.status === 'pending';
                const parcela =
                  tx.installment_no && tx.installment_plan_id ? `${tx.installment_no}ª parcela` : null;
                return (
                  <ItemLink
                    key={tx.id}
                    href={`/finance/transaction-form?id=${tx.id}`}
                    title={tx.description ?? tx.merchant ?? 'Sem descrição'}
                    actions={[
                      {
                        label: 'Editar',
                        icon: 'pencil',
                        onPress: () => router.push(`/finance/transaction-form?id=${tx.id}`),
                      },
                      { label: 'Apagar', icon: 'trash', destructive: true, onPress: () => apagar(tx) },
                    ]}>
                    {({ onLongPress }) => (
                      <Row
                        title={tx.description ?? tx.merchant ?? 'Sem descrição'}
                        subtitle={[tx.category, parcela, prevista ? 'prevista' : null]
                          .filter(Boolean)
                          .join(' · ')}
                        accessibilityLabel={`${tx.description ?? 'Sem descrição'}, ${formatBRL(tx.amount_cents)}${prevista ? ', parcela prevista' : ''}`}
                        onLongPress={onLongPress}
                        trailing={
                          <Money
                            cents={tx.amount_cents}
                            variant="headline"
                            tone={prevista ? 'textSecondary' : 'text'}
                          />
                        }
                      />
                    )}
                  </ItemLink>
                );
              })}
            </Section>
          </Animated.View>
        )}
      />

      {/* Ancorado fora do scroll: a ação primária não some quando a fatura tem 200 linhas. */}
      {podePagar ? (
        <View
          style={[
            styles.ancora,
            { backgroundColor: theme.groupedBackground, paddingBottom: insets.bottom + Space.md },
          ]}>
          <Button
            block
            size="lg"
            label={`Paguei ${formatBRL(total)}`}
            onPress={abrirPagamento}
          />
        </View>
      ) : null}

      <Modal
        visible={pagando}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPagando(false)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setPagando(false)} />
            <ThemedText type="smallBold">Pagar fatura</ThemedText>
            <View style={styles.sheetSpacer} />
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Field label="Valor" hint="Pagamento parcial não existe: a fatura é quitada inteira.">
              {/* Superfície de DECISÃO: este é o valor que a pessoa está confirmando pagar, e
                  por isso ele ignora o "esconder saldo". Confirmar no escuro é pior que ser
                  visto. */}
              <Money cents={total} variant="title2" concealable={false} />
            </Field>

            {/* Erro de rede e "não tem conta" são coisas diferentes e não podem ter o mesmo texto. */}
            {accounts.isError ? (
              <ErrorBand
                message="Não deu para carregar suas contas."
                onRetry={accounts.refetch}
              />
            ) : pagadoras.length === 0 && !accounts.isLoading ? (
              <EmptyState
                icon="building.columns"
                title="Nenhuma conta para pagar"
                hint="Cadastre a conta de onde o dinheiro sai para registrar o pagamento."
                action={{
                  label: 'Cadastrar conta',
                  onPress: () => {
                    setPagando(false);
                    router.push('/finance/accounts');
                  },
                }}
              />
            ) : (
              <Field label="Pagar com">
                <Section>
                  {pagadoras.map((a) => (
                    <Row
                      key={a.id}
                      title={a.name}
                      icon="building.columns"
                      onPress={() => setPayerId(a.id)}
                      trailing={
                        payerId === a.id ? (
                          <Icon name="checkmark" size="sm" color="tint" />
                        ) : undefined
                      }
                    />
                  ))}
                </Section>
              </Field>
            )}

            <Field
              label="Data do pagamento"
              error={dataISO ? undefined : 'Data em dd/mm/aaaa'}
              hint="Pagou ontem e está registrando hoje? Corrija aqui.">
              <TextField
                value={dataBR}
                onChangeText={(v) => setDataBR(mascaraData(v))}
                placeholder="dd/mm/aaaa"
                keyboardType="number-pad"
                invalid={!dataISO}
              />
            </Field>

            <Button
              block
              size="lg"
              // rótulo COMPLETO de propósito: é a ação irreversível da tela, e "Paguei" sozinho
              // não descreve o que vai acontecer (nem na tela, nem no leitor de tela)
              label={
                pay.isPending
                  ? 'Registrando…'
                  : `Paguei ${formatBRL(total)}${pagadora ? ` com ${pagadora.name}` : ''}`
              }
              loading={pay.isPending}
              disabled={!payerId || !dataISO}
              onPress={registrar}
            />

            {pay.isError ? (
              <ThemedText type="small" themeColor="danger" style={styles.centered}>
                {mensagemDoErro(pay.error)}
              </ThemedText>
            ) : null}

            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              Entra como transferência — o gasto já contou na compra.
            </ThemedText>
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  lista: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
  header: {
    gap: Space.lg,
  },
  hero: {
    gap: Space.sm,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  pagaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  rodape: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
  band: {
    alignItems: 'center',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
  ancora: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
  sheet: {
    flex: 1,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  sheetSpacer: {
    width: Space.xxxl,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
});
