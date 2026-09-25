import { useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Easing, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Chip } from '@/components/finance/chip';
import { supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { OtpInput } from '@/components/auth/otp-input';
import { BaseDaPilha, CardFace } from '@/components/finance/card-face';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { BarTrack, ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Mark } from '@/components/ui/mark';
import { TaskHeader } from '@/components/ui/task-header';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { Reveal } from '@/components/motion/reveal';
import { SplitReveal } from '@/components/motion/split-reveal';
import { WaveCurtain } from '@/components/motion/wave-curtain';
import { useTheme } from '@/hooks/use-theme';
import { Motion, Radius, Space } from '@/design/tokens';
import type { FaseDaOnda, WaveMode } from '@/design/wave-math';

/**
 * Catálogo dos primitivos — rota de desenvolvimento.
 *
 * Existe para uma coisa só: olhar os primitivos rodando em light E dark, no simulador e no
 * emulador, antes de qualquer tela ser migrada. É o critério de fechamento da fase 1.
 */
export default function CatalogScreen() {
  const toast = useToast();
  const theme = useTheme();
  const [filtro, setFiltro] = useState('tudo');
  const [temaVisual, setTemaVisual] = useState<'system' | 'light' | 'dark'>('system');
  const [bloqueioVisual, setBloqueioVisual] = useState<'off' | 'on'>('off');
  const [valor, setValor] = useState(4500);
  const { glass } = useLocalSearchParams<{ glass?: string }>();

  // Rota de desenvolvimento: não existe em build de produção.
  if (!__DEV__) return <Redirect href="/" />;

  // Rota de inspeção: superfícies em cima de cores diferentes tornam a refração do
  // material nativo visível no simulador, sem depender de dados da conta.
  if (glass === '1') {
    return (
      <Screen grouped>
        <ThemedText type="title">Controles de vidro</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          API nativa: {supportsLiquidGlass() ? 'disponível' : 'indisponível'}
        </ThemedText>
        <View style={styles.glassStage}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glassStripes]}>
            {[theme.dangerSoft, theme.warningSoft, theme.successSoft, theme.backgroundSelected].map((color) => (
              <View key={color} style={{ flex: 1, backgroundColor: color }} />
            ))}
          </View>
          <Button label="Primário" onPress={() => {}} block />
          <Button label="Secundário" variant="secondary" onPress={() => {}} block />
          <Button label="Fantasma" variant="ghost" onPress={() => {}} />
          <Button label="Destrutivo" variant="destructive" onPress={() => {}} />
          <Button label="Carregando" loading onPress={() => {}} block />
          <Segmented
            options={[{ value: 'tudo', label: 'Tudo' }, { value: 'gastos', label: 'Gastos' }]}
            value={filtro === 'gastos' ? 'gastos' : 'tudo'}
            onChange={setFiltro}
          />
          <View style={{ flexDirection: 'row', gap: Space.sm }}>
            <Chip label="Ativo" selected onPress={() => {}} />
            <Chip label="Inativo" selected={false} onPress={() => {}} />
          </View>
        </View>
        <View style={[styles.glassSettings, { backgroundColor: theme.surface }]}>
          <ThemedText type="smallBold">Seletores no cartão do Perfil</ThemedText>
          <Segmented
            options={[
              { value: 'system', label: 'Sistema' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Escuro' },
            ]}
            value={temaVisual}
            onChange={setTemaVisual}
          />
          <Segmented
            options={[{ value: 'off', label: 'Não' }, { value: 'on', label: 'Sim' }]}
            value={bloqueioVisual}
            onChange={setBloqueioVisual}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen grouped>
      <ThemedText type="title">Catálogo</ThemedText>

      <VitrineCartoes />

      <VitrineEntrada />

      <VitrineCortina />

      <VitrineBotao />

      <VitrineCampos />

      {/*
        Os primitivos de 13/09/2026. Entram aqui porque é onde se olha um primitivo em claro E
        escuro sem precisar do dado real por trás dele — e os três nasceram de uma varredura cujo
        pedido era justamente padronização.
      */}
      <Section title="TaskHeader (sheet e modal usam o MESMO)">
        <View style={{ backgroundColor: theme.groupedBackground, borderRadius: Radius.md, overflow: 'hidden' }}>
          <TaskHeader title="Nova conta" onClose={() => toast({ message: 'fechar', tone: 'info' })} />
        </View>
        <View style={{ backgroundColor: theme.groupedBackground, borderRadius: Radius.md, overflow: 'hidden', marginTop: Space.md }}>
          <TaskHeader
            title="Título longo que precisa quebrar em duas linhas"
            subtitle="de hoje até 10/12/2026"
            onClose={() => toast({ message: 'fechar', tone: 'info' })}
            action={<Button label="Salvar" size="sm" onPress={() => {}} />}
          />
        </View>
      </Section>

      <Section title="CountUpMoney (anima na MUDANÇA, não na montagem)">
        <View style={{ gap: Space.md, padding: Space.lg, backgroundColor: theme.heroSurface, borderRadius: Radius.md }}>
          <CountUpMoney cents={valor} />
          <Button label="Trocar o valor" variant="secondary" size="sm" onPress={() => setValor((v) => (v > 500000 ? 4500 : v * 7 + 137))} />
        </View>
      </Section>

      <Section title="BarTrack (scaleY, não height)">
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, padding: Space.lg, height: 120 }}>
          {[0.2, 0.55, 1, 0.4, 0, 0.8].map((r, i) => (
            <View key={i} style={{ flex: 1, height: 88, justifyContent: 'flex-end' }}>
              <BarTrack ratio={r} index={i} height={88} color={i === 2 ? theme.tintFill : theme.backgroundElement} dim={i > 3} />
            </View>
          ))}
        </View>
      </Section>

      <Section title="Marca">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xl, padding: Space.lg }}>
          <Mark size={64} />
          <Mark size={32} color="textSecondary" />
          <Mark size={28} spinning />
          <View
            style={{
              backgroundColor: theme.heroSurface,
              padding: Space.md,
              borderRadius: Radius.sm,
            }}>
            <Mark size={40} color="onHero" />
          </View>
        </View>
      </Section>

      <Section title="Botões">
        <View style={{ gap: Space.md, padding: Space.lg }}>
          <Button label="Salvar" onPress={() => {}} icon="checkmark" block />
          <Button label="Cancelar" onPress={() => {}} variant="secondary" block />
          <Button label="Ver tudo" onPress={() => {}} variant="ghost" size="sm" />
          <Button label="Apagar" onPress={() => {}} variant="destructive" size="sm" />
          <Button label="Salvando" onPress={() => {}} loading block />
          <Button label="Indisponível" onPress={() => {}} disabled block />
        </View>
      </Section>

      <Section title="Linhas">
        <Row
          title="Aluguel"
          subtitle="vence hoje"
          icon="house"
          trailing={<Money cents={180000} variant="ticker" />}
          onPress={() => {}}
        />
        <Row
          title="Fatura Nubank"
          subtitle="vence em 3 dias"
          icon="creditcard"
          trailing={<Money cents={89050} variant="ticker" />}
          onPress={() => {}}
        />
        <Row title="Sair da conta" icon="rectangle.portrait.and.arrow.right" destructive onPress={() => {}} />
      </Section>

      <Section title="Dinheiro">
        <View style={{ gap: Space.sm, padding: Space.lg }}>
          <Money cents={124000} variant="money" />
          <Money cents={450000} variant="title2" tone="auto" signed />
          <Money cents={-45090} variant="title2" tone="auto" signed />
          <Money cents={4500} variant="body" tone="textSecondary" />
        </View>
      </Section>

      <Section title="Card opaco">
        <View style={{ padding: Space.lg, gap: Space.md }}>
          <Card>
            <ThemedText type="smallBold">Card padrão</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Superfície opaca. Glass fica na chrome e no destaque único da tela.
            </ThemedText>
          </Card>
          <Card elevation="floating">
            <ThemedText type="smallBold">Elevação floating</ThemedText>
          </Card>
        </View>
      </Section>

      <Section title="Ícones">
        <View style={{ flexDirection: 'row', gap: Space.xl, padding: Space.lg }}>
          <Icon name="house" size="lg" />
          <Icon name="creditcard" size="lg" color="tint" />
          <Icon name="chart.pie" size="lg" color="success" />
          <Icon name="exclamationmark.triangle" size="lg" color="warning" />
          <Icon name="trash" size="lg" color="danger" />
        </View>
      </Section>

      <Section title="Carregando">
        <SkeletonRow />
        <SkeletonRow />
        <View style={{ padding: Space.lg, gap: Space.sm }}>
          <Skeleton height={40} width="50%" />
        </View>
      </Section>

      <Section title="Vazio">
        <EmptyState
          icon="note.text"
          title="Nada anotado ainda"
          hint={'Escreve aqui em cima — ou manda\n“anotar: ligar pro dentista” no WhatsApp'}
          action={{ label: 'Criar nota', onPress: () => {} }}
        />
      </Section>

      <Section title="Segmentado">
        <View style={{ padding: Space.lg, gap: Space.md }}>
          <Segmented
            options={[
              { value: 'tudo', label: 'Tudo' },
              { value: 'gastos', label: 'Gastos' },
              { value: 'receitas', label: 'Receitas' },
            ]}
            value={filtro}
            onChange={setFiltro}
          />
        </View>
      </Section>

      <Section title="Campos">
        <View style={{ padding: Space.lg, gap: Space.xl }}>
          <Field label="Descrição" hint="Como isso aparece no extrato">
            <TextField placeholder="Mercado do bairro" />
          </Field>
          <Field label="Nome da conta" error="Já existe uma conta chamada Nubank.">
            <TextField placeholder="Nubank" defaultValue="Nubank" invalid />
          </Field>
          <Field label="Valor">
            <MoneyField valueCents={valor} onChangeCents={setValor} />
          </Field>
        </View>
      </Section>

      <Section title="Gráficos">
        <View style={{ padding: Space.lg, gap: Space.xl }}>
          <Sparkline values={[120000, 98000, 76000, 51000, 22000, -8000]} width={280} showZero />
          <Sparkline values={[10000, 24000, 31000, 55000, 72000, 91000]} width={280} />
          <ProgressBar value={82} max={100} tone="warning" />
          <ProgressBar value={140} max={100} tone="danger" />
          <ProgressBar value={35} max={100} />
        </View>
      </Section>

      <Section title="Toast">
        <View style={{ padding: Space.lg, gap: Space.md }}>
          <Button
            label="Sucesso com desfazer"
            variant="secondary"
            onPress={() =>
              toast({
                message: 'Nota enviada para a lixeira.',
                tone: 'success',
                action: { label: 'Desfazer', onPress: () => {} },
              })
            }
          />
          <Button
            label="Erro"
            variant="secondary"
            onPress={() => toast({ message: 'Não deu para arquivar a conta.', tone: 'error' })}
          />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  glassStage: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  glassSettings: { gap: Space.md, padding: Space.lg, borderRadius: Radius.md },
  glassStripes: { flexDirection: 'row' },
});

