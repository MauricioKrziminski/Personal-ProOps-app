import { Switch } from 'react-native';
import { router } from 'expo-router';

import { Row, Section } from '@/components/ui/row';
import { useToast } from '@/components/ui/toast';
import {
  pushBlockerMessage,
  useAlertPreferences,
  useRegisterPush,
  usePushStatus,
  useSetAlertPreference,
  type AlertPreferenceChannel,
} from '@/hooks/use-push';

interface AlertPreferencesSectionProps {
  userId: string | undefined;
  hasVerifiedPhone: boolean;
  showHistory?: boolean;
}

function pushSubtitle({
  failed,
  enabled,
  registered,
  blocker,
}: {
  failed: boolean;
  enabled: boolean;
  registered: boolean;
  blocker: string | null;
}): string {
  if (failed) return 'Não deu para verificar';
  // O estado ligado/desligado está no interruptor ao lado: o subtítulo só fala quando há algo a
  // resolver.
  if (enabled && registered) return '';
  if (enabled) return blocker ?? 'Este aparelho perdeu o token';
  if (registered) return '';
  return blocker ?? '';
}

function whatsappSubtitle({
  failed,
  hasVerifiedPhone,
}: {
  failed: boolean;
  hasVerifiedPhone: boolean;
}): string {
  if (failed) return 'Não deu para verificar';
  if (!hasVerifiedPhone) return 'Conecte o WhatsApp para ativar';
  return '';
}

/** Preferências dos avisos inferidos; lembretes pessoais continuam independentes. */
export function AlertPreferencesSection({
  userId,
  hasVerifiedPhone,
  showHistory = true,
}: AlertPreferencesSectionProps) {
  const toast = useToast();
  const push = usePushStatus(userId);
  const register = useRegisterPush(userId);
  const preferences = useAlertPreferences(userId);
  const setPreference = useSetAlertPreference(userId);

  const pushRegistered = push.data?.registered ?? false;
  const pushEnabled = preferences.data?.push ?? false;
  const whatsappEnabled = preferences.data?.whatsapp ?? false;
  const blocker = pushBlockerMessage(push.data?.blocker ?? 'unknown');

  const save = (channel: AlertPreferenceChannel, enabled: boolean) => {
    setPreference.mutate(
      { channel, enabled },
      {
        onSuccess: () =>
          toast({
            message: enabled ? 'Canal de avisos ativado.' : 'Canal de avisos desligado.',
            tone: 'success',
          }),
        onError: () => toast({ message: 'Não deu para salvar.', tone: 'error' }),
      },
    );
  };

  const changePush = (enabled: boolean) => {
    if (!enabled || pushRegistered) {
      save('push', enabled);
      return;
    }
    register.mutate(undefined, {
      onSuccess: () => save('push', true),
      onError: (error) =>
        toast({
          message: error instanceof Error ? error.message : 'Não deu para ativar a notificação.',
          tone: 'error',
        }),
    });
  };

  const busy = preferences.isLoading || setPreference.isPending;

  return (
    <Section title="Notificações">
      <Row
        title="Avisos financeiros no celular"
        subtitle={pushSubtitle({
          failed: preferences.isError || push.isError,
          enabled: pushEnabled,
          registered: pushRegistered,
          blocker,
        })}
        icon="bell.badge"
        chevron={false}
        trailing={
          <Switch
            value={pushEnabled}
            disabled={
              busy ||
              preferences.isError ||
              push.isLoading ||
              push.isError ||
              register.isPending ||
              (!pushEnabled && !pushRegistered && !!blocker)
            }
            accessibilityLabel="Receber avisos financeiros como notificação no celular"
            onValueChange={changePush}
          />
        }
      />
      <Row
        title="Avisos financeiros no WhatsApp"
        subtitle={whatsappSubtitle({
          failed: preferences.isError,
          hasVerifiedPhone,
        })}
        icon="bubble.left"
        chevron={false}
        trailing={
          <Switch
            value={whatsappEnabled}
            disabled={
              busy ||
              preferences.isError ||
              (!whatsappEnabled && !hasVerifiedPhone)
            }
            accessibilityLabel="Receber avisos financeiros pelo WhatsApp"
            onValueChange={(enabled) => save('whatsapp', enabled)}
          />
        }
      />
      {showHistory ? <Row
        title="Histórico de alertas"
        icon="clock.arrow.circlepath"
        onPress={() => router.push('/profile/alerts')}
      /> : null}
    </Section>
  );
}
