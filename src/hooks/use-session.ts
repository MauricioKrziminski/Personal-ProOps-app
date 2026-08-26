import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // convite feito para o telefone de quem entrou vira acesso na hora do login.
    // Best-effort: falhar aqui não pode impedir de usar o app.
    const aceitarConvites = () => {
      supabase.rpc('accept_pending_invites').then(({ error }) => {
        if (error) console.warn('accept_pending_invites:', error.message);
      });
    };

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) aceitarConvites();
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_IN' && next) aceitarConvites();
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