/**
 * A cortina curva isolada: os três modos, cobrindo e revelando, sobre um conteúdo qualquer.
 * É onde a geometria de `wave-math` é conferida no aparelho antes de virar abertura e trava.
 */
function VitrineCortina() {
  const theme = useTheme();
  const progress = useSharedValue(1);
  const [modo, setModo] = useState<WaveMode>('up');
  const [fase, setFase] = useState<FaseDaOnda>('cobrir');
  const [coberto, setCoberto] = useState(false);

  // Cobrir anda de 1 a 0; revelar, de 0 a 1 — a mesma convenção da cortina da raiz.
  const alternar = () => {
    setFase(coberto ? 'revelar' : 'cobrir');
    setCoberto(!coberto);
    progress.set(coberto ? 0 : 1);
    progress.set(
      withTiming(coberto ? 1 : 0, { duration: Motion.curtain.duration, easing: Easing.linear })
    );
  };

  return (
    <View style={{ gap: Space.md }}>
      <ThemedText type="headline">Cortina</ThemedText>
      <View
        style={{
          height: 320,
          borderRadius: Radius.md,
          overflow: 'hidden',
          backgroundColor: theme.surface,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        <ThemedText type="display">Hoje</ThemedText>
        <WaveCurtain
          progress={progress}
          fase={fase}
          mode={modo}
          origin={{ x: 0.5, y: 0.8 }}
          color={theme.curtain}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <Segmented
        options={[
          { value: 'up', label: 'Sobe' },
          { value: 'down', label: 'Desce' },
          { value: 'radial', label: 'Do botão' },
        ]}
        value={modo}
        onChange={setModo}
      />
      <Button label={coberto ? 'Revelar' : 'Cobrir'} onPress={alternar} block />
    </View>
  );
}

/** A face do cartão: emissores de cor clara e escura, a base da pilha e a miniatura. */
function VitrineCartoes() {
  const { width } = useWindowDimensions();
  const largura = width - Space.lg * 2;
  const card = (name: string, extra: object = {}) => ({
    account_id: name,
    name,
    invoice_id: 'x',
    invoice_total_cents: 375122,
    credit_limit_cents: 1200000,
    available_limit_cents: 824878,
    closing_date: '2026-10-03',
    due_date: '2026-10-10',
    overdue_count: 0,
    ...extra,
  });
  return (
    <View style={{ gap: Space.md }}>
      <ThemedText type="headline">Cartão</ThemedText>
      <CardFace nome="Nubank" largura={largura}>
        <BaseDaPilha card={card('Nubank')} onFatura={() => {}} />
      </CardFace>
      <CardFace nome="Ourocard BB" largura={largura} atrasada>
        <BaseDaPilha card={card('Ourocard BB', { closing_date: null })} onFatura={() => {}} />
      </CardFace>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.md }}>
        {['Itaú Black', 'Inter', 'C6 Carbon', 'Cartão da casa', 'Mercado Pago'].map((n) => (
          <CardFace key={n} nome={n} largura={(largura - Space.md) / 2} />
        ))}
        <CardFace nome="Nubank" largura={56} />
      </View>
    </View>
  );
}

