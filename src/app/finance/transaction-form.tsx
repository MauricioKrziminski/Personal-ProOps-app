import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';

import { CategoryPicker } from '@/components/finance/category-picker';
import { Chip } from '@/components/finance/chip';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Motion, Space, Type } from '@/design/tokens';
import {
  useAccounts,
  useCreateInstallmentPlan,
  useDeleteTransaction,
  useSaveTransaction,
  useSaveTransactionScoped,
  useTransaction,
  type Transaction,
  type TransactionKind,
} from '@/hooks/use-finance';
import { brToISO, formatBRL, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import { financeErrorMessage, installmentHistory } from '@/lib/finance-form';
import {
  autoConfirmHint,
  autoConfirmLabel,
  dueFieldHint,
  dueFieldLabel,
} from '@/lib/settle-labels';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { accountLabel } from '@/lib/accounts';

/**
 * Novo/editar lançamento — modal do Stack raiz (Cancelar nativo vem do `_layout.tsx`).
 *
 * O item em edição vem de `useTransaction(id)`, nunca do cache da lista: com cache frio o modal
 * de EDIÇÃO virava modal de CRIAÇÃO em silêncio e duplicava o lançamento. Por isso a decisão
 * "é edição ou criação?" acontece ANTES de montar o form (o gate abaixo) — enquanto a query não
 * responde, não existe formulário para submeter.
 */

const KINDS: { value: TransactionKind; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Receita' },
  { value: 'transfer', label: 'Transferência' },
];

/** Opções de parcelamento mais comuns no varejo brasileiro. */
const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 10, 12, 18, 24] as const;

const schema = z
  .object({
    kind: z.enum(['expense', 'income', 'transfer']),
    amount_cents: z.number().int().positive('Informe o valor'),
    category: z.string().nullable(),
    description: z.string().nullable(),
    merchant: z.string().nullable(),
    account_id: z.string().nullable(),
    counterparty_account_id: z.string().nullable(),
    // 1 = à vista; >= 2 vira plano de parcelas (RPC create_installment_plan)
    installments: z.number().int().min(1).max(72),
    // Pix no crédito: o que o cartão cobra a MAIS do que o boleto pediu. 0 = compra normal.
    fee_cents: z.number().int().min(0),
    /** `transactions.auto_confirm` — entra sozinho na data em vez de esperar baixa. */
    auto_confirm: z.boolean(),
    paid_installments: z.string(),
    occurred_at: z.string().refine(isValidBRDate, 'Data em dd/mm/aaaa'),
    /** "Isso ainda vai acontecer" — vira `status='pending'`, a base da projeção de caixa. */
    pending: z.boolean(),
    due_at: z.string().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.installments <= 1 || !isValidBRDate(data.occurred_at)) return;
    try { installmentHistory(data.paid_installments, data.installments, brToISO(data.occurred_at), localISODate()); }
    catch (error) { ctx.addIssue({ code: 'custom', path: ['paid_installments'], message: (error as Error).message }); }
  })
  .refine((data) => data.installments === 1 || (data.kind === 'expense' && !!data.account_id), {
    message: 'Parcelamento precisa de uma conta/cartão e só vale para gastos',
    path: ['installments'],
  })
  .refine((data) => data.kind !== 'transfer' || !!data.counterparty_account_id, {
    message: 'Escolha a conta de destino',
    path: ['counterparty_account_id'],
  })
  .refine(
    (data) =>
      data.kind !== 'transfer' ||
      !data.counterparty_account_id ||
      data.account_id !== data.counterparty_account_id,
    { message: 'Origem e destino precisam ser diferentes', path: ['counterparty_account_id'] },
  )
  .refine((data) => !data.pending || (!!data.due_at && isValidBRDate(data.due_at)), {
    message: 'Informe o vencimento em dd/mm/aaaa',
    path: ['due_at'],
  })
  // ISO compara lexicograficamente, então `>=` já é comparação de data.
  .refine(
    (data) =>
      !data.pending ||
      !data.due_at ||
      !isValidBRDate(data.due_at) ||
      !isValidBRDate(data.occurred_at) ||
      brToISO(data.due_at) >= brToISO(data.occurred_at),
    { message: 'O vencimento não pode ser antes da data do lançamento', path: ['due_at'] },
  );

type FormValues = z.infer<typeof schema>;

