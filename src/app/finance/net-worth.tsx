import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';

import { monthShort } from '@/components/finance/month-picker';
import { FinanceAnalysisPanes } from '@/components/finance/finance-analysis-panes';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Deslizavel } from '@/components/ui/deslizavel';
import { SelectField } from '@/components/ui/select-field';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonChart, SkeletonHero, SkeletonList, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { MeasuredSparkline } from '@/components/ui/measured-sparkline';
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
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { formatBRL } from '@/hooks/use-items';
import { formatNumberBR } from '@/lib/dates';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';

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

/** O glifo mora em `ASSET_CLASSES`: a lista e o seletor mostram a mesma forma. */
const CLASSE_ICONE = Object.fromEntries(
  ASSET_CLASSES.map((c) => [c.value, c.icon]),
) as Record<string, (typeof ASSET_CLASSES)[number]['icon']>;

/**
 * Janelas da curva. Mesma ideia dos `HORIZONTES` da projeção: opção fixa e curta, não um
 * seletor de data — quem quer recorte fino vai em Relatórios.
 */
const JANELAS = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
] as const;

/**
 * O que forma o patrimônio líquido, na ordem em que `private.net_worth_now` soma:
 * caixa + investimentos + outros bens − passivos.
 */
const COMPONENTES: {
  key: 'cash_cents' | 'investments_cents' | 'other_assets_cents' | 'liabilities_cents';
  title: string;
  subtitle?: string;
  icon: Parameters<typeof Icon>[0]['name'];
  passivo?: boolean;
}[] = [
  {
    key: 'cash_cents',
    title: 'Dinheiro em conta',
    icon: 'wallet.bifold',
  },
  {
    key: 'investments_cents',
    title: 'Investimentos',
    icon: 'chart.line.uptrend.xyaxis',
  },
  {
    key: 'other_assets_cents',
    title: 'Outros bens',
    icon: 'house',
  },
  {
    key: 'liabilities_cents',
    title: 'O que eu devo',
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
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
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
  /*
    ⚠️ `assets.current_value_cents` é NOT NULL e o campo nasce em 0 — sem esta guarda o Salvar
    aceitava um bem de R$ 0,00, que não soma no patrimônio nem diz nada na lista. O erro só
    aparece depois de o nome estar válido: num bem NOVO os dois campos nascem vazios, e acusar
    na abertura do sheet seria o formulário reclamando antes de a pessoa digitar.
  */
  const valorOk = (form?.valor ?? 0) > 0;

  const salvar = () => {
    if (!form || !nomeOk || !valorOk) return;
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
      title: `Arquivar o bem ${b.name}?`,
      message: 'O histórico de marcações é mantido.',
      confirm: 'Arquivar',
      onConfirm: () =>
        archive.mutate(b.id, {
          onSuccess: () => {
            setForm(null);
            toast({ message: <><Forte>{b.name}</Forte> arquivado.</>, tone: 'success' });
          },
          onError: () => toast({ message: <>Não deu para arquivar <Forte>{b.name}</Forte>.</>, tone: 'error' }),
        }),
    });

  // Editar e arquivar na própria linha, como nas outras listas (25/09/2026): arquivar só existia
  // dentro do formulário de edição.
  const acoesDoBem = (b: Asset): ItemAction[] => [
    { label: 'Editar', icon: 'pencil', arrasto: 'direita', onPress: () => abrirEdicao(b) },
    { label: 'Arquivar', icon: 'archivebox', arrasto: 'esquerda', onPress: () => arquivar(b) },
  ];
  const linhaBem = (b: Asset) => (
    <Deslizavel key={b.id} titulo={b.name} acoes={acoesDoBem(b)}>
      <Row
        title={b.name}
        subtitle={ASSET_CLASSES.find((c) => c.value === b.class)?.label}
        icon={CLASSE_ICONE[b.class]}
        onPress={() => abrirEdicao(b)}
        onLongPress={() => showItemActions(b.name, acoesDoBem(b))}
        accessibilityLabel={`${b.name}, ${b.is_liability ? 'dívida de' : 'vale'} ${formatBRL(b.current_value_cents)}. Toque para atualizar o valor.`}
        trailing={
          <Money
            cents={b.is_liability ? -b.current_value_cents : b.current_value_cents}
            variant="ticker"
            tone={b.is_liability ? 'danger' : 'text'}
            signed={b.is_liability}
          />
        }
      />
    </Deslizavel>
  );

  /*
    O PORTÃO DA TELA (Fase 5) — 6 consultas, 5 portões antes disto.
  */
  const pronta = useTelaPronta(patrimonio, serie, saude, bens);

  if (!pronta) {
    return (
      <Screen grouped>
        <SkeletonHero />
        <SkeletonChart />
        <SkeletonList linhas={3} />
      </Screen>
    );
  }

  const hero = patrimonio.isError ? (
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
        {variacao !== null ? (
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
        ) : null}
      </Card>
    </Animated.View>
  ) : null;

  // A soma fica visível, inclusive parcelas zeradas; erro de refetch nunca reutiliza um total
  // antigo como se fosse atual. O mesmo bloco troca de coluna sem refazer a conta.
  const composition = hoje && !vazioAbsoluto && !patrimonio.isError ? (
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
                variant="ticker"
                tone={c.passivo && bruto > 0 ? 'danger' : 'text'}
                signed={c.passivo && bruto > 0}
              />
            }
          />
        );
      })}
    </Section>
  ) : null;

  // O histórico é snapshot: sem duas fotos, explicamos a ausência da curva em vez de inventar
  // retrospectiva. O gráfico mede a largura do card que o recebe em cada orientação.
  const trend = serie.isError ? (
    <ErrorBand message="Não deu para carregar a evolução." onRetry={serie.refetch} />
  ) : serie.isLoading ? (
    <Card style={styles.bloco}>
      <ThemedText type="smallBold">Evolução</ThemedText>
      <Segmented options={JANELAS} value={janela} onChange={setJanela} />
      <Skeleton height={80} radius={Radius.sm} />
      <View style={styles.eixo}>
        <Skeleton width="24%" height={16} />
        <Skeleton width="24%" height={16} />
      </View>
    </Card>
  ) : pontos.length > 1 ? (
    <Card style={styles.bloco}>
      <ThemedText type="smallBold">Evolução</ThemedText>
      <Segmented options={JANELAS} value={janela} onChange={setJanela} />
      <MeasuredSparkline values={valores} height={80} showZero />
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
    </Card>
  ) : !serie.isLoading ? (
    <Card style={styles.bloco}>
      <ThemedText type="smallBold">A curva ainda não tem história</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        A curva aparece no 2º mês.
      </ThemedText>
    </Card>
  ) : null;

  const health = saude.isError ? (
    <ErrorBand message="Não deu para calcular sua saúde financeira." onRetry={saude.refetch} />
  ) : saude.data ? (
    <Section title="Saúde financeira">
      <Row
        title="Nota"
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
      <Row
        title="Poupança"
        trailing={<ThemedText type="small" style={tabular}>{formatNumberBR(saude.data.savings_rate)}%</ThemedText>}
      />
      <Row
        title="Limites respeitados"
        trailing={<ThemedText type="small" style={tabular}>{formatNumberBR(saude.data.budget_adherence)}%</ThemedText>}
      />
      <Row
        title="Reserva"
        trailing={<ThemedText type="small" style={tabular}>{formatNumberBR(saude.data.months_of_reserve)} meses</ThemedText>}
      />
      <Row
        title="Renda em dívidas"
        trailing={<ThemedText type="small" style={tabular}>{formatNumberBR(saude.data.debt_ratio)}%</ThemedText>}
      />
      <Row title="Ver relatórios" icon="chart.bar" onPress={() => router.push('/finance/reports')} />
    </Section>
  ) : null;

  const assetEvidence = (
    <>
      {bens.isError ? (
        <ErrorBand message="Não deu para carregar seus bens." onRetry={bens.refetch} />
      ) : null}
      {ativos.length > 0 ? <Section title="Bens">{ativos.map(linhaBem)}</Section> : null}
      {passivos.length > 0 ? <Section title="O que eu devo">{passivos.map(linhaBem)}</Section> : null}
      <Section>
        <Row
          title="Dívidas"
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
    </>
  );

  const content = (
    <>
      {hero}
      {composition}
      {trend}
      {health}
      {assetEvidence}
    </>
  );

  return (
    <Screen wide={tablet}
      stagger
      grouped
      onRefresh={() => Promise.all([patrimonio.refetch(), serie.refetch(), saude.refetch(), bens.refetch()])}>
      <Stack.Screen
        options={{
          title: 'Patrimônio',
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

      <FinanceAnalysisPanes
        primary={<>{hero}{trend}</>}
        support={<>{composition}{health}{assetEvidence}</>}
        compact={content}
      />

      <Sheet visible={form !== null} onClose={() => setForm(null)}>
          <TaskHeader
            title={form?.id ? 'Editar bem' : 'Novo bem'}
            onClose={() => setForm(null)}
            action={
              <Button
                label="Salvar"
                size="sm"
                loading={save.isPending}
                disabled={!nomeOk || !valorOk}
                onPress={salvar}
              />
            }
          />

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Nome">
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm({ ...form, name })}
                  placeholder="Ex.: Reserva de emergência"
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

              {/*
                Era uma `Section` de `Row` com um `checkmark` no fim — sete linhas abertas dentro
                de um formulário, e o mesmo desenho de uma lista de conteúdo para o que é um
                CAMPO. `SelectField` é o caminho único dessa escolha no app.
              */}
              <Field label="Tipo">
                <SelectField
                  options={ASSET_CLASSES.map((c) => ({ id: c.value, label: c.label, icon: c.icon }))}
                  value={form.classe}
                  onChange={(classe) => setForm({ ...form, classe: (classe ?? 'other') as Asset['class'] })}
                  placeholder="Escolher"
                />
              </Field>

              <Field
                label="Valor atual"
                error={nomeOk && !valorOk ? 'Informe quanto vale hoje' : undefined}
                hint={
                  form.id
                    ? 'Vira a marcação de hoje'
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
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
});
