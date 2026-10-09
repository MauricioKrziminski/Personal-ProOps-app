import { useState } from 'react';

import { useCortina } from '@/components/motion/session-curtain';
import { useToast } from '@/components/ui/toast';
import { identificar } from '@/lib/compras';
import { confirmDestructive } from '@/lib/item-actions';
import { ondaDaTroca } from '@/lib/session-gate';
import { supabase } from '@/lib/supabase';

/**
 * Apagar a conta (exigência da App Store e do Google Play). `delete_my_account` apaga TUDO no
 * servidor — inclusive a sessão —, então o `signOut` que vem depois só limpa o aparelho e o erro
 * de "sessão não existe" é esperado, não falha.
 *
 * ⚠️ A assinatura da loja NÃO é cancelada daqui: a confirmação diz isso com todas as letras.
 */
export function useApagarConta() {
  const cortina = useCortina();
  const toast = useToast();
  const [apagando, setApagando] = useState(false);

  const apagar = () => {
    cortina.preparar();
    confirmDestructive(
      'Apagar a conta?',
      'Apagar conta',
      async () => {
        setApagando(true);
        const { error } = await supabase.rpc('delete_my_account');
        if (error) {
          setApagando(false);
          toast({ message: 'Não foi possível apagar a conta agora. Tente de novo.', tone: 'error' });
          return;
        }
        void cortina.cobrir(ondaDaTroca(null, null));
        await identificar(null);
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      },
      'Todos os seus dados serão apagados e isso não tem volta. Sua assinatura na loja NÃO é cancelada automaticamente: cancele na App Store ou no Google Play para não ser cobrado.',
    );
  };

  return { apagar, apagando };
}
