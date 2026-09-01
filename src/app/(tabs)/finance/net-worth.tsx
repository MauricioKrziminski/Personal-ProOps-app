import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';

import { monthShort } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  ASSET_CLASSES,
  useArchiveAsset,
  useAssets,
  useFinancialHealth,
  useNetWorth,
  useNetWorthSeries,
  useSaveAsset,
  type Asset,
} from '@/hooks/use-finance';
import { formatBRL } from '@/hooks/use-items';
import { formatNumberBR } from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * Patrimônio — "estou ficando mais rico ou mais pobre?".
 *
 * É a única tela do app cuja resposta é uma TENDÊNCIA. Por isso o destaque traz a variação, e não
 * só o valor de hoje.
 *
 * **Histórico é SNAPSHOT.** `net_worth_series` lê as fotos diárias de `net_worth_snapshots`: não
 * existe histórico do valor de um imóvel ou de um investimento, e reconstruir seria inventar
 * número. A série começa quando o usuário começou a usar — e a tela DIZ isso, em vez de esconder
 * o bloco (era o que acontecia antes, justo com quem mais precisa da explicação).
 */

const CLASSE_ICONE: Record<string, Parameters<typeof Icon>[0]['name']> = {
  investment: 'chart.line.uptrend.xyaxis',
  real_estate: 'house',
  vehicle: 'car',
  crypto: 'bitcoinsign.circle',
  equity: 'chart.pie',
  receivable: 'clock.arrow.circlepath',
  other: 'shippingbox',
};

/**
 * Janelas da curva. Mesma ideia dos `HORIZONTES` da projeção: opção fixa e curta, não um
 * seletor de data — quem quer recorte fino vai em Relatórios.
 */
const JANELAS = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
];

/**
 * O que forma o patrimônio líquido, na ordem em que `private.net_worth_now` soma:
 * caixa + investimentos + outros bens − passivos.
 */
const COMPONENTES: {
  key: 'cash_cents' | 'investments_cents' | 'other_assets_cents' | 'liabilities_cents';
  title: string;
  subtitle: string;
  icon: Parameters<typeof Icon>[0]['name'];
  passivo?: boolean;
}[] = [
  {
    key: 'cash_cents',
    title: 'Dinheiro em conta',
    subtitle: 'sem contar o cartão',
    icon: 'wallet.bifold',
  },
  {
    key: 'investments_cents',
    title: 'Investimentos',
    subtitle: 'investimento, cripto e participação',
    icon: 'chart.line.uptrend.xyaxis',
  },
  {
    key: 'other_assets_cents',
    title: 'Outros bens',
    subtitle: 'imóvel, veículo, a receber',
    icon: 'house',
  },
  {
    key: 'liabilities_cents',
    title: 'Passivos',
    subtitle: 'fatura aberta e dívidas',
    icon: 'creditcard',
    passivo: true,
  },
];

interface FormState {
  id?: string;
  name: string;
  classe: Asset['class'];
  passivo: boolean;
  valor: number;
  /** Valor com que o bem foi aberto: se não mudar, não vira marcação nova no histórico. */
  valorOriginal: number;
}

const FORM_VAZIO: FormState = {
  name: '',
  classe: 'investment',
  passivo: false,
  valor: 0,
  valorOriginal: -1,
};

/** Delega para o helper único: no Android o `Alert` cortaria opção, o sheet compartilhado não. */
function confirmaDestrutiva(opts: {
  title: string;
  message?: string;
  confirm: string;
  onConfirm: () => void;
}) {
  confirmDestructive(opts.title, opts.confirm, opts.onConfirm, opts.message);
}

/** Faixa de erro por bloco: seção que falha diz que falhou em vez de sumir. */
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

