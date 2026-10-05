import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/finance/chip';
import { Field } from '@/components/ui/field';
import { Space } from '@/design/tokens';
import { useFavoritos, type Favorito } from '@/hooks/use-favoritos';

/**
 * A fileira de favoritos do formulário de criação: até 6, os mais usados, e "Todos" abre a lista.
 * Tocar só PREENCHE (`aoUsar`); nunca grava. Sem favorito nenhum, não ocupa lugar.
 */
export function FavoritosDoLancamento({ aoUsar }: { aoUsar: (f: Favorito) => void }) {
  const favoritos = useFavoritos();
  const itens = (favoritos.data ?? []).slice(0, 6);
  if (itens.length === 0) return null;
  return (
    <Field label="Favoritos">
      <View style={styles.fileira}>
        {itens.map((f) => (
          <Chip key={f.id} label={f.name} icon="star" selected={false} onPress={() => aoUsar(f)} />
        ))}
        <Chip label="Todos" selected={false} onPress={() => router.push('/finance/favorites')} />
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  fileira: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
});
