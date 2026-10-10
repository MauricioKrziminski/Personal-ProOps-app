import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Interruptor } from '@/components/ui/switch-row';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Space } from '@/design/tokens';
import { useAceitarTermos, useConsentimento } from '@/hooks/use-consentimento';
import { abrirLegal, URL_PRIVACIDADE, URL_TERMOS } from '@/lib/links-legais';
import { supabase } from '@/lib/supabase';
import { IA_PADRAO } from '@/lib/termos';

/**
 * Termos novos (ou nunca aceitos): a pessoa aceita ANTES do onboarding. A IA é um consentimento
 * à parte e nasce DESLIGADA; sem ela o assistente fica desligado e se liga em Perfil → Privacidade
 * e dados. A tela some sozinha quando `accept_terms` grava a versão (`_layout.tsx`, porta de mão única).
 */
export default function ConsentimentoScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const aceitar = useAceitarTermos();
  // Termos novos não podem revogar em silêncio a IA que a pessoa já tinha autorizado: o portão só
  // abre esta tela com o consentimento já lido, então o valor de partida é o gravado.
  const atual = useConsentimento().data?.ai_consent_at;
  const [ia, setIa] = useState(() => (atual ? true : IA_PADRAO));

  return (
    <Screen scroll={false} grouped>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.corpo, { paddingTop: insets.top + Space.xl, paddingBottom: insets.bottom + Space.xxl }]}
        showsVerticalScrollIndicator={false}>
        <ThemedText type="title">Antes de começar</ThemedText>

        <Section>
          <Row title="Termos de Uso" icon="doc.text" onPress={() => abrirLegal(URL_TERMOS)} />
          <Row title="Política de Privacidade" icon="lock" onPress={() => abrirLegal(URL_PRIVACIDADE)} />
        </Section>

        <Section title="Inteligência artificial">
          <Row
            title="Autorizar o uso de IA"
            icon="wand.and.stars"
            trailing={<Interruptor value={ia} onValueChange={setIa} accessibilityLabel="Autorizar o uso de IA" />}
          />
        </Section>
        <View style={styles.notas}>
          <Note>
            O assistente envia suas mensagens, áudios, linhas de extratos importados e o contexto financeiro
            necessário para responder à Anthropic (Claude), ao Google (Gemini) e à Groq (transcrição de áudio).
            Eles não treinam modelos com isso.
          </Note>
          <Note>Sem a autorização o assistente fica desligado. Você liga depois em Perfil → Privacidade e dados.</Note>
        </View>

        <Button
          label="Concordo e continuar"
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
        <Button label="Sair da conta" variant="ghost" onPress={() => {
            void supabase.auth.signOut().then(({ error }) => {
              if (error) toast({ message: 'Não foi possível sair agora.', tone: 'error' });
            });
          }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  corpo: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  notas: { gap: Space.md },
});
