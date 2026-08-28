import { StyleSheet, Switch, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { usePlanStatus } from '@/hooks/use-finance';
import { pushBlockerMessage, useRegisterPush, usePushStatus } from '@/hooks/use-push';
import { useSession } from '@/hooks/use-session';
import { confirmDestructive } from '@/lib/item-actions';
import { supabase } from '@/lib/supabase';

/**
 * Perfil — tela de manutenção. O sucesso dela é a pessoa achar o que veio buscar e sair.
 *
 * A seção de Notificações **sobe para o topo enquanto o push está desligado**: é a ação com maior
 * consequência econômica do produto (sem token, todo lembrete vira template pago do WhatsApp).
 */
export default function ProfileScreen() {
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
    <Screen grouped onRefresh={() => { push.refetch(); plan.refetch(); }} refreshing={push.isRefetching}>
      <Stack.Screen options={{ title: 'Perfil', headerLargeTitle: true }} />

      <Section title="Conta">
        <Row title="WhatsApp" subtitle="o número é a chave de tudo" icon="phone" chevron={false}
          trailing={<ThemedText type="small" themeColor="textSecondary" selectable>{phone}</ThemedText>} />
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

      {/* Push desligado sobe para cima: é a ação de maior consequência da tela. */}
      {!pushOn ? notifications : null}

      <Section title="Dados">
        <Row title="Lixeira de notas" icon="trash" onPress={() => router.push('/notes/trash')} />
        <Row title="Regras de categoria" icon="wand.and.stars" onPress={() => router.push('/finance/rules')} />
        <Row title="Importar extrato" icon="square.and.arrow.down" onPress={() => router.push('/import')} />
        <Row title="Importações" subtitle="histórico e revisões pendentes" icon="clock.arrow.circlepath" onPress={() => router.push('/import-history')} />
        <Row title="Atividade da IA" icon="sparkles" onPress={() => router.push('/ai-activity')} />
      </Section>

      {pushOn ? notifications : null}

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
  footer: {
    alignItems: 'center',
    paddingVertical: Space.xl,
  },
});
