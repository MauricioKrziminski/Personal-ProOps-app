import { useState } from 'react';

import { Row, Section } from '@/components/ui/row';
import { Interruptor } from '@/components/ui/switch-row';
import { useToast } from '@/components/ui/toast';
import { useConsentimento, useDefinirConsentimentoIa } from '@/hooks/use-consentimento';
import { AgentApiError } from '@/lib/agent-api';
import { baixarMeusDados } from '@/lib/exportar-dados';
import { abrirLegal, URL_PRIVACIDADE, URL_TERMOS } from '@/lib/links-legais';

/** Perfil → Privacidade e dados: a chave de IA, o JSON dos dados da pessoa e os textos legais. */
export function PrivacidadeSection() {
  const toast = useToast();
  const consentimento = useConsentimento();
  const definir = useDefinirConsentimentoIa();
  const [baixando, setBaixando] = useState(false);

  const trocarIa = (ligar: boolean) =>
    definir.mutate(ligar, {
      onSuccess: () => toast({ message: ligar ? 'IA autorizada.' : 'IA desligada.', tone: 'success' }),
      onError: () => toast({ message: 'Não deu para mudar agora.', tone: 'error' }),
    });

  const baixar = async () => {
    setBaixando(true);
    try {
      if (!(await baixarMeusDados())) toast({ message: 'Este aparelho não consegue compartilhar arquivos.', tone: 'error' });
    } catch (e) {
      toast({
        message: e instanceof AgentApiError && e.status === 429
          ? 'Muitos pedidos. Tente de novo em uma hora.'
          : 'Não deu para gerar seus dados agora.',
        tone: 'error',
      });
    } finally {
      setBaixando(false);
    }
  };

  return (
    <Section heading="block" title="Privacidade e dados">
      <Row
        title="Autorizar o uso de IA"
        icon="wand.and.stars"
        trailing={
          <Interruptor
            value={!!consentimento.data?.ai_consent_at}
            onValueChange={trocarIa}
            disabled={!consentimento.data || definir.isPending}
            accessibilityLabel="Autorizar o uso de IA"
          />
        }
      />
      <Row title="Baixar meus dados" icon="square.and.arrow.down" onPress={baixando ? undefined : () => { void baixar(); }} />
      <Row title="Termos de Uso" icon="doc.text" onPress={() => abrirLegal(URL_TERMOS)} />
      <Row title="Política de Privacidade" icon="lock" onPress={() => abrirLegal(URL_PRIVACIDADE)} />
    </Section>
  );
}
