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
import { Radius, Space } from '@/design/tokens';
import { usePlanStatus } from '@/hooks/use-finance';
import { pushBlockerMessage, useRegisterPush, usePushStatus } from '@/hooks/use-push';
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
  const plan = usePlanStatus();

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

  const notifications = (
    <Section title="Notificações">
      <Row
        title="Avisos no celular"
        subtitle={
          push.isError
            ? 'Não deu para verificar'
            : blocker ?? (pushOn ? 'Ligado' : 'Lembretes vão por WhatsApp, que é pago')
        }
        icon="bell.badge"
        chevron={false}
        trailing={
          <Switch
            value={pushOn}
            disabled={pushOn || register.isPending}
            accessibilityLabel="Ativar avisos no celular"
            onValueChange={() =>
              register.mutate(undefined, {
                onSuccess: () => toast({ message: 'Avisos ligados.', tone: 'success' }),
                onError: (e) =>
                  toast({ message: e instanceof Error ? e.message : 'Falhou.', tone: 'error' }),
              })
            }
          />
        }
      />
      <Row
        title="Histórico de alertas"
        icon="clock.arrow.circlepath"
        onPress={() => toast({ message: 'Em breve.', tone: 'info' })}
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
        Cartão de identidade — o topo da tela no desenho.
        Ele responde "de quem é esta conta" antes de qualquer ajuste, e é o que separa uma tela
        de perfil de uma lista de configurações. O nome não existe no schema (só o telefone), e
        por isso o card mostra o número, que é a chave de tudo no produto.
      */}
      <View style={[styles.idCard, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
        <View style={[styles.idAvatar, { backgroundColor: theme.surfaceRaised, borderColor: theme.success }]}>
          <Icon name="person.crop.circle" size="xl" color="textSecondary" />
        </View>
        <View style={styles.idInfo}>
          <ThemedText type="ticker" selectable>
            {phone}
          </ThemedText>
          <View style={styles.idMeta}>
            <Icon name="bubble.left" size="xs" color="success" />
            <ThemedText type="caption" themeColor="textSecondary">
              conectado ao WhatsApp
            </ThemedText>
          </View>
        </View>
        {plan.data?.plan ? (
          <View style={[styles.idPlan, { borderColor: theme.success }]}>
            <ThemedText type="meta" themeColor="success">
              {plan.data.plan.toUpperCase()}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <Section title="Conta">
        {plan.isLoading ? (
          <SkeletonRow />
        ) : plan.isError ? (
          <Row title="Plano" subtitle="Não deu para carregar" icon="exclamationmark.triangle" onPress={() => plan.refetch()} />
        ) : (
          <Row
            title="Plano e família"
            subtitle={plan.data?.plan ? `${plan.data.plan} · ${plan.data.members} de ${plan.data.max_members}` : undefined}
            icon="person.2"
            onPress={() => router.push('/finance/plan')}
          />
        )}
        <Row title="Pessoas" subtitle="quem enxerga o seu financeiro" icon="person.2.fill" onPress={() => router.push('/profile/members')} />
      </Section>

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
  idCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  idAvatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idInfo: { flex: 1, minWidth: 0, gap: Space.xs },
  idMeta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  idPlan: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Space.xl,
  },
});
