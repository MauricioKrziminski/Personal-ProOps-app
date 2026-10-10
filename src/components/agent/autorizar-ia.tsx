import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/note';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useDefinirConsentimentoIa } from '@/hooks/use-consentimento';

/** Código do 403 que o agente devolve quando a IA está sem consentimento. */
export const IA_SEM_CONSENTIMENTO = 'ai_consent_required';

/**
 * O cartão do 403 `ai_consent_required` (chat e voz): liga o consentimento (`set_ai_consent(true)`)
 * e refaz o que a pessoa tentava.
 */
export function AutorizarIa({ aoAutorizar }: { aoAutorizar: () => void }) {
  const toast = useToast();
  const definir = useDefinirConsentimentoIa();
  return (
    <View style={styles.cartao}>
      <Note icon="exclamationmark.triangle" tone="warning">O assistente precisa da sua autorização para usar IA.</Note>
      <Button
        label="Autorizar o uso de IA"
        variant="secondary"
        size="sm"
        loading={definir.isPending}
        onPress={() =>
          definir.mutate(true, {
            onSuccess: aoAutorizar,
            onError: () => toast({ message: 'Não deu para autorizar. Tente de novo.', tone: 'error' }),
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({ cartao: { gap: Space.sm, alignItems: 'flex-start' } });
