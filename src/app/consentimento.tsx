import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthScreen } from '@/components/auth/auth-screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { Interruptor } from '@/components/ui/switch-row';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useAceitarTermos, useConsentimento } from '@/hooks/use-consentimento';
import { abrirLegal, URL_PRIVACIDADE, URL_TERMOS } from '@/lib/links-legais';
import { supabase } from '@/lib/supabase';
import { IA_PADRAO } from '@/lib/termos';

/**
 * Termos novos (ou nunca aceitos): a pessoa aceita ANTES do onboarding. A IA é um consentimento
 * à parte e nasce DESLIGADA; sem ela o assistente fica desligado e se liga em Perfil → Privacidade
 * e dados. A tela some sozinha quando `accept_terms` grava a versão (`_layout.tsx`, porta de mão única).
 *
 * A moldura é a das telas de conta (`AuthScreen` sem a capa: a conta já está aberta), com o aceite
 * dos Termos na frase do rodapé, como no cadastro, e o botão no fim (12/10/2026: a versão em lista
 * de linhas, com dois parágrafos sob a chave, foi recusada no iPhone).
 */
export default function ConsentimentoScreen() {
  const toast = useToast();
  const aceitar = useAceitarTermos();
  // Termos novos não podem revogar em silêncio a IA que a pessoa já tinha autorizado: o portão só
  // abre esta tela com o consentimento já lido, então o valor de partida é o gravado.
  const atual = useConsentimento().data?.ai_consent_at;
  const [ia, setIa] = useState(() => (atual ? true : IA_PADRAO));

  return (
    <AuthScreen
      showBrand={false}
      footer={
        <>
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.legal}>
            Ao continuar você aceita os{' '}
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.link} accessibilityRole="link" onPress={() => abrirLegal(URL_TERMOS)}>
              Termos de Uso
            </ThemedText>{' '}
            e a{' '}
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.link} accessibilityRole="link" onPress={() => abrirLegal(URL_PRIVACIDADE)}>
              Política de Privacidade
            </ThemedText>
            .
          </ThemedText>
          <Button
            label="Concordo e continuar"
            size="lg"
            block
            loading={aceitar.isPending}
            onPress={() =>
              aceitar.mutate(
                { ia },
                { onError: () => toast({ message: 'Não deu para salvar. Tente de novo.', tone: 'error' }) },
              )
            }
          />
          {/* Quem não concorda não fica preso: sai da conta. */}
          <Button
            label="Sair da conta"
            variant="ghost"
            block
            disabled={aceitar.isPending}
            onPress={() => {
              void supabase.auth.signOut().then(({ error }) => {
                if (error) toast({ message: 'Não foi possível sair agora.', tone: 'error' });
              });
            }}
          />
        </>
      }>
      <View style={styles.corpo}>
      <View style={styles.bloco}>
        <ThemedText type="title">Antes de começar</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Escolha se o assistente pode usar inteligência artificial.
        </ThemedText>
      </View>

      <View style={styles.bloco}>
        <Section>
          <Row
            title="Assistente com IA"
            subtitle={ia ? 'Responde no WhatsApp e no app' : 'Desligado. Você liga depois no Perfil'}
            icon="wand.and.stars"
            trailing={<Interruptor value={ia} onValueChange={setIa} accessibilityLabel="Autorizar o uso de IA" />}
          />
        </Section>
        <Note>
          Para responder, mensagens, áudios e extratos passam pela Anthropic, pelo Google e pela Groq,
          que não treinam modelos com eles.
        </Note>
      </View>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl },
  bloco: { gap: Space.md },
  legal: { textAlign: 'center' },
  link: { textDecorationLine: 'underline' },
});
