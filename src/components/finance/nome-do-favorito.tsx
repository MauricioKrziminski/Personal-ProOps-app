import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Space } from '@/design/tokens';

/**
 * Pede o nome de um favorito (criar ou renomear). Hook que devolve a folha, como `useConfirmarBaixa`:
 * quem abre chama `pedir(padrao, aoConfirmar)` e desenha `folha` no fim. Vazio não confirma.
 */
export function useNomeDoFavorito() {
  const [pedido, setPedido] = useState<{ aoConfirmar: (nome: string) => void } | null>(null);
  const [nome, setNome] = useState('');
  const fechar = () => setPedido(null);
  const pedir = (padrao: string, aoConfirmar: (nome: string) => void) => {
    setNome(padrao.slice(0, 60));
    setPedido({ aoConfirmar });
  };
  const limpo = nome.trim();
  const folha = (
    <Sheet visible={pedido !== null} onClose={fechar}>
      <TaskHeader
        title="Nome do favorito"
        onClose={fechar}
        action={<Button label="Salvar" size="sm" disabled={!limpo} onPress={() => { const p = pedido; fechar(); p?.aoConfirmar(limpo); }} />}
      />
      <SheetScroll contentContainerStyle={styles.corpo}>
        <Field label="Nome" obrigatorio>
          <TextField value={nome} onChangeText={setNome} maxLength={60} autoFocus accessibilityLabel="Nome do favorito" placeholder="Ex.: Café da manhã" />
        </Field>
      </SheetScroll>
    </Sheet>
  );
  return { pedir, folha };
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
});
