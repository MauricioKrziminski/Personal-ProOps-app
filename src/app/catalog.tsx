import { useState } from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';

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
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Mark } from '@/components/ui/mark';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Space } from '@/design/tokens';

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
