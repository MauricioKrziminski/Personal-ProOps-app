import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet } from '@/components/ui/sheet';
import { ItemLink } from '@/components/ui/item-link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { formatNumberBR } from '@/lib/dates';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { formatBRL } from '@/hooks/use-items';
import {
  ACCOUNT_TYPES,
  NO_ACCOUNT,
  useAccountBalances,
  useAccounts,
  useArchiveAccount,
  useDefaultAccount,
  useSaveAccount,
  useSetDefaultAccount,
  type Account,
  type AccountBalance,
} from '@/hooks/use-finance';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * Contas — "quanto eu tenho, e onde?".
 *
 * É uma tela de LEITURA: o sucesso é o usuário bater o número com o extrato do banco. Cadastrar
 * conta é frequência 1 e por isso saiu do corpo da tela para um sheet.
 *
 * Duas decisões que valem comentário:
 * - **O destaque é "dinheiro disponível", não "saldo total".** A versão anterior somava todas as
 *   linhas de `account_balances()`, cartão incluído (saldo negativo), e chamava o resultado de
 *   saldo. Aqui o cartão sai da soma e aparece como dívida, separado.
 * - **O form é um `Modal` `pageSheet` dentro da própria tela**, não a rota
 *   `/finance/account-form` que o doc pede: criar rota exigiria mexer no `_layout` da pilha, fora
 *   do escopo desta entrega. A apresentação e o par Cancelar/Salvar são os mesmos.
 */

/**
 * O glifo por tipo sai de `ACCOUNT_TYPES`, não de um mapa local.
 *
 * Eram DOIS mapas privados que discordavam — aqui `cash` era `dollarsign.circle`
 * e no `AccountPicker` era `wallet.bifold`. O mesmo tipo de conta com duas caras
 * no mesmo app é como a forma deixa de ser um sinal confiável, e a forma é
 * exatamente o que separa cartão de conta antes de qualquer texto.
 */
const ICONE: Record<string, SymbolViewProps['name']> = {
  ...Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.value, t.icon])),
  none: 'questionmark.circle',
};

const GUARDA_DINHEIRO = ['checking', 'savings', 'cash'];

interface FormState {
  id?: string;
  name: string;
  type: Account['type'];
  initialCents: number;
  closingDay: string;
  dueDay: string;
  limitCents: number;
  payerId: string | null;
  rotativoAuto: boolean;
  /** Texto, porque é digitado: "15,5". Vira fração na hora de salvar. */
  rotativoRate: string;
}

const FORM_VAZIO: FormState = {
  name: '',
  type: 'checking',
  initialCents: 0,
  closingDay: '',
  dueDay: '',
  limitCents: 0,
  payerId: null,
  rotativoAuto: false,
  rotativoRate: '',
};

const diaValido = (v: string) => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 31;
/** Percentual mensal digitado em pt-BR: "15,5". Vírgula, nunca ponto (regra do frontend). */
const taxaValida = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100;
};

/**
 * Confirmação de ação destrutiva.
 *
 * Action sheet nativo no iOS; no Android o RN não expõe action sheet, então o diálogo nativo é o
 * equivalente mais próximo. O que estava proibido era `onLongPress` + `Alert` como *gesto*: ação
 * escondida atrás de segurar o dedo.
 */
/** Delega para o helper único: no Android o `Alert` cortaria opção, o sheet compartilhado não. */
function confirmaDestrutiva(opts: {
  title: string;
  message?: string;
  confirm: string;
  onConfirm: () => void;
}) {
  confirmDestructive(opts.title, opts.confirm, opts.onConfirm, opts.message);
}

/** Faixa de erro por seção. Uma seção que falha DIZ que falhou — nunca some. */
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