/** O morph do botão: toque alterna entre ação e carregando, nas quatro variantes. */
function VitrineBotao() {
  const [carregando, setCarregando] = useState(false);
  const alternar = () => setCarregando((v) => !v);
  return (
    <View style={{ gap: Space.md }}>
      <ThemedText type="headline">Botão (morph)</ThemedText>
      <Button label="Entrar" onPress={alternar} loading={carregando} block size="lg" />
      <Button label="Registrar pagamento" variant="secondary" onPress={alternar} loading={carregando} block />
      <View style={{ flexDirection: 'row', gap: Space.md }}>
        <Button label="Apagar" variant="destructive" onPress={alternar} loading={carregando} />
        <Button label="Salvar" size="sm" onPress={alternar} loading={carregando} />
      </View>
      <Button label={carregando ? 'Parar' : 'Carregar todos'} variant="ghost" onPress={alternar} />
      {/* Guarda do Android: rótulo com espaço no tamanho pequeno já saiu cortado ("Trocar o"). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.md }}>
        <Button label="Trocar o valor" variant="secondary" size="sm" onPress={() => {}} />
        <Button label="Trocar o valor" variant="secondary" onPress={() => {}} />
        <Button label="Trocar o valor" size="sm" onPress={() => {}} />
      </View>
    </View>
  );
}

/** Os campos: foco que desenha o traço, erro que treme, e o odômetro do valor. */
function VitrineCampos() {
  const [nome, setNome] = useState('');
  const [centavos, setCentavos] = useState(0);
  const [modo, setModo] = useState<'mes' | 'ciclo' | 'ano'>('ciclo');
  const [codigo, setCodigo] = useState('');
  const invalido = nome.length > 0 && nome.length < 3;
  return (
    <View style={{ gap: Space.lg }}>
      <ThemedText type="headline">Campos</ThemedText>
      <Field label="Título" error={invalido ? 'Pelo menos 3 letras.' : undefined} hint="O nome que aparece na lista.">
        <TextField value={nome} onChangeText={setNome} placeholder="Ex.: Mercado" invalid={invalido} />
      </Field>
      <Field label="Valor">
        <MoneyField valueCents={centavos} onChangeCents={setCentavos} />
      </Field>
      {/* O código de 6 dígitos sem mandar e-mail nem WhatsApp: "000000" mostra o erro. */}
      <OtpInput
        value={codigo}
        onChange={setCodigo}
        onComplete={() => {}}
        invalid={codigo === '000000'}
      />
      <Segmented
        options={[
          { value: 'mes', label: 'Mês' },
          { value: 'ciclo', label: 'Ciclo' },
          { value: 'ano', label: 'Ano' },
        ]}
        value={modo}
        onChange={setModo}
      />
    </View>
  );
}

/** A entrada tipográfica e a cascata de blocos, com um botão para repetir. */
function VitrineEntrada() {
  const [rodada, setRodada] = useState(0);
  return (
    <View style={{ gap: Space.md }}>
      <ThemedText type="headline">Entrada</ThemedText>
      <View key={rodada} style={{ gap: Space.sm }}>
        <SplitReveal text="bom dia, gabriel" variant="display" />
        <SplitReveal text="R$ 2.450,00" variant="heroMoney" tabular delay={200} />
        {[0, 1, 2].map((i) => (
          <Reveal key={i} index={i + 4}>
            <Card>
              <ThemedText type="default">Bloco {i + 1}</ThemedText>
            </Card>
          </Reveal>
        ))}
      </View>
      <Button label="Repetir entrada" variant="secondary" onPress={() => setRodada((r) => r + 1)} block />
    </View>
  );
}
