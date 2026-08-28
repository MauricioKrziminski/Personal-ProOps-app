import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Stack } from 'expo-router';

import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  DEBT_KINDS,
  useAccounts,
  useArchiveDebt,
  useDebtSchedule,
  useDebts,
  usePayDebtInstallment,
  usePayoffStrategy,
  useSaveDebt,
  type Debt,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';
import { formatBRL, isoToBR } from '@/lib/dates';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

/**
 * Dívidas — "quanto disso é juro, e por onde eu começo?".
 *
 * A amortização Price e a ordem de ataque vêm prontas do banco (`debt_schedule`,
 * `payoff_strategy`); o valor da tela está em não errar a entrada e em mostrar a conta na hora de
 * pagar.
 *
 * Dois consertos que motivaram a redesenhada:
 * - **Editar existia no hook e não na tela** (`save.mutate` ia sem `id`): dívida cadastrada com a
 *   taxa errada só podia ser arquivada e recriada.
 * - **`principal_cents` e `remaining_cents` iam sempre iguais**, então a barra de progresso nascia
 *   em 0% mesmo para quem já tinha pago metade. Agora são dois campos.
 */

/** 0.0199 → "1,99% a.m." */
function taxaLabel(fracao: number): string {
  return `${(fracao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m.`;
}

/** "1,99" → 0.0199. Aceita vírgula, que é como o brasileiro digita. */
function parseTaxa(texto: string): number {
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n / 100 : 0;
}

interface FormState {
  id?: string;
  name: string;
  kind: Debt['kind'];
  remainingCents: number;
  /** 0 = "nunca paguei nada": vira igual ao saldo devedor na hora de salvar. */
  principalCents: number;
  taxa: string;
  parcelas: string;
  diaVencimento: string;
}

const FORM_VAZIO: FormState = {
  name: '',
  kind: 'loan',
  remainingCents: 0,
  principalCents: 0,
  taxa: '',
  parcelas: '',
  diaVencimento: '',
};

/** Faixa de erro por seção. Seção que falha DIZ que falhou — nunca some. */
function ErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={styles.band}>
      <Icon name="exclamationmark.triangle.fill" size="lg" color="danger" />
      <ThemedText type="small" style={styles.bandText}>
        {message}
      </ThemedText>
      <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onRetry} />
    </Card>
  );
}