export default function NetWorthScreen() {
  const toast = useToast();
  const { width } = useWindowDimensions();
  const patrimonio = useNetWorth();
  const [janela, setJanela] = useState('12');
  const serie = useNetWorthSeries(Number(janela));
  const saude = useFinancialHealth();
  const bens = useAssets();
  const save = useSaveAsset();
  const archive = useArchiveAsset();
  const [form, setForm] = useState<FormState | null>(null);

  const hoje = patrimonio.data;
  const pontos = serie.data ?? [];
  const valores = pontos.map((p) => Number(p.net_cents));
  const liquido = Number(hoje?.net_cents ?? 0);
  // variação contra a foto mais antiga que existe — é o que responde "subindo ou descendo?"
  const variacao = pontos.length > 1 ? liquido - Number(pontos[0].net_cents) : null;
  const mesesDeSerie = Math.max(pontos.length - 1, 1);
  // Eixo com ano quando as pontas caem em anos diferentes.
  const atravessaAno =
    pontos.length > 1 && pontos[0].month.slice(0, 4) !== pontos[pontos.length - 1].month.slice(0, 4);

  const ativos = (bens.data ?? []).filter((b) => !b.is_liability);
  const passivos = (bens.data ?? []).filter((b) => b.is_liability);
  // erro em `bens` não pode virar "você não tem nada" — são telas diferentes
  const vazioAbsoluto =
    !patrimonio.isLoading &&
    !bens.isError &&
    liquido === 0 &&
    Number(hoje?.cash_cents ?? 0) === 0 &&
    (bens.data ?? []).length === 0;

  // erro fica dentro do sheet: toast aparece ATRÁS de um Modal nativo e o usuário não veria nada
  const abrirNovo = () => {
    save.reset();
    archive.reset();
    setForm({ ...FORM_VAZIO });
  };
  const abrirEdicao = (b: Asset) => {
    save.reset();
    archive.reset();
    setForm({
      id: b.id,
      name: b.name,
      classe: b.class,
      passivo: b.is_liability,
      valor: b.current_value_cents,
      valorOriginal: b.current_value_cents,
    });
  };

  const nomeOk = (form?.name.trim().length ?? 0) >= 2;

  const salvar = () => {
    if (!form || !nomeOk) return;
    save.mutate(
      {
        id: form.id,
        name: form.name.trim(),
        class: form.classe,
        is_liability: form.passivo,
        current_value_cents: form.valor,
        // marcação nova só quando o valor mudou de verdade: renomear não é remarcar
        revalue: !form.id || form.valor !== form.valorOriginal,
      },
      {
        onSuccess: () => {
          toast({
            message: form.id ? `${form.name.trim()} atualizado.` : 'Bem cadastrado.',
            tone: 'success',
          });
          setForm(null);
        },
        onError: () =>
          toast({ message: 'Não deu para salvar. Já existe um bem com esse nome?', tone: 'error' }),
      }
    );
  };

  const arquivar = (b: Asset) =>
    confirmaDestrutiva({
      title: `Arquivar "${b.name}"?`,
      message: 'O histórico de marcações é mantido.',
      confirm: 'Arquivar',
      onConfirm: () =>
        archive.mutate(b.id, {
          onSuccess: () => {
            setForm(null);
            toast({ message: `${b.name} arquivado.`, tone: 'success' });
          },
          onError: () => toast({ message: `Não deu para arquivar ${b.name}.`, tone: 'error' }),
        }),
    });

  const linhaBem = (b: Asset) => (
    <Row
      key={b.id}
      title={b.name}
      subtitle={ASSET_CLASSES.find((c) => c.value === b.class)?.label}
      icon={CLASSE_ICONE[b.class]}
      onPress={() => abrirEdicao(b)}
      accessibilityLabel={`${b.name}, ${b.is_liability ? 'dívida de' : 'vale'} ${formatBRL(b.current_value_cents)}. Toque para atualizar o valor.`}
      trailing={
        <Money
          cents={b.is_liability ? -b.current_value_cents : b.current_value_cents}
          variant="headline"
          tone={b.is_liability ? 'danger' : 'text'}
          signed={b.is_liability}
        />
      }
    />
  );

  return (
    <Screen
      grouped
      onRefresh={() => {
        patrimonio.refetch();
        serie.refetch();
        saude.refetch();
        bens.refetch();
      }}
      refreshing={patrimonio.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Patrimônio',
          headerLargeTitle: true,
        }}
      />

      <HeaderActions actions={[{ label: 'Novo bem', icon: 'plus', onPress: abrirNovo }]} />

      {patrimonio.isLoading ? (
        <>
          <Skeleton height={140} radius={Radius.lg} />
          <Skeleton height={120} radius={Radius.md} />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único destaque da tela. */}
      {patrimonio.isError ? (
        <ErrorBand message="Não deu para calcular seu patrimônio." onRetry={patrimonio.refetch} />
      ) : hoje && !vazioAbsoluto ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Patrimônio líquido</HeroLabel>
            <Money
              cents={liquido}
              variant="money"
              tone={liquido < 0 ? 'danger' : 'text'}
              signed={liquido < 0}
            />
            {variacao === null ? (
              <ThemedText type="small" themeColor="textSecondary">
                A variação aparece quando houver mais de uma foto do seu patrimônio.
              </ThemedText>
            ) : (
              <View style={styles.variacao}>
                <Icon
                  name={variacao >= 0 ? 'arrow.up.right' : 'arrow.down.right'}
                  size="sm"
                  color={variacao >= 0 ? 'success' : 'danger'}
                />
                <Money
                  cents={variacao}
                  variant="subhead"
                  tone={variacao >= 0 ? 'success' : 'danger'}
                  signed
                />
                <ThemedText type="small" themeColor="textSecondary">
                  em {mesesDeSerie} {mesesDeSerie === 1 ? 'mês' : 'meses'}
                </ThemedText>
              </View>
            )}
          </Card>
        </Animated.View>
      ) : null}

      {/* A conta por trás do número: os quatro somam (passivo entra negativo) o valor do herói.
          Linha com R$ 0,00 FICA — é ela que diz "você não cadastrou investimento nenhum", e
          esconder uma parcela faria a soma não fechar aos olhos de quem confere. */}
      {/* `patrimonio.isError` também some com o bloco: `data` do TanStack SOBREVIVE ao erro de
          refetch, então offline a faixa "Não deu para calcular seu patrimônio" ficava em cima de
          quatro linhas exibindo o patrimônio com toda a confiança. A seção que falhou já diz que
          falhou — quem depende da MESMA query não repete o aviso nem finge que tem número. */}
      {hoje && !vazioAbsoluto && !patrimonio.isError ? (
        <Section title="O que forma esse número">
          {COMPONENTES.map((c) => {
            const bruto = Number(hoje[c.key] ?? 0);
            const cents = c.passivo ? -bruto : bruto;
            return (
              <Row
                key={c.key}
                title={c.title}
                subtitle={c.subtitle}
                icon={c.icon}
                accessibilityLabel={`${c.title}, ${c.passivo ? 'menos' : 'mais'} ${formatBRL(bruto)}`}
                trailing={
                  <Money
                    cents={cents}
                    variant="headline"
                    tone={c.passivo && bruto > 0 ? 'danger' : 'text'}
                    signed={c.passivo && bruto > 0}
                  />
                }
              />
            );
          })}
        </Section>
      ) : null}

      {serie.isError ? (
        <ErrorBand message="Não deu para carregar a evolução." onRetry={serie.refetch} />
      ) : pontos.length > 1 ? (
        <Card style={styles.bloco}>
          <ThemedText type="smallBold">Evolução</ThemedText>
          <Segmented options={JANELAS} value={janela} onChange={setJanela} />
          <Sparkline values={valores} width={width - Space.lg * 4} height={80} showZero />
          <View style={styles.eixo}>
            <ThemedText type="small" themeColor="textSecondary">
              {monthShort(pontos[0].month, atravessaAno)}
            </ThemedText>
            <View style={styles.eixoFim}>
              <ThemedText type="small" themeColor="textSecondary">
                {monthShort(pontos[pontos.length - 1].month, atravessaAno)}
              </ThemedText>
              <Money
                cents={Number(pontos[pontos.length - 1].net_cents)}
                variant="footnote"
                tone="textSecondary"
              />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            A linha do zero é a de referência: abaixo dela o patrimônio é negativo.
          </ThemedText>
        </Card>
      ) : !serie.isLoading ? (
        /* O estado mais importante da tela: é o de TODO usuário novo. */
        <Card style={styles.bloco}>
          <ThemedText type="smallBold">A curva ainda não tem história</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            A foto do seu patrimônio é tirada todo dia. A curva aparece a partir do segundo mês —
            não dá para reconstruir o valor de um bem no passado sem inventar número.
          </ThemedText>
        </Card>
      ) : null}

      {saude.isError ? (
        <ErrorBand message="Não deu para calcular sua saúde financeira." onRetry={saude.refetch} />
      ) : saude.data ? (
        <Section title="Saúde financeira">
          <Row
            title="Score"
            subtitle="de 0 a 100"
            trailing={
              <ThemedText
                type="subtitle"
                themeColor={
                  saude.data.score >= 70 ? 'success' : saude.data.score >= 40 ? 'warning' : 'danger'
                }
                style={tabular}>
                {saude.data.score}
              </ThemedText>
            }
          />
          <View style={styles.scoreBar}>
            <ProgressBar
              value={saude.data.score}
              max={100}
              tone={
                saude.data.score >= 70 ? 'success' : saude.data.score >= 40 ? 'warning' : 'danger'
              }
            />
          </View>
          {/* Os pesos são o que diz ao usuário O QUE MEXER — antes era um parágrafo corrido. */}
          <Row
            title="Poupança"
            subtitle="peso 40 pts"
            trailing={
              <ThemedText type="small" style={tabular}>
                {formatNumberBR(saude.data.savings_rate)}%
              </ThemedText>
            }
          />
          <Row
            title="Orçamentos respeitados"
            subtitle="peso 25 pts"
            trailing={
              <ThemedText type="small" style={tabular}>
                {formatNumberBR(saude.data.budget_adherence)}%
              </ThemedText>
            }
          />
          <Row
            title="Reserva"
            subtitle="peso 20 pts"
            trailing={
              <ThemedText type="small" style={tabular}>
                {formatNumberBR(saude.data.months_of_reserve)} meses
              </ThemedText>
            }
          />
          <Row
            title="Dívida sobre a renda"
            subtitle="peso 15 pts"
            trailing={
              <ThemedText type="small" style={tabular}>
                {formatNumberBR(saude.data.debt_ratio)}%
              </ThemedText>
            }
          />
          <Row
            title="Ver relatórios"
            icon="chart.bar"
            onPress={() => router.push('/finance/reports')}
          />
        </Section>
      ) : null}

      {bens.isError ? (
        <ErrorBand message="Não deu para carregar seus bens." onRetry={bens.refetch} />
      ) : null}

      {ativos.length > 0 ? <Section title="Bens">{ativos.map(linhaBem)}</Section> : null}
      {passivos.length > 0 ? (
        <Section title="Passivos">{passivos.map(linhaBem)}</Section>
      ) : null}

      <Section>
        <Row
          title="Dívidas"
          subtitle="financiamentos e empréstimos entram no passivo"
          icon="banknote"
          onPress={() => router.push('/finance/debts')}
        />
      </Section>

      {!bens.isLoading && !bens.isError && (bens.data ?? []).length === 0 ? (
        <EmptyState
          icon="chart.line.uptrend.xyaxis"
          title={vazioAbsoluto ? 'Seu patrimônio começa aqui' : 'Nenhum bem cadastrado'}
          hint={
            vazioAbsoluto
              ? 'Cadastre o que você tem — investimento, imóvel, carro. O dinheiro em conta e as faturas já entram sozinhos.'
              : 'O dinheiro em conta já está contado acima. Cadastre investimento, imóvel ou carro para completar a conta.'
          }
          action={{ label: 'Cadastrar bem', onPress: abrirNovo }}
        />
      ) : null}

      <Sheet visible={form !== null} onClose={() => setForm(null)}>
          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setForm(null)} />
            <ThemedText type="smallBold">{form?.id ? 'Editar bem' : 'Novo bem'}</ThemedText>
            <Button
              label="Salvar"
              size="sm"
              loading={save.isPending}
              disabled={!nomeOk}
              onPress={salvar}
            />
          </View>

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Nome">
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm({ ...form, name })}
                  placeholder="Tesouro Selic"
                  autoFocus={!form.id}
                  invalid={form.name.length > 0 && !nomeOk}
                />
              </Field>

              <Field label="É bem ou dívida?">
                <Segmented
                  options={[
                    { value: 'bem', label: 'Bem' },
                    { value: 'divida', label: 'Dívida' },
                  ]}
                  value={form.passivo ? 'divida' : 'bem'}
                  onChange={(v) => setForm({ ...form, passivo: v === 'divida' })}
                />
              </Field>

              <Field label="Tipo">
                <Section>
                  {ASSET_CLASSES.map((c) => (
                    <Row
                      key={c.value}
                      title={c.label}
                      icon={CLASSE_ICONE[c.value]}
                      onPress={() => setForm({ ...form, classe: c.value })}
                      trailing={
                        form.classe === c.value ? (
                          <Icon name="checkmark" size="sm" color="tint" />
                        ) : undefined
                      }
                    />
                  ))}
                </Section>
              </Field>

              <Field
                label="Valor atual"
                hint={
                  form.id
                    ? 'Valor novo entra como marcação de hoje no histórico. Igual ao anterior, nada é marcado.'
                    : undefined
                }>
                <MoneyField
                  valueCents={form.valor}
                  onChangeCents={(valor) => setForm({ ...form, valor })}
                  autoFocus={Boolean(form.id)}
                />
              </Field>

              {form.id ? (
                <Button
                  block
                  variant="destructive"
                  label="Arquivar bem"
                  onPress={() => {
                    const alvo = (bens.data ?? []).find((b) => b.id === form.id);
                    if (alvo) arquivar(alvo);
                  }}
                />
              ) : null}

              {save.isError || archive.isError ? (
                <ThemedText type="small" themeColor="danger" style={styles.centered}>
                  {archive.isError
                    ? 'Não deu para arquivar este bem.'
                    : 'Não deu para salvar. Já existe um bem com esse nome?'}
                </ThemedText>
              ) : null}
            </ScrollView>
          ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  variacao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  bloco: {
    gap: Space.md,
  },
  eixo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  eixoFim: {
    alignItems: 'flex-end',
  },
  scoreBar: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  band: {
    alignItems: 'center',
    gap: Space.md,
  },
  centered: {
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
});
