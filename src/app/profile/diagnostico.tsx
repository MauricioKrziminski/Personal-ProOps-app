/**
 * A trilha da abertura (`lib/trilha-da-abertura.ts`), para ler e mandar depois de uma cortina presa.
 *
 * ponytail: diagnóstico temporário — sai junto com a trilha.
 */
import { useCallback, useEffect, useState } from 'react';
import { Share } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ButtonRow } from '@/components/ui/button-row';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { tabular } from '@/design/tokens';
import { formatarTrilha, lerTrilha, limparTrilha } from '@/lib/trilha-da-abertura';

export default function DiagnosticoDaAbertura() {
  const [texto, setTexto] = useState<string | null>(null);
  const ler = useCallback(() => {
    void lerTrilha().then((linhas) => setTexto(formatarTrilha(linhas)));
  }, []);
  useEffect(ler, [ler]);

  return (
    <Screen onRefresh={ler}>
      <ButtonRow>
        <Button
          label="Compartilhar"
          icon="square.and.arrow.up"
          disabled={!texto}
          onPress={() => void Share.share({ message: texto ?? '' })}
        />
        <Button
          label="Limpar"
          variant="secondary"
          onPress={() => void limparTrilha().then(ler)}
        />
      </ButtonRow>
      <Card>
        <ThemedText type="footnote" selectable style={tabular}>
          {texto === null ? 'Lendo…' : texto || 'Nada gravado ainda.'}
        </ThemedText>
      </Card>
    </Screen>
  );
}
