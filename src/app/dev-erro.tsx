import { useState } from 'react';
import { Redirect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { relatarErro } from '@/lib/relatar-erro';

/**
 * Dispara um erro de propósito para provar o caminho app → painel de observabilidade (QA).
 * Só existe em desenvolvimento, e só relata com `EXPO_PUBLIC_RELATAR_ERROS_EM_DEV=1`.
 */
export default function DevErroScreen() {
  const [quebrar, setQuebrar] = useState(false);
  if (!__DEV__) return <Redirect href="/" />;
  if (quebrar) throw new Error('Erro de render de teste (dev)');

  return (
    <Screen grouped>
      <ThemedText type="small" themeColor="textSecondary">
        Erros de teste para o painel. Com EXPO_PUBLIC_RELATAR_ERROS_EM_DEV=1 eles chegam lá.
      </ThemedText>
      <Button label="Erro tratado" block onPress={() => relatarErro(new Error('Erro tratado de teste (dev)'), 'error')} />
      <Button
        label="Promessa rejeitada"
        variant="secondary"
        block
        onPress={() => {
          void Promise.reject(new Error('Promessa rejeitada de teste (dev)'));
        }}
      />
      <Button label="Erro de render" variant="secondary" block onPress={() => setQuebrar(true)} />
      <Button
        label="Crash"
        variant="secondary"
        block
        onPress={() => {
          setTimeout(() => {
            throw new Error('Crash de teste (dev)');
          }, 0);
        }}
      />
    </Screen>
  );
}
