import { StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { AppHeader } from '@/components/ui/app-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Segmented } from '@/components/ui/segmented';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { GradientSurface } from '@/components/ui/gradient';
import { Button } from '@/components/ui/button';
import { Radius, Space, tabular } from '@/design/tokens';
import { currentMonth } from '@/components/finance/month-picker';
import { useAiMonthStats, usePlanStatus } from '@/hooks/use-finance';
import {
  pushBlockerMessage,
  useAlertsEnabled,
  useRegisterPush,
  usePushStatus,
  useSetAlertsEnabled,
  useUnregisterPush,
} from '@/hooks/use-push';
import { formatDateBR } from '@/hooks/use-items';
import { useSession } from '@/hooks/use-session';
import { useTheme, useThemeMode } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/item-actions';
import { supabase } from '@/lib/supabase';

/**
 * Perfil — tela de manutenção. O sucesso dela é a pessoa achar o que veio buscar e sair.
 *
 * A seção de Notificações **sobe para o topo enquanto o push está desligado**: é a ação com maior
 * consequência econômica do produto (sem token, todo lembrete vira template pago do WhatsApp).
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();
  const { session } = useSession();
  const toast = useToast();
  const userId = session?.user?.id;

  const push = usePushStatus(userId);
  const register = useRegisterPush(userId);
  const unregister = useUnregisterPush(userId);
  const alerts = useAlertsEnabled(userId);
  const setAlerts = useSetAlertsEnabled(userId);
  const plan = usePlanStatus();
  const ia = useAiMonthStats(currentMonth());

  const phone = session?.user?.phone ? `+${session.user.phone}` : '—';
  const pushOn = push.data?.registered ?? false;
  const blocker = pushBlockerMessage(push.data?.blocker ?? 'unknown');

  const confirmSignOut = () => {
    const doIt = async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await supabase.auth.signOut();
    };
    confirmDestructive('Sair da conta?', 'Sair', doIt);
  };

  const aparencia = (
    <Section title="Aparência">
      <View style={styles.temaRow}>
        <View style={styles.temaText}>
          <ThemedText type="default">Tema</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {mode === 'system' ? 'seguindo o aparelho' : mode === 'dark' ? 'sempre escuro' : 'sempre claro'}
          </ThemedText>
        </View>
        <View style={styles.temaControl}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'system', label: 'Sistema' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Escuro' },
            ]}
          />
        </View>
      </View>
    </Section>
  );

  const alertsOn = alerts.data ?? true;

  /**
   * Duas chaves, e elas NÃO são a mesma coisa — a tela precisa deixar isso explícito.
   *
   * - **"Avisos do ProOps"** decide SE o app te interrompe (orçamento estourando, fatura
   *   vencendo, projeção no vermelho). É o interruptor que não existia: até a `0049` não havia
   *   coluna de preferência nenhuma e `_alerts_to_send` varria todo mundo.
   * - **"Avisos no celular"** decide POR ONDE. Com push, é notificação e é grátis; sem push, o
   *   cron cai no template do WhatsApp, que é PAGO.
   *
   * Por isso o push deixou de ser porta de mão única (era `disabled={pushOn}`) e por isso o
   * subtítulo dele muda conforme a outra chave: com os alertas desligados, o canal não decide
   * mais nada, e prometer "vai por WhatsApp" seria mentira.
   */
  const notifications = (
    <Section title="Notificações">
      <Row
        title="Avisos do ProOps"
        subtitle={
          alertsOn
            ? 'Orçamento estourando, fatura vencendo, saldo no vermelho'
            : 'Desligado — o app não te procura'
        }
        icon="bell"
        chevron={false}
        trailing={
          <Switch
            value={alertsOn}
            disabled={setAlerts.isPending || alerts.isLoading}
            accessibilityLabel="Receber avisos do ProOps"
            onValueChange={(v) =>
              setAlerts.mutate(v, {
                onSuccess: () =>
                  toast({
                    message: v ? 'Avisos ligados.' : 'Não te procuro mais.',
                    tone: 'success',
                  }),
                onError: () => toast({ message: 'Não deu para salvar.', tone: 'error' }),
              })
            }
          />
        }
      />
      <Row
        title="Avisos no celular"
        subtitle={
          push.isError
            ? 'Não deu para verificar'
            : !alertsOn
              ? 'Só vale quando os avisos estão ligados'
              : (blocker ?? (pushOn ? 'Chegam como notificação' : 'Vão por WhatsApp, que é pago'))
        }
        icon="bell.badge"
        chevron={false}
        trailing={
          <Switch
            value={pushOn}
            disabled={register.isPending || unregister.isPending || (!pushOn && !!blocker)}
            accessibilityLabel="Receber avisos como notificação no celular"
            onValueChange={(v) =>
              v
                ? register.mutate(undefined, {
                    onSuccess: () => toast({ message: 'Avisos ligados.', tone: 'success' }),
                    onError: (e) =>
                      toast({ message: e instanceof Error ? e.message : 'Falhou.', tone: 'error' }),
                  })
                : unregister.mutate(undefined, {
                    onSuccess: () =>
                      toast({ message: 'Agora os avisos vão pelo WhatsApp.', tone: 'info' }),
                    onError: () => toast({ message: 'Não deu para desligar.', tone: 'error' }),
                  })
            }
          />
        }
      />
      <Row
        title="Histórico de alertas"
        icon="clock.arrow.circlepath"
        onPress={() => router.push('/profile/alerts')}
      />
    </Section>
  );

  return (
    <Screen
      grouped
      topBar={<AppHeader title="Perfil" />}
      onRefresh={() => { push.refetch(); plan.refetch(); }}
      refreshing={push.isRefetching}>
      {/*
        Cartão de identidade — o topo da tela no desenho do Stitch.

        Responde "de quem é esta conta" antes de qualquer ajuste, e é o que separa uma tela de
        perfil de uma lista de configurações. Fundo em gradiente com brilho, como o painel de
        destaque: é o único bloco de destaque desta tela (§1, um por tela).

        O nome não existe no schema — `profiles` guarda só o telefone —, então o card mostra o
        número, que é a chave de tudo no produto. O selo verde no avatar diz o que o número
        significa aqui: está vinculado ao WhatsApp.
      */}
      <View style={[styles.idCard, { borderColor: theme.cardBorder, backgroundColor: theme.heroBottom }]}>
        <GradientSurface from={theme.heroTop} to={theme.heroBottom} sheen={`${theme.tint}1F`} />

        <View style={styles.idTop}>
          <View>
            <View style={[styles.idAvatar, { backgroundColor: theme.heroChip }]}>
              <Icon name="person.crop.circle" size="xl" color="onHero" />
            </View>
            <View style={[styles.idSelo, { backgroundColor: theme.tint, borderColor: theme.heroBottom }]}>
              <Icon name="checkmark" size="xs" color="onTint" />
            </View>
          </View>

          <View style={styles.idInfo}>
            <ThemedText type="ticker" themeColor="onHero" selectable>
              {phone}
            </ThemedText>
            <View style={styles.idMeta}>
              <Icon name="bubble.left" size="xs" color="onHeroSuccess" />
              <ThemedText type="caption" themeColor="onHeroMuted">
                conectado ao WhatsApp
              </ThemedText>
            </View>
          </View>

          {plan.data?.plan ? (
            <View style={[styles.idPlan, { backgroundColor: theme.heroChip }]}>
              <ThemedText type="meta" themeColor="onHeroSuccess">
                {plan.data.plan.toUpperCase()}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/*
          A grade de estatísticas do desenho — três números, **todos medidos**.

          O Stitch põe "99,8% de acurácia da LLM" na terceira coluna. Não existe dado nenhum que
          sustente isso: `ai_events` conta CHAMADAS, não acertos. No lugar vai o consumo de
          mensagens de IA do mês, que é medido de verdade e ainda é o número que decide se o
          plano vai estourar.
        */}
        <View style={styles.idStats}>
          <Stat
            valor={ia.data ? String(ia.data.lancamentos) : '—'}
            rotulo="lançamentos por mensagem"
          />
          <Stat valor={ia.data ? String(ia.data.notas) : '—'} rotulo="notas capturadas" />
          <Stat
            valor={plan.data ? String(plan.data.ai_messages_month) : '—'}
            rotulo="mensagens de IA no mês"
            limite={plan.data ? plan.data.max_ai_messages_month : null}
          />
        </View>
      </View>

      {/*
        Assinatura — card próprio, não uma linha perdida em "Conta".
        É o segundo motivo pelo qual alguém abre o Perfil (o primeiro é desligar notificação), e
        como `Row` ele competia em peso com "Lixeira de notas".
      */}
      {plan.isLoading ? (
        <Section>
          <SkeletonRow />
        </Section>
      ) : plan.isError ? (
        <Section>
          <Row
            title="Plano"
            subtitle="Não deu para carregar"
            icon="exclamationmark.triangle"
            onPress={() => plan.refetch()}
          />
        </Section>
      ) : plan.data ? (
        <View style={[styles.planoCard, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
          <View style={styles.planoTopo}>
            <View style={styles.shrink}>
              <ThemedText type="smallBold">{`Plano ${plan.data.plan}`}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {plan.data.is_trial
                  ? `Teste até ${formatDateBR(plan.data.current_period_end)}`
                  : `${plan.data.members} de ${plan.data.max_members} ${plan.data.max_members === 1 ? 'pessoa' : 'pessoas'}`}
              </ThemedText>
            </View>
            <View
              style={[
                styles.planoBadge,
                { backgroundColor: plan.data.is_trial ? theme.warningSoft : theme.successSoft },
              ]}>
              <ThemedText type="meta" themeColor={plan.data.is_trial ? 'warning' : 'success'}>
                {plan.data.is_trial ? 'TESTE' : 'ATIVO'}
              </ThemedText>
            </View>
          </View>

          <View style={styles.planoAcoes}>
            <Button
              label="Gerenciar plano"
              icon="creditcard"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/finance/plan')}
            />
            <Button
              label="Pessoas"
              icon="person.2"
              variant="ghost"
              size="sm"
              onPress={() => router.push('/profile/members')}
            />
          </View>
        </View>
      ) : null}

      {/*
        Notificações tem UM lugar, logo abaixo de Conta.
        Antes ela era renderizada em duas posições diferentes conforme o push estivesse ligado ou
        não — o bloco "subia" quando desligado. Um bloco que muda de lugar conforme o estado
        obriga a pessoa a procurá-lo, e a promoção rendia pouco: aqui ele já é a segunda seção de
        cinco. O alerta de push desligado é a LINHA, não a posição dela.
      */}
      {notifications}

      <Section title="Dados">
        <Row title="Lixeira de notas" icon="trash" onPress={() => router.push('/notes/trash')} />
        <Row title="Regras de categoria" icon="wand.and.stars" onPress={() => router.push('/finance/rules')} />
        <Row title="Importar extrato" icon="square.and.arrow.down" onPress={() => router.push('/import')} />
        <Row title="Importações" subtitle="histórico e revisões pendentes" icon="clock.arrow.circlepath" onPress={() => router.push('/import-history')} />
      </Section>

      {aparencia}

      <Section>
        <Row title="Sair da conta" icon="rectangle.portrait.and.arrow.right" destructive chevron={false} onPress={confirmSignOut} />
      </Section>

      {!session ? (
        <EmptyState icon="person.crop.circle.badge.questionmark" title="Sem sessão" hint="Entre para ver seu perfil." />
      ) : null}

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary">
          Personal ProOps app
        </ThemedText>
      </View>
    </Screen>
  );
}

/**
 * Uma coluna da grade de estatísticas do cartão de perfil.
 *
 * Número grande em cima, rótulo pequeno embaixo — o contraste de escala é o que faz o número ser
 * lido primeiro. `limite` só aparece quando existe: escrever "de ∞" para plano ilimitado seria
 * ruído, e escrever "de 0" seria mentira.
 */
function Stat({ valor, rotulo, limite }: { valor: string; rotulo: string; limite?: number | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.heroChip }]}>
      <View style={styles.statValor}>
        <ThemedText type="subtitle" themeColor="onHero" style={tabular}>
          {valor}
        </ThemedText>
        {limite && limite > 0 ? (
          <ThemedText type="code" themeColor="onHeroMuted" style={tabular}>
            {`/${limite}`}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="caption" themeColor="onHeroMuted" numberOfLines={2}>
        {rotulo}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  temaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  temaText: { flex: 1, minWidth: 0 },
  /** Largura fixa: com `flex` o segmentado encolhia até o rótulo "Sistema" truncar. */
  temaControl: { width: 200 },
  shrink: { flex: 1, minWidth: 0 },
  idCard: {
    gap: Space.lg,
    padding: Space.gutter,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  idTop: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  idAvatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** O selo do avatar. A borda é da COR DO CARD, para ele parecer recortado por cima. */
  idSelo: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idInfo: { flex: 1, minWidth: 0, gap: Space.xs },
  idMeta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  idPlan: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  idStats: { flexDirection: 'row', gap: Space.sm },
  stat: {
    flex: 1,
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  statValor: { flexDirection: 'row', alignItems: 'baseline', gap: Space.half },
  planoCard: {
    gap: Space.lg,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  planoTopo: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  planoBadge: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  planoAcoes: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  footer: {
    alignItems: 'center',
    paddingVertical: Space.xl,
  },
});
