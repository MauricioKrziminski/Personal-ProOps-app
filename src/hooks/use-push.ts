import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { notifications } from '@/lib/push-module';
import { supabase } from '@/lib/supabase';

/**
 * Registro de push.
 *
 * Antes isto era `useState` + `useEffect` cru dentro de `profile.tsx`, fora do padrão do projeto,
 * e o fetch **ignorava o erro** (`.then(({ data }) => ...)`) — falha de rede virava "push
 * desativado" em silêncio.
 *
 * Por que importa tanto: sem `expo_push_token`, **todo** lembrete e **todo** alerta sai por
 * template PAGO do WhatsApp. A partir de 01/10/2026 nem a janela de 24h é grátis.
 */

export type PushBlocker =
  | 'ok'
  | 'expo-go'
  | 'simulator'
  | 'denied'
  | 'no-eas-project'
  | 'unknown';

export interface PushStatus {
  registered: boolean;
  blocker: PushBlocker;
}

function easProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

export function usePushStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ['push', userId],
    enabled: !!userId,
    queryFn: async (): Promise<PushStatus> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('expo_push_token')
        .eq('id', userId!)
        .single();
      // O erro sobe: "não consegui verificar" é uma resposta diferente de "está desligado".
      if (error) throw error;

      if (data?.expo_push_token) return { registered: true, blocker: 'ok' };
      // Expo Go do Android nem carrega o `expo-notifications` (ver `push-module.ts`).
      if (!notifications) return { registered: false, blocker: 'expo-go' };
      if (!Device.isDevice) return { registered: false, blocker: 'simulator' };
      if (!easProjectId()) return { registered: false, blocker: 'no-eas-project' };

      const perm = await notifications.getPermissionsAsync();
      return {
        registered: false,
        blocker: perm.status === 'denied' ? 'denied' : 'ok',
      };
    },
  });
}

export function useRegisterPush(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('sem sessão');
      if (!notifications) {
        throw new Error('Push não funciona no Expo Go do Android — precisa de um development build.');
      }
      if (!Device.isDevice) {
        throw new Error('Push só funciona em aparelho físico, não no simulador.');
      }
      const { status } = await notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Permissão negada. Dá para liberar nos Ajustes do sistema.');
      }
      const projectId = easProjectId();
      // Sem projectId, `getExpoPushTokenAsync` falha com "Project ID not found" — mensagem que
      // não diz o que fazer. Ver docs/PENDENCIAS.md: falta rodar `eas init`.
      if (!projectId) {
        throw new Error('App ainda não vinculado ao EAS (falta extra.eas.projectId no app.json).');
      }
      const token = (await notifications.getExpoPushTokenAsync({ projectId })).data;
      const { error } = await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', userId);
      if (error) throw error;
      return token;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['push'] }),
  });
}

export interface AlertPreferences {
  push: boolean;
  whatsapp: boolean;
}

export type AlertPreferenceChannel = keyof AlertPreferences;

/** Preferências de avisos automáticos; token e telefone ficam fora deste contrato. */
export function useAlertPreferences(userId: string | undefined) {
  return useQuery({
    queryKey: ['alert-preferences', userId],
    enabled: !!userId,
    queryFn: async (): Promise<AlertPreferences> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('alerts_push_enabled, alerts_whatsapp_enabled')
        .eq('id', userId!)
        .single();
      if (error) throw error;
      return {
        push: data?.alerts_push_enabled ?? false,
        whatsapp: data?.alerts_whatsapp_enabled ?? false,
      };
    },
  });
}

export function useSetAlertPreference(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      channel,
      enabled,
    }: {
      channel: AlertPreferenceChannel;
      enabled: boolean;
    }) => {
      if (!userId) throw new Error('Sem sessão.');
      const patch =
        channel === 'push'
          ? { alerts_push_enabled: enabled }
          : { alerts_whatsapp_enabled: enabled };
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['alert-preferences'] }),
  });
}

/** Mensagem por causa — "desativado" genérico não diz o que fazer. */
export function pushBlockerMessage(blocker: PushBlocker): string | null {
  switch (blocker) {
    case 'expo-go':
      return 'O Expo Go do Android não suporta push — precisa de um development build.';
    case 'simulator':
      return 'Push não funciona no simulador — precisa de um aparelho físico.';
    case 'denied':
      return 'Você negou a permissão. Libere em Ajustes › Notificações.';
    case 'no-eas-project':
      return 'O app ainda não foi vinculado ao EAS (`eas init`).';
    default:
      return null;
  }
}
