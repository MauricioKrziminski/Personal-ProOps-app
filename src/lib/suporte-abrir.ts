import * as Application from 'expo-application';
import { Linking, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { mailtoSuporte } from '@/lib/suporte';

/** Abre o e-mail do suporte já com o contexto. Sem app de e-mail, não faz nada (o endereço está na Ajuda). */
export async function abrirSuporte(detalhe?: string | null) {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const url = mailtoSuporte({
    versao: Application.nativeApplicationVersion,
    build: Application.nativeBuildVersion,
    plataforma: Platform.OS,
    userId: data.session?.user.id ?? null,
    detalhe,
  });
  await Linking.openURL(url).catch(() => {});
}