export default function TransactionFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const query = useTransaction(params.id);

  if (params.id && query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Editar lançamento' }} />
        <View style={styles.loading}>
          <Skeleton height={56} />
          <Skeleton height={36} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
        </View>
      </Screen>
    );
  }

  // Nunca cair em modo criação por omissão: um id que não resolve é erro, não formulário vazio.
  if (params.id && (query.isError || !query.data)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <Card>
          <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">Não encontrei esse lançamento</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              Ele pode ter sido apagado em outro aparelho.
            </ThemedText>
            <View style={styles.errorActions}>
              <Button
                label="Tentar de novo"
                variant="secondary"
                size="sm"
                onPress={() => query.refetch()}
              />
              <Button label="Voltar" size="sm" onPress={() => router.back()} />
            </View>
          </View>
        </Card>
      </Screen>
    );
  }

  // `?? undefined`: `useTransaction` devolve null quando a linha não existe mais
  // (maybeSingle), e "não achei" e "não estou editando" são o mesmo caso aqui —
  // o form abre em branco, que é o comportamento de criar.
  return <TransactionForm editing={query.data ?? undefined} />;
}

function TransactionForm({ editing }: { editing?: Transaction }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { data: accounts } = useAccounts();

  const save = useSaveTransaction();
  const salvarSerie = useSaveTransactionScoped();
  const createPlan = useCreateInstallmentPlan();
  const remove = useDeleteTransaction();

  const { control, handleSubmit, setValue, getValues, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // `editing` já chegou resolvido pelo gate — sem `useEffect`+`reset`, sem corrida.
    defaultValues: {
      kind: editing?.kind ?? 'expense',
      amount_cents: editing?.amount_cents ?? 0,
      category: editing?.category ?? null,
      description: editing?.description ?? null,
      merchant: editing?.merchant ?? null,
      account_id: editing?.account_id ?? null,
      counterparty_account_id: editing?.counterparty_account_id ?? null,
      installments: 1,
      paid_installments: '',
      fee_cents: 0,
      auto_confirm: editing?.auto_confirm ?? false,
      occurred_at: isoToBR(editing?.occurred_at ?? localISODate()),
      pending: editing?.status === 'pending',
      due_at: editing?.due_at ? isoToBR(editing.due_at) : null,
    },
  });

  // useWatch (e não watch()): watch() não é memoizável e o React Compiler pula a tela inteira
  const kind = useWatch({ control, name: 'kind' });
  const occurredAt = useWatch({ control, name: 'occurred_at' });
  const accountId = useWatch({ control, name: 'account_id' });
  const amountCents = useWatch({ control, name: 'amount_cents' });
  const installmentCount = useWatch({ control, name: 'installments' });
  const paidHistory = useWatch({ control, name: 'paid_installments' });
  const pending = useWatch({ control, name: 'pending' });
  const errors = formState.errors;

  // "hoje"/"ontem" congelados na abertura do modal: ler o relógio durante o render é impuro
  // (React Compiler) e o modal é efêmero.
  const [{ today, yesterday }] = useState(() => ({
    today: isoToBR(localISODate()),
    yesterday: isoToBR(localISODate(new Date(Date.now() - 86_400_000))),
  }));

  const account = (accounts ?? []).find((a) => a.id === accountId);
  const isCard = account?.type === 'credit_card';
  /**
   * Conta a pagar não existe em cartão: a compra já entra na fatura e o caixa sai quando a
   * fatura vence. Marcar `pending` aqui contaria o MESMO gasto duas vezes na projeção.
   */
  const podeAdiar = kind !== 'transfer' && !isCard;
  // parcelar só faz sentido em gasto com conta escolhida (normalmente cartão)
  const podeParcelar = kind === 'expense' && !!accountId && !editing;

  const saving = save.isPending || createPlan.isPending;

  /**
   * O que mudou E vale para a série inteira. Data fica de fora: ela é de cada
   * ocorrência, e propagar empilharia todas as parcelas no mesmo dia.
   *
   * Chave só entra quando o valor MUDOU — mandar o objeto inteiro faria "corrigi só
   * o nome" reescrever a categoria das 40 parcelas com o que estava no formulário.
   */
  const patchDaSerie = (values: FormValues) => {
    if (!editing) return {};
    const patch: Record<string, unknown> = {};
    if (values.amount_cents !== editing.amount_cents) patch.amount_cents = values.amount_cents;
    if ((values.category ?? null) !== editing.category) patch.category = values.category ?? null;
    const desc = values.description?.trim() || null;
    if (desc !== editing.description) patch.description = desc;
    const merc = values.merchant?.trim() || null;
    if (merc !== editing.merchant) patch.merchant = merc;
    if ((values.account_id ?? null) !== editing.account_id) patch.account_id = values.account_id ?? null;
    return patch;
  };

  const onSubmit = handleSubmit((values) => {
    // parcelado: quem cria as N transações (e resolve a fatura de cada uma) é o
    // banco, não o app — mesma regra usada pelo WhatsApp.
    if (!editing && values.installments > 1 && values.account_id) {
      createPlan.mutate(
        {
          accountId: values.account_id,
          totalCents: values.amount_cents,
          installments: values.installments,
          paidInstallments: installmentHistory(values.paid_installments, values.installments, brToISO(values.occurred_at), localISODate()),
          occurredAt: brToISO(values.occurred_at),
          description: values.description?.trim() || null,
          category: values.category,
        },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
          },
          onError: (error) =>
            toast({ message: financeErrorMessage(error, 'Não deu para parcelar. Tenta de novo.'), tone: 'error' }),
        },
      );
      return;
    }

    // Reforço do `podeAdiar`: trocar para cartão depois de marcar "vou pagar depois" não
    // pode vazar um `pending` que a UI já escondeu.
    const adiado = podeAdiar && values.pending;
    /**
     * ⚠️ Em cartão o campo "vou pagar depois" NÃO existe (`podeAdiar` é false), então
     * `adiado` é sempre false ali — e escrever `'cleared'` a partir disso DAVA BAIXA numa
     * parcela futura só porque alguém corrigiu o nome dela. A projeção de caixa e o total
     * da fatura mudavam sozinhos, sem nada na tela dizendo isso.
     *
     * Onde o campo não aparece, o status não é do formulário: ele é o que já era.
     */
    const status = podeAdiar ? (adiado ? 'pending' : 'cleared') : (editing?.status ?? 'cleared');

    const patch = patchDaSerie(values);
    const naSerie = Boolean(editing?.installment_plan_id || editing?.recurring_id);

    const gravar = (escopo: 'one' | 'future') =>
      save.mutate(
      {
        id: editing?.id,
        kind: values.kind,
        amount_cents: values.amount_cents,
        category: values.kind === 'transfer' ? null : values.category,
        description: values.description?.trim() || null,
        merchant: values.merchant?.trim() || null,
        account_id: values.account_id,
        counterparty_account_id: values.kind === 'transfer' ? values.counterparty_account_id : null,
        occurred_at: brToISO(values.occurred_at),
        status,
        due_at: adiado && values.due_at ? brToISO(values.due_at) : editing?.due_at ?? null,
        fee_cents: editing ? 0 : values.fee_cents,
        // Só faz diferença em previsto: `_promote_due_transactions` só olha `pending`.
        auto_confirm: adiado ? values.auto_confirm : false,
      },
      {
        onSuccess: () => {
          // A âncora já foi gravada com o formulário inteiro (inclusive data, que não
          // se propaga). A RPC leva o resto da série — e reescreve a âncora com os
          // mesmos valores, que é barato e mantém UM caminho para a regra do lote.
          if (escopo === 'future' && editing) {
            salvarSerie.mutate(
              { id: editing.id, scope: 'future', patch },
              {
                onSuccess: (quantas) => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  router.back();
                  toast({ message: `Alterei ${quantas} ${quantas === 1 ? 'lançamento' : 'lançamentos'} desta série.`, tone: 'success' });
                },
                // A âncora JÁ mudou aqui: dizer só "não deu para salvar" seria mentira.
                onError: (error) => toast({
                  message: financeErrorMessage(error, 'Salvei este, mas não consegui aplicar nos futuros. Tenta de novo.'),
                  tone: 'error',
                }),
              },
            );
            return;
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
        // Erro NUNCA fecha o modal: o que foi digitado continua na tela.
        onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para salvar. Tenta de novo.'), tone: 'error' }),
      },
    );

    // A pergunta é no SALVAR, não na abertura: só aqui se sabe se mudou algum campo
    // que faz sentido propagar. Sem mudança propagável, não há escolha a fazer.
    if (naSerie && Object.keys(patch).length > 0) {
      showItemActions(
        'Aplicar em quais?',
        [
          { label: 'Só esta', onPress: () => gravar('one') },
          { label: 'Esta e as futuras', onPress: () => gravar('future') },
        ],
        'As anteriores não mudam — só se você editar cada uma.',
      );
      return;
    }
    gravar('one');
  });

  const onDelete = () => {
    if (!editing) return;
    const what = `${formatBRL(editing.amount_cents)}${editing.category ? ` em ${editing.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(editing.id, {
          onSuccess: () => {
            router.back();
            toast({ message: `Apaguei ${what}.`, tone: 'success' });
          },
          onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para apagar. Tenta de novo.'), tone: 'error' }),
        }),
      `${what}. Isso não volta.`,
    );
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen
        options={{
          title: editing ? 'Editar lançamento' : 'Novo lançamento',
        }}
      />

      <HeaderActions
        actions={[{ label: saving ? 'Salvando…' : 'Salvar', disabled: saving, primary: true, onPress: onSubmit }]}
      />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Space.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {editing?.debt_id ? (
          <Card>
            <ThemedText type="small" themeColor="textSecondary">Pagamento de dívida. Correções de valor recalculam o saldo somente no pagamento mais recente com histórico de amortização.</ThemedText>
            <Button label="Dívidas e financiamentos" variant="ghost" size="sm" onPress={() => router.push('/finance/debts')} />
          </Card>
        ) : null}
        {!editing ? (
          <View style={styles.errorActions}>
            <Button label="Repetir lançamento" variant="secondary" size="sm" onPress={() => {
              const values = getValues();
              router.replace({ pathname: '/finance/recurring', params: {
                create: '1', kind: values.kind === 'income' ? 'income' : 'expense',
                amount: String(values.amount_cents), description: values.description ?? '',
                category: values.category ?? '', account: values.account_id ?? '', start: values.occurred_at,
              } });
            }} />
            <Button label="Financiamento" variant="secondary" size="sm" onPress={() => router.push({ pathname: '/finance/debts', params: { create: 'financing' } })} />
          </View>
        ) : null}
        {/*
          Tipo primeiro porque ele decide QUAIS campos existem: transferência troca
          "Categoria" por "Para a conta". Controle que remonta o formulário não pode vir
          depois do que ele remonta.
        */}
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <Segmented options={KINDS} value={field.value} onChange={field.onChange} />
          )}
        />

        {/* Único campo obrigatório, e o que abre o teclado — `autoFocus` continua aqui. */}
        <Controller
          control={control}
          name="amount_cents"
          render={({ field }) => (
            <Field label="Valor" error={errors.amount_cents?.message}>
              <MoneyField
                valueCents={field.value}
                onChangeCents={field.onChange}
                autoFocus={!editing}
                invalid={!!errors.amount_cents}
              />
            </Field>
          )}
        />

        {/*
          Descrição e Estabelecimento moravam no FIM do formulário, depois da data e do
          "vou pagar depois". A ordem agora é a mesma de Recorrentes, que já estava certa:
          o que É (tipo, valor, nome) antes do que ele CLASSIFICA (categoria, conta) antes
          do QUANDO. Era a queixa de 09/09/2026 — "a ordem dos campos está toda bagunçada".
        */}
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <Field label="Descrição">
              <TextField
                value={field.value ?? ''}
                onChangeText={(text) => field.onChange(text || null)}
                placeholder="Ex.: compras da semana"
                accessibilityLabel="Descrição"
                multiline
                style={styles.multiline}
              />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="merchant"
          render={({ field }) => (
            <Field label="Estabelecimento">
              <TextField
                value={field.value ?? ''}
                onChangeText={(text) => field.onChange(text || null)}
                placeholder="Ex.: Padaria do Zé"
                accessibilityLabel="Estabelecimento"
              />
            </Field>
          )}
        />


        {kind !== 'transfer' && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Field label="Categoria">
                  <CategoryPicker value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
          </Animated.View>
        )}

        <Controller
          control={control}
          name="account_id"
          render={({ field }) => (
            <Field
              label={kind === 'transfer' ? 'Da conta' : 'Conta'}
              hint={
                (accounts ?? []).length === 0
                  ? 'Lançamento sem conta também vale — ele entra no caixa.'
                  : undefined
              }>
              <View style={styles.chipRow}>
                {(accounts ?? []).map((acc) => (
                  <Chip
                    key={acc.id}
                    label={accountLabel(acc)}
                    selected={field.value === acc.id}
                    onPress={() => {
                      const next = field.value === acc.id ? null : acc.id;
                      field.onChange(next);
                      // Trocar para cartão desliga "vou pagar depois" em vez de só escondê-lo.
                      if (acc.type === 'credit_card' && next) {
                        setValue('pending', false);
                        setValue('due_at', null);
                      }
                    }}
                  />
                ))}
                {(accounts ?? []).length === 0 && (
                  <Button
                    label="Cadastrar uma conta"
                    variant="secondary"
                    size="sm"
                    onPress={() => router.push('/finance/accounts')}
                  />
                )}
              </View>
            </Field>
          )}
        />

        {kind === 'transfer' && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="counterparty_account_id"
              render={({ field }) => (
                <Field label="Para a conta" error={errors.counterparty_account_id?.message}>
                  <View style={styles.chipRow}>
                    {(accounts ?? []).map((acc) => (
                      <Chip
                        key={acc.id}
                        label={accountLabel(acc)}
                        selected={field.value === acc.id}
                        onPress={() => field.onChange(acc.id)}
                      />
                    ))}
                  </View>
                </Field>
              )}
            />
          </Animated.View>
        )}

        {podeParcelar && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="installments"
              render={({ field }) => (
                <Field
                  label="Parcelas"
                  error={errors.installments?.message}
                  hint={
                    field.value > 1 && amountCents > 0
                      ? `${field.value}x de ${formatBRL(Math.floor(amountCents / field.value))} — o valor acima é o TOTAL da compra. As parcelas futuras já entram nas próximas faturas.`
                      : undefined
                  }>
                  <View style={styles.chipRow}>
                    {INSTALLMENT_OPTIONS.map((n) => (
                      <Chip
                        key={n}
                        label={n === 1 ? 'À vista' : `${n}x`}
                        selected={field.value === n}
                        onPress={() => field.onChange(n)}
                      />
                    ))}
                  </View>
                </Field>
              )}
            />
          </Animated.View>
        )}

        {podeParcelar && installmentCount > 1 && (
          <Controller control={control} name="paid_installments" render={({ field }) => (
            <Field label="Quantas parcelas iniciais já foram pagas?" error={errors.paid_installments?.message}
              hint="Informe zero se nenhuma foi paga. Datas passadas não significam pagamento; as demais parcelas ficam pendentes.">
              <View style={styles.chipRow}>
                <Chip label="Nenhuma" selected={field.value === '0'} onPress={() => field.onChange('0')} />
                <TextField value={field.value} onChangeText={field.onChange} keyboardType="number-pad" maxLength={2}
                  placeholder="0" accessibilityLabel="Parcelas iniciais já pagas" />
              </View>
              {paidHistory !== '' && /^\d+$/.test(paidHistory) && Number(paidHistory) <= installmentCount && (
                <ThemedText type="small" themeColor="textSecondary">
                  {Number(paidHistory) === 0 ? `As ${installmentCount} parcelas ficam pendentes.` : `${paidHistory} parcelas iniciais pagas; ${installmentCount - Number(paidHistory)} pendentes.`}
                </ThemedText>
              )}
            </Field>
          )} />
        )}

        {/*
          **Pix no crédito** (Nubank e afins): o boleto pede um valor, o cartão cobra outro.
          Na fatura são duas coisas diferentes — a compra e o custo de ter usado o crédito —
          e é assim que ficam aqui: duas linhas, mesma fatura, os juros em `juros`.

          Vazio = compra normal. Não é um modo: é um campo a mais que só aparece onde a
          pergunta faz sentido (gasto em cartão, à vista, sendo criado agora).
        */}
        {isCard && kind === 'expense' && !editing && installmentCount === 1 && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="fee_cents"
              render={({ field }) => (
                <Field
                  label="Juros do Pix no crédito"
                  hint={
                    field.value > 0
                      ? `Duas linhas na fatura: ${formatBRL(amountCents)} da compra e ${formatBRL(field.value)} de juros — ${formatBRL(amountCents + field.value)} no total.`
                      : 'Só se você pagou por Pix usando o limite do cartão. Acima fica o valor original; aqui, o que o banco cobrou a mais.'
                  }>
                  <MoneyField valueCents={field.value} onChangeCents={field.onChange} />
                </Field>
              )}
            />
          </Animated.View>
        )}


        <Controller
          control={control}
          name="occurred_at"
          render={({ field }) => (
            <Field label={podeParcelar && installmentCount > 1 ? "Data da primeira parcela" : "Data"} error={errors.occurred_at?.message}>
              <View style={styles.chipRow}>
                <Chip
                  label="Hoje"
                  selected={occurredAt === today}
                  onPress={() => setValue('occurred_at', today, { shouldValidate: true })}
                />
                <Chip
                  label="Ontem"
                  selected={occurredAt === yesterday}
                  onPress={() => setValue('occurred_at', yesterday, { shouldValidate: true })}
                />
                <TextField
                  value={field.value}
                  onChangeText={field.onChange}
                  placeholder="dd/mm/aaaa"
                  keyboardType="number-pad"
                  maxLength={10}
                  accessibilityLabel="Data do lançamento"
                  invalid={!!errors.occurred_at}
                  style={styles.dateField}
                />
              </View>
            </Field>
          )}
        />

        {/* Conta a pagar: o gasto entra na projeção pelo vencimento, não pela data de hoje. */}
        {podeAdiar && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Card>
              <View style={styles.pendingCard}>
                <Controller
                  control={control}
                  name="pending"
                  render={({ field }) => (
                    <Segmented
                      options={[
                        { value: 'no', label: 'Já aconteceu' },
                        { value: 'yes', label: 'Ainda vai acontecer' },
                      ]}
                      value={field.value ? 'yes' : 'no'}
                      onChange={(v) => field.onChange(v === 'yes')}
                    />
                  )}
                />
                {pending ? (
                  <Animated.View entering={FadeIn.duration(Motion.duration.base)}>
                    <Controller
                      control={control}
                      name="due_at"
                      render={({ field }) => (
                        <Field
                          label={dueFieldLabel(kind)}
                          error={errors.due_at?.message}
                          hint={errors.due_at ? undefined : dueFieldHint(kind)}>
                          <TextField
                            value={field.value ?? ''}
                            onChangeText={(text) => field.onChange(text || null)}
                            placeholder="dd/mm/aaaa"
                            keyboardType="number-pad"
                            maxLength={10}
                            accessibilityLabel="Data de vencimento"
                            invalid={!!errors.due_at}
                            style={styles.dateField}
                          />
                        </Field>
                      )}
                    />

                    {/*
                      O interruptor de "entra sozinho na data". Só existe em PREVISTO porque é
                      só ali que ele muda algo — `_promote_due_transactions` só olha `pending`.

                      O padrão inverte entre os dois lados (ver `autoConfirmHint`): despesa
                      recorrente é boleto que sai; receita de terceiro é Pix que pode não
                      chegar. Foi o pedido literal do dono do produto em 09/09/2026.
                    */}
                    <Controller
                      control={control}
                      name="auto_confirm"
                      render={({ field }) => (
                        <Field
                          label={kind === 'income' ? 'Receber automático' : 'Confirmar automático'}
                          hint={autoConfirmHint(kind, field.value)}>
                          <View style={styles.switchRow}>
                            <ThemedText type="small" themeColor="textSecondary">
                              {autoConfirmLabel(kind)}
                            </ThemedText>
                            <Switch
                              value={field.value}
                              onValueChange={field.onChange}
                              accessibilityLabel={autoConfirmLabel(kind)}
                            />
                          </View>
                        </Field>
                      )}
                    />
                  </Animated.View>
                ) : null}
              </View>
            </Card>
          </Animated.View>
        )}

        {isCard ? (
          <ThemedText type="small" themeColor="textSecondary">
            Compra no cartão entra na fatura. O dinheiro sai da conta quando você registra o pagamento da fatura.
          </ThemedText>
        ) : null}


        {editing ? (
          <Button
            label="Apagar lançamento"
            variant="ghost"
            onPress={onDelete}
            loading={remove.isPending}
            block
          />
        ) : null}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

/** Uma instância só: `LinearTransition` recriado a cada render remonta a animação. */
const linear = LinearTransition.duration(Motion.duration.base);

const styles = StyleSheet.create({
  // Replica o padding do `Screen`, que está com `scroll={false}` para o teclado ser
  // responsabilidade do `KeyboardAwareScrollView`.
  body: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    alignItems: 'center',
  },
  dateField: {
    minWidth: 140,
    textAlign: 'center',
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  pendingCard: {
    gap: Space.lg,
  },
  loading: {
    gap: Space.lg,
  },
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
});
