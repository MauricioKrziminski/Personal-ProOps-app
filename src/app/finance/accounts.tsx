import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { AccountFormFields } from '@/components/finance/account-form';
import { accountFormFromAccount, accountFormErrors, accountFormPayload, accountFormErrorMessage, emptyAccountForm, type AccountFormState } from '@/lib/account-form';

import { SecaoDeArquivados } from '@/components/ui/secao-de-arquivados';
import { useBRL } from '@/components/ui/conceal';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { ItemLink } from '@/components/ui/item-link';
import { Button } from '@/components/ui/button';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Card } from '@/components/ui/card';
import { Dica } from '@/components/ui/dica';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import {
  ACCOUNT_TYPES,
  NO_ACCOUNT,
  useAccountBalances,
  useAccounts,
  useArchiveAccount,
  useDefaultAccount,
  useSaveAccount,
  useCreateAccount,
  type CreateAccountResult,
  useContaTemLancamentos,
  useSetDefaultAccount,
  type Account,
  type AccountBalance,
} from '@/hooks/use-finance';
import { useVoltarQuandoFechar } from '@/hooks/use-voltar-quando-fechar';
import { saldoDaConta } from '@/lib/accounts';
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
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const balances = useAccountBalances();
  const accounts = useAccounts();
  const contaPadrao = useDefaultAccount();
  const definirPadrao = useSetDefaultAccount();
  const save = useSaveAccount();
  const createAccount = useCreateAccount();
  const savingRef = useRef(false);
  const formSession = useRef(0);
  const creationDraft = useRef<AccountFormState | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const archive = useArchiveAccount();
  // `?create=1` (conta) e `?create=cartao` vêm do "Cadastrar conta/cartão" de outra tela: abre o
  // formulário direto, já no tipo, e fechar ou salvar devolve para ela (25/09/2026) — antes caía
  // na lista, a pessoa ainda tinha que achar o "+", e ali ficava.
  const params = useLocalSearchParams<{ create?: string; edit?: string }>();
  const criando = params.create === '1' || params.create === 'cartao';
  const [form, setForm] = useState<AccountFormState | null>(() =>
    criando ? emptyAccountForm(params.create === 'cartao' ? 'credit_card' : 'checking') : null,
  );
  /** Editando uma conta com lançamento: cartão não vira conta nem o contrário (`20260926170000`). */
  const temLancamentos = useContaTemLancamentos(form?.id).data === true;
  const volta = useVoltarQuandoFechar(criando);

  // `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch
  // falha, e sem este corte a tela seguia afirmando números embaixo da faixa de erro.
  /**
   * A conta mais recente primeiro (24/09/2026). `account_balances` não tem ORDER BY, e a ordem
   * das linhas era a física da tabela — mudava sem ninguém mexer. A data vem de `useAccounts`;
   * contas criadas juntas (o mesmo instante) desempatam pelo nome.
   */
  const criadaEm = new Map((accounts.data ?? []).map((a) => [a.id, a.created_at ?? '']));
  const linhas = (balances.isError ? [] : [...(balances.data ?? [])]).sort(
    (a, b) =>
      (criadaEm.get(b.account_id) ?? '').localeCompare(criadaEm.get(a.account_id) ?? '') ||
      a.name.localeCompare(b.name),
  );
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
    formSession.current += 1;
    savingRef.current = false;
    setCreationError(null);
    save.reset();
    createAccount.reset();
    setForm((createAccount.isPending || createAccount.unconfirmedInput) && creationDraft.current
      ? creationDraft.current : emptyAccountForm());
  };
  const abrirEdicao = (a: Account) => {
    formSession.current += 1;
    savingRef.current = false;
    setCreationError(null);
    save.reset();
    // O campo abre no saldo que a lista mostra, não no inicial (28/09/2026): o Nubank mostrava
    // 162,51 e a edição abria em 867,86. Sem a linha do saldo, cai no inicial com o rótulo dele.
    const linha = balances.data?.find((b) => b.account_id === a.id);
    const atual = linha ? saldoDaConta(linha).cents : null;
    setForm(accountFormFromAccount(a, atual));
  };
  /**
   * `?edit=<conta>` vem de fora (a Carteira, "Editar este cartão"): abre a edição DAQUELA conta
   * quando a lista chega, uma vez só (`edicaoAberta`), e fechar devolve para quem pediu.
   */
  const [edicaoAberta, setEdicaoAberta] = useState<string | null>(null);
  if (params.edit && params.edit !== edicaoAberta && form === null) {
    const alvo = accounts.data?.find((a) => a.id === params.edit);
    // Espera os saldos: sem eles o campo abriria no inicial, que é o número que a pessoa não vê.
    if (alvo && !balances.isPending) {
      setEdicaoAberta(params.edit);
      volta.marcar();
      const linha = balances.data?.find((b) => b.account_id === alvo.id);
      setForm(accountFormFromAccount(alvo, linha ? saldoDaConta(linha).cents : null));
    }
  }

  const formErrors = form ? accountFormErrors(form) : { name: 'Informe o nome' };
  const formValid = Object.keys(formErrors).length === 0;
  const mutationPending = form?.id ? save.isPending : createAccount.isPending;
  const fieldsLocked = mutationPending || (!form?.id && Boolean(createAccount.unconfirmedInput));
  const fecharForm = () => {
    formSession.current += 1;
    volta.aoFechar(() => setForm(null));
  };

  const salvar = () => {
    if (!form || !formValid || savingRef.current || mutationPending) return;
    savingRef.current = true;
    const session = formSession.current;
    const callbacks = {
      onSuccess: (result?: CreateAccountResult) => {
        if (session !== formSession.current) return;
        if (result && result.availability !== 'active') {
          setCreationError(result.availability === 'archived'
            ? 'A conta foi criada, mas está arquivada. Confira em Arquivadas.'
            : 'A conta criada não está disponível. Atualize a lista e confira.');
          return;
        }
        toast({ message: form.id ? 'Conta atualizada.' : 'Conta criada.', tone: 'success' });
        fecharForm();
      },
      onError: (error: unknown) => {
        if (session === formSession.current) toast({ message: accountFormErrorMessage(error), tone: 'error' });
      },
      onSettled: () => { if (session === formSession.current) savingRef.current = false; },
    };
    if (form.id) save.mutate(accountFormPayload(form), { ...callbacks, onSuccess: () => callbacks.onSuccess() });
    else {
      creationDraft.current = form;
      createAccount.mutate(createAccount.unconfirmedInput ?? accountFormPayload(form), callbacks);
    }

  };

  const arquivar = (a: Account) =>
    confirmaDestrutiva({
      title: `Arquivar ${a.type === 'credit_card' ? 'o cartão' : 'a conta'} ${a.name}?`,
      message: 'Os lançamentos são mantidos.',
      confirm: 'Arquivar',
      onConfirm: () =>
        archive.mutate(a.id, {
          onSuccess: () => toast({ message: <>{a.type === 'credit_card' ? 'Cartão' : 'Conta'} <Forte>{a.name}</Forte> {a.type === 'credit_card' ? 'arquivado' : 'arquivada'}.</>, tone: 'success' }),
          onError: () =>
            toast({ message: <>Não deu para arquivar <Forte>{a.name}</Forte>.</>, tone: 'error' }),
        }),
    });

  const linhaConta = (saldo: AccountBalance) => {
    const conta = contaDe(saldo.account_id);
    const cartao = saldo.type === 'credit_card';
    /**
     * Cartão mostra o TOTAL (parcela futura é dívida assumida); conta de dinheiro mostra o
     * confirmado, e o que falta cair vai para o subtítulo em vez de sumir dentro do número.
     */
    const { cents, previsto } = saldoDaConta(saldo);
    const negativo = cents < 0;
    const tipo = ACCOUNT_TYPES.find((t) => t.value === saldo.type)?.label ?? '';
    const ciclo =
      conta?.closing_day && conta.due_day
        ? `fecha dia ${conta.closing_day} · vence dia ${conta.due_day}`
        : null;
    const previstoTexto =
      previsto > 0
        ? cartao
          ? `${brl(previsto)} a vencer`
          : `${brl(previsto)} a receber`
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
            arrasto: 'fora',
            onPress: () =>
              router.push({
                pathname: '/finance/transactions',
                params: { accountId: saldo.account_id },
              }),
          },
          {
            label: 'Editar',
            icon: 'pencil',
            arrasto: 'direita',
            disabled: !conta,
            onPress: () => conta && abrirEdicao(conta),
          },
          {
            label: 'Arquivar',
            icon: 'archivebox',
            arrasto: 'esquerda',
            disabled: !conta,
            onPress: () => conta && arquivar(conta),
          },
        ]}>
        {({ onLongPress }) => (
          <Row
            title={saldo.name}
            // O tipo embaixo do nome some quando É o nome ("Poupança / Poupança").
            subtitle={[ciclo ?? (tipo.toLowerCase() === saldo.name.toLowerCase() ? null : tipo), previstoTexto]
              .filter(Boolean)
              .join(' · ')}
            icon={ICONE[saldo.type]}
            // o valor negativo não pode ser comunicado só pela cor — e o previsto precisa
            // estar aqui também, senão o leitor de tela esconde o que a tela mostra
            accessibilityLabel={`${saldo.name}, ${tipo}, ${negativo ? 'deve' : 'tem'} ${brl(Math.abs(cents))}${previstoTexto ? `, ${previstoTexto}` : ''}`}
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

  const loading = balances.isLoading ? (
    <>
      <Skeleton height={120} radius={Radius.lg} />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : null;

  const hero =
    balances.isError ? (
      <ErrorBand message="Não deu para carregar seus saldos." onRetry={balances.refetch} />
    ) : balances.data && !semDadoNenhum ? (
      <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
        <Card style={styles.hero}>
          <HeroLabel>Dinheiro disponível</HeroLabel>
          <Money cents={caixa} variant="money" tone={caixa < 0 ? 'danger' : 'text'} />
          {aReceber > 0 ? (
            <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
              + {brl(aReceber)} previstos
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
        </Card>
      </Animated.View>
    ) : null;

  const accountsError = accounts.isError ? (
    <ErrorBand
      message="Não deu para carregar suas contas. Os saldos acima continuam valendo; editar e arquivar voltam quando a lista carregar."
      onRetry={accounts.refetch}
    />
  ) : null;

  const accountSections = (
    <>
      {dinheiro.length + investimentos.length + cartoes.length > 0 ? (
        <Dica id="conta-extrato" tela="contas" bico="baixo" />
      ) : null}
      {dinheiro.length > 0 ? <Section title="Dinheiro">{dinheiro.map(linhaConta)}</Section> : null}
      {investimentos.length > 0 ? (
        <Section title="Investimentos">{investimentos.map(linhaConta)}</Section>
      ) : null}
      {cartoes.length > 0 ? <Section title="Cartões">{cartoes.map(linhaConta)}</Section> : null}
    </>
  );

  const defaultAccount = guardamDinheiro.length > 0 ? (
    <Section title="Conta padrão">
      <Row
        title="Não definir"
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
  ) : null;

  const noAccount = semConta && Number(semConta.balance_cents) !== 0 ? (
    <Section>
      <Row
        title="Sem conta"
        icon="questionmark.circle"
        onPress={() =>
          router.push({ pathname: '/finance/transactions', params: { accountId: NO_ACCOUNT } })
        }
        trailing={<Money cents={Number(semConta.balance_cents)} variant="ticker" />}
      />
    </Section>
  ) : null;

  // O que foi arquivado tem volta daqui (28/09/2026): contas E cartões, cada um dizendo o que é.
  const arquivadas = (
    <SecaoDeArquivados
      tabela="accounts"
      titulo="Arquivadas"
      subtitulo={(a) => (a.type === 'credit_card' ? 'cartão arquivado' : 'conta arquivada')}
    />
  );

  const empty = semNadaCadastrado && !balances.isLoading && !balances.isError ? (
    <EmptyState compacto
      icon="wallet.bifold"
      title={soTemSemConta ? <>Seus lançamentos estão em <Forte>Sem conta</Forte></> : 'Nenhuma conta ainda'}
      hint={
        soTemSemConta
          ? 'Cadastre suas contas para saber quanto tem em cada uma. O que já foi lançado continua valendo.'
          : 'Cadastre onde o dinheiro fica — corrente, poupança, dinheiro, cartão. Depois é só mandar *gastei 45 no mercado no Nubank* no WhatsApp.'
      }
      action={{ label: 'Cadastrar conta', onPress: abrirNova }}
    />
  ) : null;

  // The compact body keeps the original reading order. It is also the measured-pane fallback
  // when a tablet is too narrow to fit both the ledger and decision-support columns.
  const compactBody = (
    <>
      {loading}
      {hero}
      {accountsError}
      {accountSections}
      {/* Como no tablet: com o esqueleto na tela, nada aparece embaixo dele (25/09/2026). */}
      {!balances.isLoading ? defaultAccount : null}
      {noAccount}
      {!balances.isLoading ? arquivadas : null}
      {empty}
    </>
  );

  const ledger = (
    <View style={styles.paneBody}>
      {balances.isLoading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}
      {!balances.isLoading ? accountSections : null}
      {!balances.isLoading ? noAccount : null}
      {!balances.isLoading ? arquivadas : null}
      {!balances.isLoading ? empty : null}
    </View>
  );

  const decisionSupport = (
    <View style={styles.paneBody}>
      {balances.isLoading ? <Skeleton height={120} radius={Radius.lg} /> : null}
      {!balances.isLoading ? hero : null}
      {accountsError}
      {!balances.isLoading ? defaultAccount : null}
    </View>
  );

  const tabletBody = (
    <AdaptivePanes
      main={ledger}
      support={decisionSupport}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="accounts-tablet-workspace"
    />
  );

  return (
    <Screen grouped wide={tablet} onRefresh={() => Promise.all([balances.refetch(), accounts.refetch()])}>
      <Stack.Screen
        options={{
          title: 'Contas',
        }}
      />

      <HeaderActions actions={[{ label: 'Nova conta', icon: 'plus', onPress: abrirNova }]} />

      {tablet ? tabletBody : compactBody}

      <Sheet visible={form !== null} onClose={fecharForm}>

          <TaskHeader
            title={`${form?.id ? 'Editar' : form?.type === 'credit_card' ? 'Novo' : 'Nova'} ${form?.type === 'credit_card' ? 'cartão' : 'conta'}`}
            onClose={fecharForm}
            action={
              <Button
                label="Salvar"
                size="sm"
                loading={mutationPending}
                disabled={!formValid || mutationPending}
                onPress={salvar}
              />
            }
          />

          {form ? (
            <SheetScroll contentContainerStyle={styles.sheetBody}>
              <AccountFormFields form={form} onChange={setForm} accounts={accounts.data ?? []} hasTransactions={temLancamentos} disabled={fieldsLocked} />

              {creationError || (form.id ? save.isError : createAccount.isError) ? (
                <ThemedText type="small" themeColor="danger" style={styles.bandText}>
                  {creationError ?? accountFormErrorMessage(form.id ? save.error : createAccount.error)}
                </ThemedText>
              ) : null}
            </SheetScroll>
          ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  paneBody: {
    gap: Space.xl,
    minWidth: 0,
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
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
});