export default function AccountsScreen() {
  const toast = useToast();
  const balances = useAccountBalances();
  const accounts = useAccounts();
  const contaPadrao = useDefaultAccount();
  const definirPadrao = useSetDefaultAccount();
  const save = useSaveAccount();
  const archive = useArchiveAccount();
  const [form, setForm] = useState<FormState | null>(null);

  // `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch
  // falha, e sem este corte a tela seguia afirmando números embaixo da faixa de erro.
  const linhas = balances.isError ? [] : (balances.data ?? []);
  const semConta = linhas.find((l) => l.account_id === null);
  const dinheiro = linhas.filter((l) => l.account_id && GUARDA_DINHEIRO.includes(l.type));
  const investimentos = linhas.filter((l) => l.account_id && l.type === 'investment');
  const cartoes = linhas.filter((l) => l.account_id && l.type === 'credit_card');

  /**
   * ⚠️ `cleared_cents`, não `balance_cents`. Até 09/09/2026 esta soma usava o total e portanto
   * incluía o que ainda não caiu — enquanto Patrimônio e Projeção usam `private.cash_total`, que
   * só conta `cleared`. Eram dois números para o mesmo dinheiro, e o daqui era o errado.
   *
   * O CARTÃO continua em `balance_cents` (logo abaixo) de propósito: lá a parcela futura
   * `pending` é dívida já assumida, e tirá-la esconderia o que ele vai pagar.
   */
  const caixa =
    dinheiro.reduce((s, l) => s + Number(l.cleared_cents), 0) +
    Number(semConta?.cleared_cents ?? 0);
  const aReceber =
    dinheiro.reduce((s, l) => s + Number(l.pending_in_cents), 0) +
    Number(semConta?.pending_in_cents ?? 0);
  const investido = investimentos.reduce((s, l) => s + Number(l.cleared_cents), 0);
  // saldo de cartão é negativo quando há fatura em aberto; aqui vira dívida positiva
  const dividaCartao = cartoes.reduce((s, l) => s + Math.min(0, Number(l.balance_cents)), 0);

  const contaDe = (id: string | null) => (accounts.data ?? []).find((a) => a.id === id);
  const pagadoras = (accounts.data ?? []).filter(
    (a) => a.type !== 'credit_card' && a.id !== form?.id
  );
  /** Candidatas a conta padrão: guardar dinheiro é requisito, e o banco também exige. */
  const guardamDinheiro = (accounts.data ?? []).filter((a) => a.type !== 'credit_card');

  // erro de contas NÃO é lista vazia: sem esta guarda a tela mandava cadastrar conta para quem
  // já tem cinco cadastradas e só perdeu a rede
  const semNadaCadastrado =
    !accounts.isLoading && !accounts.isError && (accounts.data ?? []).length === 0;
  const soTemSemConta = semNadaCadastrado && Number(semConta?.balance_cents ?? 0) !== 0;
  /** Nada cadastrado E nada lançado: aí nem o card de destaque tem o que dizer. */
  const semDadoNenhum = semNadaCadastrado && !soTemSemConta;

  // o erro fica DENTRO do sheet (toast aparece atrás de um Modal nativo); sem o reset, o erro
  // da tentativa anterior receberia o usuário na próxima abertura
  const abrirNova = () => {
    save.reset();
    setForm({ ...FORM_VAZIO });
  };
  const abrirEdicao = (a: Account) => {
    save.reset();
    setForm({
      id: a.id,
      name: a.name,
      type: a.type,
      initialCents: a.initial_balance_cents,
      closingDay: a.closing_day ? String(a.closing_day) : '',
      dueDay: a.due_day ? String(a.due_day) : '',
      limitCents: a.credit_limit_cents ?? 0,
      payerId: a.payment_account_id,
      rotativoAuto: a.rotativo_auto ?? false,
      rotativoRate:
        a.rotativo_rate_monthly == null ? '' : formatNumberBR(a.rotativo_rate_monthly * 100),
    });
  };

  const ehCartao = form?.type === 'credit_card';
  const nomeOk = (form?.name.trim().length ?? 0) >= 1;
  const cicloOk = !ehCartao || (diaValido(form!.closingDay) && diaValido(form!.dueDay));
  const taxaOk = !ehCartao || !form!.rotativoRate.trim() || taxaValida(form!.rotativoRate);

  const salvar = () => {
    if (!form || !nomeOk || !cicloOk || !taxaOk) return;
    save.mutate(
      {
        id: form.id,
        name: form.name.trim(),
        type: form.type,
        initial_balance_cents: form.initialCents,
        closing_day: ehCartao ? Number(form.closingDay) : null,
        due_day: ehCartao ? Number(form.dueDay) : null,
        credit_limit_cents: ehCartao ? form.limitCents : null,
        rotativo_auto: ehCartao ? form.rotativoAuto : false,
        // Percentual digitado vira FRAÇÃO, igual a `debts.interest_rate_monthly`: 15,5 -> 0.155.
        // Vazio é null de propósito — o app não estima juros que não conhece.
        rotativo_rate_monthly:
          ehCartao && form.rotativoRate.trim()
            ? Number(form.rotativoRate.replace(',', '.')) / 100
            : null,
        // sem isto o cartão nunca sabe qual conta paga a fatura dele (bug antigo: null fixo)
        payment_account_id: ehCartao ? form.payerId : null,
      },
      {
        onSuccess: () => {
          toast({ message: form.id ? 'Conta atualizada.' : 'Conta criada.', tone: 'success' });
          setForm(null);
        },
        onError: () =>
          toast({
            message: 'Não deu para salvar. Já existe uma conta com esse nome?',
            tone: 'error',
          }),
      }
    );
  };

  const arquivar = (a: Account) =>
    confirmaDestrutiva({
      title: `Arquivar "${a.name}"?`,
      message: 'Os lançamentos são mantidos.',
      confirm: 'Arquivar',
      onConfirm: () =>
        archive.mutate(a.id, {
          onSuccess: () => toast({ message: `${a.name} arquivada.`, tone: 'success' }),
          onError: () =>
            toast({ message: `Não deu para arquivar ${a.name}.`, tone: 'error' }),
        }),
    });

  const linhaConta = (saldo: AccountBalance) => {
    const conta = contaDe(saldo.account_id);
    const cartao = saldo.type === 'credit_card';
    /**
     * Cartão mostra o TOTAL (parcela futura é dívida assumida); conta de dinheiro mostra o
     * confirmado, e o que falta cair vai para o subtítulo em vez de sumir dentro do número.
     */
    const cents = Number(cartao ? saldo.balance_cents : saldo.cleared_cents);
    const previsto = Number(cartao ? saldo.pending_out_cents : saldo.pending_in_cents);
    const negativo = cents < 0;
    const tipo = ACCOUNT_TYPES.find((t) => t.value === saldo.type)?.label ?? '';
    const ciclo =
      conta?.closing_day && conta.due_day
        ? `fecha dia ${conta.closing_day} · vence dia ${conta.due_day}`
        : null;
    const previstoTexto =
      previsto > 0
        ? cartao
          ? `${formatBRL(previsto)} em parcelas futuras`
          : `${formatBRL(previsto)} a receber`
        : null;

    return (
      <ItemLink
        key={saldo.account_id}
        href={{ pathname: '/finance/transactions', params: { accountId: saldo.account_id } }}
        title={saldo.name}
        actions={[
          {
            label: 'Ver extrato',
            icon: 'list.bullet',
            onPress: () =>
              router.push({
                pathname: '/finance/transactions',
                params: { accountId: saldo.account_id },
              }),
          },
          {
            label: 'Editar',
            icon: 'pencil',
            disabled: !conta,
            onPress: () => conta && abrirEdicao(conta),
          },
          {
            label: 'Arquivar',
            icon: 'archivebox',
            destructive: true,
            disabled: !conta,
            onPress: () => conta && arquivar(conta),
          },
        ]}>
        {({ onLongPress }) => (
          <Row
            title={saldo.name}
            subtitle={[ciclo ?? tipo, previstoTexto].filter(Boolean).join(' · ')}
            icon={ICONE[saldo.type]}
            // o valor negativo não pode ser comunicado só pela cor — e o previsto precisa
            // estar aqui também, senão o leitor de tela esconde o que a tela mostra
            accessibilityLabel={`${saldo.name}, ${tipo}, ${negativo ? 'deve' : 'tem'} ${formatBRL(Math.abs(cents))}${previstoTexto ? `, ${previstoTexto}` : ''}`}
            onLongPress={onLongPress}
            trailing={
              <Money
                cents={cents}
                variant="ticker"
                tone={negativo ? 'danger' : 'text'}
                signed={negativo}
              />
            }
          />
        )}
      </ItemLink>
    );
  };

  return (
    <Screen
      grouped
      onRefresh={() => Promise.all([balances.refetch(), accounts.refetch()])}
      refreshing={balances.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Contas',
          headerLargeTitle: true,
        }}
      />

      <HeaderActions actions={[{ label: 'Nova conta', icon: 'plus', onPress: abrirNova }]} />

      {balances.isLoading ? (
        <>
          <Skeleton height={120} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único destaque da tela. */}
      {balances.isError ? (
        <ErrorBand message="Não deu para carregar seus saldos." onRetry={balances.refetch} />
      ) : balances.data && !semDadoNenhum ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Dinheiro disponível</HeroLabel>
            <Money cents={caixa} variant="money" tone={caixa < 0 ? 'danger' : 'text'} />
            {/*
              O que falta cair fica FORA do número grande e ao lado dele. Somar seria voltar ao
              defeito que esta tela tinha: dizer que você tem um dinheiro que ainda não chegou.
            */}
            {aReceber > 0 ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                mais {formatBRL(aReceber)} previstos, que entram quando você confirmar
              </ThemedText>
            ) : null}
            <View style={styles.heroSplit}>
              <View style={styles.heroPart}>
                <HeroLabel>investido</HeroLabel>
                <Money cents={investido} variant="subhead" tone="textSecondary" />
              </View>
              <View style={styles.heroPart}>
                <HeroLabel>dívida de cartão</HeroLabel>
                <Money
                  cents={dividaCartao}
                  variant="subhead"
                  tone={dividaCartao < 0 ? 'danger' : 'textSecondary'}
                  signed={dividaCartao < 0}
                />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Cartão fica de fora do disponível: fatura é dívida, não saldo. Parcela futura já
              lançada entra na conta.
            </ThemedText>
          </Card>
        </Animated.View>
      ) : null}

      {accounts.isError ? (
        <ErrorBand
          message="Não deu para carregar suas contas. Os saldos acima continuam valendo; editar e arquivar voltam quando a lista carregar."
          onRetry={accounts.refetch}
        />
      ) : null}

      {dinheiro.length > 0 ? <Section title="Dinheiro">{dinheiro.map(linhaConta)}</Section> : null}
      {investimentos.length > 0 ? (
        <Section title="Investimentos">{investimentos.map(linhaConta)}</Section>
      ) : null}
      {cartoes.length > 0 ? <Section title="Cartões">{cartoes.map(linhaConta)}</Section> : null}

      {/*
        A conta padrão existe por causa do WhatsApp: "gastei 45 no mercado" não diz de onde saiu
        o dinheiro, e o agente devolve conta nula de propósito — perder o registro é pior que
        registrá-lo sem conta. O preço aparece quando se pergunta PARA ONDE o dinheiro foi: sem
        padrão, tudo cai num balde chamado "Sem conta". Cartão de crédito não pode ser padrão
        (toda compra do WhatsApp viraria dívida de fatura em silêncio) e o banco recusa.
      */}
      {guardamDinheiro.length > 0 ? (
        <Section title="Conta padrão">
          <Row
            title="Não definir"
            subtitle="lançamento sem conta continua sem conta"
            onPress={() => definirPadrao.mutate(null)}
            chevron={false}
            accessibilityState={{ selected: contaPadrao.data == null }}
            trailing={
              contaPadrao.data == null ? <Icon name="checkmark" size="sm" color="tint" /> : undefined
            }
          />
          {guardamDinheiro.map((a) => (
            <Row
              key={a.id}
              title={a.name}
              onPress={() => definirPadrao.mutate(a.id)}
              chevron={false}
              accessibilityState={{ selected: contaPadrao.data === a.id }}
              trailing={
                contaPadrao.data === a.id ? <Icon name="checkmark" size="sm" color="tint" /> : undefined
              }
            />
          ))}
        </Section>
      ) : null}

      {/* Fora do agrupamento de propósito: quem só usa o WhatsApp tem quase tudo aqui. */}
      {semConta && Number(semConta.balance_cents) !== 0 ? (
        <Section>
          <Row
            title="Sem conta"
            subtitle="lançamentos que não citam conta"
            icon="questionmark.circle"
            onPress={() =>
              router.push({ pathname: '/finance/transactions', params: { accountId: NO_ACCOUNT } })
            }
            trailing={<Money cents={Number(semConta.balance_cents)} variant="ticker" />}
          />
        </Section>
      ) : null}

      {semNadaCadastrado && !balances.isLoading && !balances.isError ? (
        <EmptyState
          icon="wallet.bifold"
          title={soTemSemConta ? 'Seus lançamentos estão em “Sem conta”' : 'Nenhuma conta ainda'}
          hint={
            soTemSemConta
              ? 'Cadastre suas contas para saber quanto tem em cada uma. O que já foi lançado continua valendo.'
              : 'Cadastre onde o dinheiro fica — corrente, poupança, dinheiro, cartão. Depois é só mandar “gastei 45 no mercado no Nubank” no WhatsApp.'
          }
          action={{ label: 'Cadastrar conta', onPress: abrirNova }}
        />
      ) : null}

      <Sheet visible={form !== null} onClose={() => setForm(null)}>

          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setForm(null)} />
            <ThemedText type="smallBold">{form?.id ? 'Editar conta' : 'Nova conta'}</ThemedText>
            <Button
              label="Salvar"
              size="sm"
              loading={save.isPending}
              disabled={!nomeOk || !cicloOk || !taxaOk}
              onPress={salvar}
            />
          </View>

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Nome">
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm({ ...form, name })}
                  placeholder="Nubank"
                  autoFocus
                  invalid={form.name.length > 0 && !nomeOk}
                />
              </Field>

              {/*
                `SelectField`, não `Segmented`: cinco rótulos não cabem numa linha.
                Medido a 384dp × fonte 1,3 — cada célula fica com ~62pt de texto e
                "Investimento" precisa de ~117, então a palavra partia no meio
                ("Investimen/to"), o que design.md §3 proíbe. `minWidth` não
                resolveria: não existe largura que caiba cinco células num sheet.

                De quebra o campo ganha o GLIFO por tipo, que é o que separa cartão
                de conta antes de qualquer texto — o mesmo motivo do `AccountPicker`.
              */}
              <Field label="Tipo">
                <SelectField
                  options={ACCOUNT_TYPES.map((t) => ({
                    id: t.value,
                    label: t.label,
                    icon: t.icon,
                    meta: 'meta' in t ? t.meta : undefined,
                  }))}
                  value={form.type}
                  /* Nenhuma opção tem `id: null`, então o campo nunca devolve nulo. */
                  onChange={(id) => setForm({ ...form, type: id as Account['type'] })}
                  placeholder="Escolher tipo"
                />
              </Field>

              {form.type === 'credit_card' ? (
                <>
                  <View style={styles.diaRow}>
                    <View style={styles.diaCampo}>
                      <Field
                        label="Fecha dia"
                        error={form.closingDay && !diaValido(form.closingDay) ? 'De 1 a 31' : undefined}>
                        <TextField
                          value={form.closingDay}
                          onChangeText={(v) =>
                            setForm({ ...form, closingDay: v.replace(/\D/g, '').slice(0, 2) })
                          }
                          placeholder="28"
                          keyboardType="number-pad"
                        />
                      </Field>
                    </View>
                    <View style={styles.diaCampo}>
                      <Field
                        label="Vence dia"
                        error={form.dueDay && !diaValido(form.dueDay) ? 'De 1 a 31' : undefined}>
                        <TextField
                          value={form.dueDay}
                          onChangeText={(v) =>
                            setForm({ ...form, dueDay: v.replace(/\D/g, '').slice(0, 2) })
                          }
                          placeholder="5"
                          keyboardType="number-pad"
                        />
                      </Field>
                    </View>
                  </View>

                  <ThemedText type="small" themeColor="textSecondary">
                    Compra depois do fechamento cai na fatura do mês seguinte.
                  </ThemedText>

                  {/*
                    O rotativo, e por que ele nasce DESLIGADO.
                    Ligado para todo cartão, um que a pessoa paga em dia nunca mais apareceria
                    como atrasado — o aviso que mais importa sumiria justamente de quem não
                    precisa da feature. Por isso é escolha, e é aqui: junto do ciclo, que é o
                    outro campo que só existe em cartão.
                  */}
                  <Field
                    label="Fatura não paga vai para a próxima"
                    hint={
                      form.rotativoAuto
                        ? 'No dia seguinte ao vencimento, o saldo em aberto vira uma linha na próxima fatura.'
                        : 'Desligado, a fatura fica em aberto e você decide na tela dela.'
                    }>
                    <View style={styles.switchRow}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Adiar sozinho depois do vencimento
                      </ThemedText>
                      <Switch
                        accessibilityLabel="Adiar a fatura não paga automaticamente"
                        accessibilityHint="Desligado, a fatura vencida fica em aberto até você decidir"
                        value={form.rotativoAuto}
                        onValueChange={(rotativoAuto: boolean) => setForm({ ...form, rotativoAuto })}
                      />
                    </View>
                  </Field>

                  <Field
                    label="Juros do rotativo de partida (% ao mês)"
                    hint="Serve de partida: na primeira cobrança real o app passa a usar a deste cartão."
                    error={
                      form.rotativoRate.trim() && !taxaValida(form.rotativoRate)
                        ? 'Use um número de 0 a 100, como 15,5'
                        : undefined
                    }>
                    <TextField
                      value={form.rotativoRate}
                      onChangeText={(rotativoRate) =>
                        setForm({ ...form, rotativoRate: rotativoRate.replace(/[^\d,.]/g, '').slice(0, 6) })
                      }
                      keyboardType="decimal-pad"
                      placeholder="15,5"
                    />
                  </Field>

                  <Field label="Limite do cartão">
                    <MoneyField
                      valueCents={form.limitCents}
                      onChangeCents={(limitCents) => setForm({ ...form, limitCents })}
                    />
                  </Field>

                  <Field
                    label="Conta que paga a fatura"
                    hint="A fatura já vem com ela sugerida quando você for registrar o pagamento.">
                    <Section>
                      <Row
                        title="Escolher na hora de pagar"
                        onPress={() => setForm({ ...form, payerId: null })}
                        trailing={
                          form.payerId === null ? (
                            <Icon name="checkmark" size="sm" color="tint" />
                          ) : undefined
                        }
                      />
                      {pagadoras.map((a) => (
                        <Row
                          key={a.id}
                          title={a.name}
                          icon={ICONE[a.type]}
                          onPress={() => setForm({ ...form, payerId: a.id })}
                          trailing={
                            form.payerId === a.id ? (
                              <Icon name="checkmark" size="sm" color="tint" />
                            ) : undefined
                          }
                        />
                      ))}
                    </Section>
                  </Field>
                </>
              ) : (
                <Field label="Saldo inicial" hint="O que já estava na conta antes de você usar o app.">
                  <MoneyField
                    valueCents={form.initialCents}
                    onChangeCents={(initialCents) => setForm({ ...form, initialCents })}
                  />
                </Field>
              )}

              {save.isError ? (
                <ThemedText type="small" themeColor="danger" style={styles.bandText}>
                  Não deu para salvar. Já existe uma conta com esse nome?
                </ThemedText>
              ) : null}
            </ScrollView>
          ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  hero: {
    gap: Space.sm,
  },
  heroSplit: {
    flexDirection: 'row',
    gap: Space.xl,
  },
  heroPart: {
    gap: Space.xs,
  },
  band: {
    alignItems: 'center',
    gap: Space.md,
  },
  bandText: {
    textAlign: 'center',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  diaRow: {
    flexDirection: 'row',
    gap: Space.lg,
  },
  diaCampo: {
    flex: 1,
  },
});
