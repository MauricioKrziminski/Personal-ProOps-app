// Alias de propósito: o bloqueio mora na RAIZ (sempre em foco), como o portão de `use-acesso`.
import { useQuery as useQueryDaRaiz } from '@tanstack/react-query';
import * as Application from 'expo-application';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useAgora } from '@/hooks/use-agora';
import { usePreferencia } from '@/hooks/use-preferencia';
import { supabase } from '@/lib/supabase';
import {
  avisoNoPrazo,
  avisoVisivel,
  decisaoDeVersao,
  type AppConfig,
  type AvisoDoApp,
  type DecisaoDeVersao,
  type Plataforma,
} from '@/lib/app-config';

const plataforma = (Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web') as Plataforma;

/** `app_config` (linha 1), lido na abertura. Qualquer falha vira `null`: o app segue. */
export function useAppConfig() {
  return useQueryDaRaiz({
    queryKey: ['app-config'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<AppConfig | null> => {
      try {
        const { data, error } = await supabase.from('app_config').select('id, min_version_ios, min_version_android, latest_version_ios, latest_version_android, store_url_ios, store_url_android, notice_title, notice_body, notice_level, notice_until, updated_at').eq('id', 1).maybeSingle();
        return error ? null : (data as AppConfig | null);
      } catch {
        return null;
      }
    },
  });
}

/** A decisão de versão desta instalação (nativa, não a do OTA). */
export function useDecisaoDeVersao(): DecisaoDeVersao {
  const { data } = useAppConfig();
  return decisaoDeVersao(data, plataforma, Application.nativeApplicationVersion);
}

const texto = (v: unknown): v is string => typeof v === 'string';

/** As faixas do topo da Hoje: o aviso do dono e, se houver, "versão nova". Cada uma dispensa a sua. */
export function useFaixas(): {
  aviso: AvisoDoApp | null;
  versao: { ultima: string; url: string | null } | null;
  dispensarAviso: () => void;
  dispensarVersao: () => void;
} {
  const { data } = useAppConfig();
  const agora = useAgora();
  const [avisoFechado, fecharAviso] = usePreferencia('aviso-fechado', '', texto);
  const [versaoFechada, fecharVersao] = usePreferencia('versao-fechada', '', texto);
  const aviso = avisoVisivel(avisoNoPrazo(data, agora), avisoFechado);
  const d = decisaoDeVersao(data, plataforma, Application.nativeApplicationVersion);
  const versao = d.tipo === 'aviso' && d.ultima && d.ultima !== versaoFechada ? { ultima: d.ultima, url: d.url } : null;
  return {
    aviso,
    versao,
    dispensarAviso: () => aviso && fecharAviso(aviso.chave),
    dispensarVersao: () => versao && fecharVersao(versao.ultima),
  };
}

/** Uma vez por abertura com sessão: grava versão e plataforma (`app_ping`). Sem bloquear, sem erro na tela. */
export function useAppPing(userId: string | undefined) {
  useEffect(() => {
    const versao = Application.nativeApplicationVersion;
    if (!userId || !versao) return;
    void Promise.resolve(supabase.rpc('app_ping', { p_version: versao, p_platform: plataforma })).catch(() => {});
  }, [userId]);
}
