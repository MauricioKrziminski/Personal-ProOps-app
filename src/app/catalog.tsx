import { useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
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
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { BarTrack, ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Mark } from '@/components/ui/mark';
import { TaskHeader } from '@/components/ui/task-header';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { TileField } from '@/components/motion/tile-field';
import { useTheme } from '@/hooks/use-theme';
import { Motion, Radius, Space } from '@/design/tokens';
import type { WaveMode } from '@/design/tile-math';

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
  const [valor, setValor] = useState(4500);

  // Rota de desenvolvimento: não existe em build de produção.
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <Screen grouped>
      <ThemedText type="title">Catálogo</ThemedText>

      <VitrineAzulejos />

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
        <View style={{ gap: Space.md, padding: Space.lg, backgroundColor: theme.heroBottom, borderRadius: Radius.md }}>
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
          <Field label="Nome da conta" error="Já existe uma conta «Nubank».">
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

/**
 * A onda de azulejos isolada: os quatro modos, com e sem canto, sobre um conteúdo qualquer.
 * É onde a geometria de `tile-math` é conferida no aparelho antes de virar abertura e trava.
 */
function VitrineAzulejos() {
  const theme = useTheme();
  const progress = useSharedValue(0);
  const [modo, setModo] = useState<WaveMode>('diagonal');
  const [canto, setCanto] = useState<'0' | '3'>('3');
  const [aberto, setAberto] = useState(false);

  const alternar = () => {
    const alvo = aberto ? 0 : 1;
    progress.set(
      withTiming(alvo, { duration: Motion.curtain.duration, easing: Easing.inOut(Easing.cubic) })
    );
    setAberto(!aberto);
  };

  return (
    <View style={{ gap: Space.md }}>
      <ThemedText type="headline">Campo de azulejos</ThemedText>
      <View
        style={{
          height: 320,
          borderRadius: Radius.md,
          overflow: 'hidden',
          backgroundColor: theme.surface,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        <ThemedText type="display">hoje</ThemedText>
        <TileField
          key={`${modo}-${canto}`}
          progress={progress}
          mode={modo}
          origin={modo === 'radial' ? { x: 0.5, y: 0.5 } : { x: 0, y: 1 }}
          corner={Number(canto)}
          cover
          style={StyleSheet.absoluteFill}
        />
      </View>
      <Segmented
        options={[
          { value: 'diagonal', label: 'Diagonal' },
          { value: 'radial', label: 'Radial' },
          { value: 'up', label: 'Sobe' },
          { value: 'down', label: 'Desce' },
        ]}
        value={modo}
        onChange={setModo}
      />
      <Segmented
        options={[
          { value: '0', label: 'Sem canto' },
          { value: '3', label: 'Com canto' },
        ]}
        value={canto}
        onChange={setCanto}
      />
      <Button label={aberto ? 'Cobrir' : 'Revelar'} onPress={alternar} block />
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