export default function DebtsScreen() {
  const theme = useTheme();
  const toast = useToast();
  const debts = useDebts();
  const [estrategia, setEstrategia] = useState<'avalanche' | 'snowball'>('avalanche');
  const payoff = usePayoffStrategy(estrategia);
  const accounts = useAccounts();
  const save = useSaveDebt();
  const archive = useArchiveDebt();
  const pagar = usePayDebtInstallment();

  const [form, setForm] = useState<FormState | null>(null);
  const [detalhe, setDetalhe] = useState<Debt | null>(null);
  const [pagando, setPagando] = useState<Debt | null>(null);
  const [pagoCents, setPagoCents] = useState(0);
  const [contaId, setContaId] = useState<string | null>(null);

  // Lazy: só a dívida aberta (detalhe ou pagamento) puxa a tabela Price.
  const schedule = useDebtSchedule(detalhe?.id ?? pagando?.id);

  const lista = debts.data ?? [];
  const totalDevido = lista.reduce((s, d) => s + Number(d.remaining_cents), 0);
  const jurosAteQuitar = (payoff.data ?? []).reduce(
    (s, p) => s + Number(p.total_interest_cents),
    0
  );
  const proxima = schedule.data?.[0];
  const pagadoras = (accounts.data ?? []).filter((a) => a.type !== 'credit_card');

  const abrirNova = () => setForm({ ...FORM_VAZIO });
  const abrirEdicao = (d: Debt) =>
    setForm({
      id: d.id,
      name: d.name,
      kind: d.kind,
      remainingCents: Number(d.remaining_cents),
      principalCents: Number(d.principal_cents),
      taxa: d.interest_rate_monthly ? String(d.interest_rate_monthly * 100).replace('.', ',') : '',
      parcelas: d.installments ? String(d.installments) : '',
      diaVencimento: d.due_day ? String(d.due_day) : '',
    });

  const abrirPagamento = (d: Debt) => {
    setDetalhe(null);
    setPagoCents(Number(schedule.data?.[0]?.payment_cents ?? d.installment_cents ?? 0));
    setContaId(null);
    setPagando(d);
  };

  const fracao = form ? parseTaxa(form.taxa) : 0;
  const nomeOk = (form?.name.trim().length ?? 0) >= 2;
  const podeSalvar = Boolean(form && nomeOk && form.remainingCents > 0);

  const salvar = () => {
    if (!form || !podeSalvar) return;
    save.mutate(
      {
        id: form.id,
        name: form.name.trim(),
        kind: form.kind,
        // sem os dois campos separados a barra de progresso nasce sempre em 0%
        principal_cents: form.principalCents > 0 ? form.principalCents : form.remainingCents,
        remaining_cents: form.remainingCents,
        interest_rate_monthly: fracao,
        installments: form.parcelas ? Number(form.parcelas) : null,
        due_day: form.diaVencimento ? Number(form.diaVencimento) : null,
      },
      {
        onSuccess: () => {
          toast({ message: form.id ? 'Dívida atualizada.' : 'Dívida cadastrada.', tone: 'success' });
          setForm(null);
        },
        onError: () =>
          toast({
            message: 'Não deu para salvar. Já existe uma dívida com esse nome?',
            tone: 'error',
          }),
      }
    );
  };

  const confirmarPagamento = () => {
    if (!pagando || pagoCents <= 0) return;
    pagar.mutate(
      { debtId: pagando.id, amountCents: pagoCents, accountId: contaId },
      {
        onSuccess: () => {
          toast({ message: `Parcela de ${pagando.name} registrada.`, tone: 'success' });
          setPagando(null);
        },
        // o sheet FICA aberto: fechar num erro faz o usuário registrar o pagamento de novo
        onError: () => toast({ message: 'Não deu para registrar o pagamento.', tone: 'error' }),
      }
    );
  };

  const arquivar = (d: Debt) =>
    confirmDestructive(
      `Arquivar "${d.name}"?`,
      'Arquivar',
      () =>
        archive.mutate(d.id, {
          onSuccess: () => toast({ message: `${d.name} arquivada.`, tone: 'success' }),
          onError: () => toast({ message: `Não deu para arquivar ${d.name}.`, tone: 'error' }),
        }),
      'A dívida sai da lista. Os pagamentos já lançados continuam nos seus lançamentos.'
    );

  const acoes = (d: Debt) =>
    showItemActions(d.name, [
      { label: 'Ver amortização', onPress: () => setDetalhe(d) },
      { label: 'Editar', onPress: () => abrirEdicao(d) },
      { label: 'Arquivar', destructive: true, onPress: () => arquivar(d) },
    ]);

  const cartaoDivida = (d: Debt, index: number) => {
    const restante = Number(d.remaining_cents);
    const original = Number(d.principal_cents) || restante;
    const pago = Math.max(0, original - restante);
    const tipo = DEBT_KINDS.find((k) => k.value === d.kind)?.label ?? '';
    const juros = d.interest_rate_monthly > 0 ? taxaLabel(d.interest_rate_monthly) : 'sem juros';
    const parcelas = d.installments ? `${d.installments_paid}/${d.installments} pagas` : null;

    return (
      <Animated.View
        key={d.id}
        layout={LinearTransition.duration(Motion.duration.base)}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${d.name}, ${tipo}, deve ${formatBRL(restante)}, ${juros === 'sem juros' ? 'sem juros' : `juros de ${juros}`}${parcelas ? `, ${parcelas}` : ''}`}
          onPress={() => setDetalhe(d)}
          onLongPress={() => acoes(d)}>
          <Card style={styles.divida}>
            <View style={styles.dividaTopo}>
              <ThemedText type="default" numberOfLines={1} style={styles.dividaNome}>
                {d.name}
              </ThemedText>
              <Money cents={restante} variant="headline" tone="danger" />
            </View>
            <ProgressBar value={pago} max={original} tone="success" />
            <ThemedText type="small" themeColor="textSecondary">
              {tipo} · juros {juros}
              {parcelas ? ` · ${parcelas}` : ''}
            </ThemedText>
          </Card>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <Screen
      grouped
      onRefresh={() => {
        debts.refetch();
        payoff.refetch();
      }}
      refreshing={debts.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Dívidas',
          headerLargeTitle: true,
          headerRight: () => (
            <Pressable accessibilityLabel="Nova dívida" hitSlop={12} onPress={abrirNova}>
              <Icon name="plus.circle.fill" size="lg" color="tint" />
            </Pressable>
          ),
        }}
      />

      {debts.isLoading ? (
        <>
          <Skeleton height={120} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela: o juro total é o número que faz o usuário agir. */}
      {debts.isError ? (
        <ErrorBand message="Não deu para carregar suas dívidas." onRetry={debts.refetch} />
      ) : lista.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <ThemedText type="small" themeColor="textSecondary">
              Total devido
            </ThemedText>
            <Money cents={totalDevido} variant="money" tone="danger" />
            {jurosAteQuitar > 0 ? (
              <View style={styles.valores}>
                <Money cents={jurosAteQuitar} variant="subhead" tone="textSecondary" />
                <ThemedText type="small" themeColor="textSecondary">
                  de juros até quitar tudo
                </ThemedText>
              </View>
            ) : null}
          </GlassCard>
        </Animated.View>
      ) : null}

      {payoff.isError && lista.length > 1 ? (
        <ErrorBand
          message="Não deu para montar a ordem de ataque. Suas dívidas continuam na lista."
          onRetry={payoff.refetch}
        />
      ) : null}

      {/* Com uma dívida só o seletor seria um controle que não muda nada. */}
      {lista.length > 1 && !payoff.isError ? (
        <Card style={styles.ordem}>
          <ThemedText type="smallBold">Por onde começar</ThemedText>
          <Segmented
            options={[
              { value: 'avalanche', label: 'Mais juros' },
              { value: 'snowball', label: 'Menor saldo' },
            ]}
            value={estrategia}
            onChange={setEstrategia}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {estrategia === 'avalanche'
              ? 'Atacar a de juro maior primeiro paga menos no total.'
              : 'Atacar a de saldo menor primeiro quita a primeira mais rápido.'}
          </ThemedText>
          {(payoff.data ?? []).map((p, i) => (
            <Animated.View
              key={p.debt_id}
              layout={LinearTransition.duration(Motion.duration.base)}
              style={styles.ordemLinha}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={tabular}>
                {i + 1}
              </ThemedText>
              <View style={styles.ordemTexto}>
                <ThemedText type="small" numberOfLines={1}>
                  {p.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  juros {taxaLabel(Number(p.interest_rate_monthly))} · {p.months_left} meses
                </ThemedText>
              </View>
              <Money cents={Number(p.remaining_cents)} variant="subhead" tone="danger" />
            </Animated.View>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            Cada dívida contada sozinha, sem supor que você joga a parcela quitada na próxima.
          </ThemedText>
        </Card>
      ) : null}

      {lista.map(cartaoDivida)}

      {!debts.isLoading && !debts.isError && lista.length === 0 ? (
        <EmptyState
          icon="creditcard.trianglebadge.exclamationmark"
          title="Nenhuma dívida cadastrada"
          hint="Cadastre um empréstimo ou financiamento e eu mostro quanto é juro e por onde começar."
          action={{ label: 'Cadastrar dívida', onPress: abrirNova }}
        />
      ) : null}

      {/* Amortização — sheet, não acordeão: um financiamento em 60x tem 60 linhas. */}
      <Modal
        visible={detalhe !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetalhe(null)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Fechar" variant="ghost" size="sm" onPress={() => setDetalhe(null)} />
            <ThemedText type="smallBold" numberOfLines={1}>
              {detalhe?.name}
            </ThemedText>
            <View style={styles.sheetHeadSpacer} />
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody}>
            {schedule.isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : null}

            {schedule.isError ? (
              <ErrorBand
                message="Não deu para montar a tabela de amortização."
                onRetry={schedule.refetch}
              />
            ) : null}

            {proxima && detalhe ? (
              <Card style={styles.proxima}>
                <ThemedText type="small" themeColor="textSecondary">
                  Próxima parcela
                </ThemedText>
                <View style={styles.valores}>
                  <Money cents={Number(proxima.payment_cents)} variant="title2" />
                  <ThemedText type="small" themeColor="textSecondary">
                    em {isoToBR(proxima.due_date)}
                  </ThemedText>
                </View>
                <View style={styles.valores}>
                  <Money cents={Number(proxima.interest_cents)} variant="subhead" tone="danger" />
                  <ThemedText type="small" themeColor="danger">
                    disso são juros
                  </ThemedText>
                </View>
                <Button
                  label="Paguei esta parcela"
                  block
                  onPress={() => abrirPagamento(detalhe)}
                />
              </Card>
            ) : null}

            {!schedule.isLoading && !schedule.isError && !proxima ? (
              <EmptyState
                icon="tablecells"
                title={
                  detalhe && Number(detalhe.remaining_cents) <= 0
                    ? 'Nada em aberto. Dívida quitada.'
                    : 'Sem tabela de amortização'
                }
                hint={
                  detalhe && Number(detalhe.remaining_cents) > 0
                    ? 'Informe quantas parcelas faltam para eu montar a tabela.'
                    : undefined
                }
                action={
                  detalhe && Number(detalhe.remaining_cents) > 0
                    ? {
                        label: 'Editar dívida',
                        onPress: () => {
                          const d = detalhe;
                          setDetalhe(null);
                          abrirEdicao(d);
                        },
                      }
                    : undefined
                }
              />
            ) : null}

            {(schedule.data ?? []).length > 0 ? (
              <View style={styles.tabelaBloco}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.secaoTitulo}>
                  AMORTIZAÇÃO
                </ThemedText>
                {/* rola dentro do próprio container, nunca empurrando o corpo do sheet */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={styles.tabelaLinha}>
                      {['nº', 'vencimento', 'parcela', 'juros', 'amortiza', 'saldo'].map((h) => (
                        <ThemedText
                          key={h}
                          type="small"
                          themeColor="textSecondary"
                          style={[styles.celula, h === 'nº' ? styles.celulaEstreita : null]}>
                          {h}
                        </ThemedText>
                      ))}
                    </View>
                    {(schedule.data ?? []).map((p) => (
                      <View
                        key={p.installment_no}
                        style={[styles.tabelaLinha, { borderTopColor: theme.separator }]}>
                        <ThemedText
                          type="small"
                          style={[styles.celula, styles.celulaEstreita, tabular]}>
                          {p.installment_no}
                        </ThemedText>
                        <ThemedText type="small" style={[styles.celula, tabular]}>
                          {isoToBR(p.due_date)}
                        </ThemedText>
                        <View style={styles.celula}>
                          <Money cents={Number(p.payment_cents)} variant="footnote" />
                        </View>
                        <View style={styles.celula}>
                          <Money cents={Number(p.interest_cents)} variant="footnote" tone="danger" />
                        </View>
                        <View style={styles.celula}>
                          <Money cents={Number(p.principal_cents)} variant="footnote" />
                        </View>
                        <View style={styles.celula}>
                          <Money
                            cents={Number(p.balance_cents)}
                            variant="footnote"
                            tone="textSecondary"
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      {/* Pagar parcela — sheet com a conta explicada ANTES de confirmar. */}
      <Modal
        visible={pagando !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPagando(null)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setPagando(null)} />
            <ThemedText type="smallBold" numberOfLines={1}>
              Pagar {pagando?.name}
            </ThemedText>
            <View style={styles.sheetHeadSpacer} />
          </View>

          {pagando ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Quanto você pagou" hint="Pagar a mais abate mais do saldo.">
                <MoneyField valueCents={pagoCents} onChangeCents={setPagoCents} />
              </Field>

              {/* A conta é a metade do valor da tela: parcela NÃO abate o saldo pelo valor cheio. */}
              {proxima ? (
                <Card style={styles.explica}>
                  <View style={styles.valores}>
                    <Money cents={Number(proxima.interest_cents)} variant="subhead" tone="danger" />
                    <ThemedText type="small" themeColor="textSecondary">
                      vão para o juro do mês,
                    </ThemedText>
                    <Money
                      cents={Math.max(0, pagoCents - Number(proxima.interest_cents))}
                      variant="subhead"
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      abatem o saldo.
                    </ThemedText>
                  </View>
                  <View style={styles.valores}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Fica em
                    </ThemedText>
                    <Money
                      cents={Math.max(
                        0,
                        Number(pagando.remaining_cents) -
                          Math.max(0, pagoCents - Number(proxima.interest_cents))
                      )}
                      variant="subhead"
                      tone="danger"
                    />
                  </View>
                </Card>
              ) : null}

              <Field label="Conta que paga" hint="Opcional — o lançamento fica sem conta se você não escolher.">
                <Section>
                  <Row
                    title="Não informar"
                    chevron={false}
                    onPress={() => setContaId(null)}
                    trailing={
                      contaId === null ? <Icon name="checkmark" size="sm" color="tint" /> : undefined
                    }
                  />
                  {pagadoras.map((a) => (
                    <Row
                      key={a.id}
                      title={a.name}
                      chevron={false}
                      onPress={() => setContaId(a.id)}
                      trailing={
                        contaId === a.id ? <Icon name="checkmark" size="sm" color="tint" /> : undefined
                      }
                    />
                  ))}
                </Section>
              </Field>

              <Button
                label="Registrar pagamento"
                block
                loading={pagar.isPending}
                disabled={pagoCents <= 0}
                onPress={confirmarPagamento}
              />
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      {/* Criar / editar */}
      <Modal
        visible={form !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setForm(null)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setForm(null)} />
            <ThemedText type="smallBold">{form?.id ? 'Editar dívida' : 'Nova dívida'}</ThemedText>
            <Button
              label="Salvar"
              size="sm"
              loading={save.isPending}
              disabled={!podeSalvar}
              onPress={salvar}
            />
          </View>

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Nome">
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm({ ...form, name })}
                  placeholder="Empréstimo do banco"
                  autoFocus
                />
              </Field>

              <Field label="Tipo">
                <View style={styles.chips}>
                  {DEBT_KINDS.map((k) => (
                    <Chip
                      key={k.value}
                      label={k.label}
                      selected={form.kind === k.value}
                      onPress={() => setForm({ ...form, kind: k.value })}
                    />
                  ))}
                </View>
              </Field>

              <Field label="Quanto você deve hoje">
                <MoneyField
                  valueCents={form.remainingCents}
                  onChangeCents={(remainingCents) => setForm({ ...form, remainingCents })}
                />
              </Field>

              <Field
                label="Valor original"
                hint="Deixe zerado se você ainda não pagou nada. É daqui que sai a barra de progresso.">
                <MoneyField
                  valueCents={form.principalCents}
                  onChangeCents={(principalCents) => setForm({ ...form, principalCents })}
                />
              </Field>

              <Field
                label="Juros por mês"
                hint="Deixe em branco se não tem juros (parcelamento de loja, dinheiro com alguém).">
                <View>
                  <TextField
                    value={form.taxa}
                    onChangeText={(taxa) => setForm({ ...form, taxa })}
                    placeholder="1,99"
                    keyboardType="decimal-pad"
                    accessibilityLabel="Juros por mês, em porcentagem"
                    accessibilityHint={
                      fracao > 0
                        ? `${taxaLabel(fracao)} dá ${formatBRL(Math.round(form.remainingCents * fracao))} de juros no primeiro mês`
                        : undefined
                    }
                    style={styles.taxaInput}
                  />
                  <View style={styles.taxaSufixo} pointerEvents="none">
                    <ThemedText type="default" themeColor="textSecondary">
                      %
                    </ThemedText>
                  </View>
                </View>
              </Field>

              {/* Prévia ao vivo: errar por um fator de 100 aqui não dá erro nenhum, só um total
                  de juros absurdo que ninguém confere. */}
              {fracao > 0 && form.remainingCents > 0 ? (
                <View style={styles.valores}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {taxaLabel(fracao)} dá
                  </ThemedText>
                  <Money
                    cents={Math.round(form.remainingCents * fracao)}
                    variant="subhead"
                    tone="danger"
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    de juros no primeiro mês sobre
                  </ThemedText>
                  <Money cents={form.remainingCents} variant="subhead" tone="textSecondary" />
                </View>
              ) : null}

              {fracao > 0.2 ? (
                <View style={styles.aviso}>
                  <Icon name="exclamationmark.triangle" size="sm" color="warning" />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.avisoTexto}>
                    20% ao mês é rotativo de cartão. Se você quis dizer ao ano, divida por 12.
                  </ThemedText>
                </View>
              ) : null}

              <View style={styles.duasColunas}>
                <View style={styles.coluna}>
                  <Field label="Parcelas que faltam">
                    <TextField
                      value={form.parcelas}
                      onChangeText={(v) =>
                        setForm({ ...form, parcelas: v.replace(/\D/g, '').slice(0, 3) })
                      }
                      placeholder="12"
                      keyboardType="number-pad"
                    />
                  </Field>
                </View>
                <View style={styles.coluna}>
                  <Field label="Vence dia">
                    <TextField
                      value={form.diaVencimento}
                      onChangeText={(v) =>
                        setForm({ ...form, diaVencimento: v.replace(/\D/g, '').slice(0, 2) })
                      }
                      placeholder="10"
                      keyboardType="number-pad"
                    />
                  </Field>
                </View>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  valores: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.xs,
  },
  ordem: {
    gap: Space.md,
  },
  ordemLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  ordemTexto: {
    flex: 1,
    gap: 2,
  },
  divida: {
    gap: Space.sm,
  },
  dividaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  dividaNome: {
    flexShrink: 1,
  },
  proxima: {
    gap: Space.md,
  },
  explica: {
    gap: Space.sm,
  },
  band: {
    alignItems: 'center',
    gap: Space.sm,
  },
  bandText: {
    textAlign: 'center',
  },
  secaoTitulo: {
    letterSpacing: 0.5,
  },
  tabelaBloco: {
    gap: Space.sm,
  },
  tabelaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  celula: {
    width: 92,
  },
  celulaEstreita: {
    width: 32,
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
  sheetHeadSpacer: {
    width: Space.xxl,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  taxaInput: {
    paddingRight: Space.xxxl,
  },
  taxaSufixo: {
    position: 'absolute',
    right: Space.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  avisoTexto: {
    flex: 1,
  },
  duasColunas: {
    flexDirection: 'row',
    gap: Space.md,
  },
  coluna: {
    flex: 1,
  },
});
