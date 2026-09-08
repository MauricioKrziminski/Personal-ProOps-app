import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { MAX_TITLE_LENGTH, canSaveTitle } from '@/lib/agent-chat';

interface Props {
  visible: boolean;
  initialTitle: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (title: string) => void;
}

/**
 * Renomear uma conversa.
 *
 * `formSheet` e não modal: é uma escolha curta, um campo só — a régua de
 * `design.md` §8 ("tarefa com etapas → modal; escolha curta → sheet").
 *
 * O contador só aparece perto do limite. Mostrar "3/80" desde a primeira letra
 * transforma um campo livre num formulário com cota, e o número que importa é o
 * que avisa que vai faltar espaço.
 */
export function RenameConversationSheet({
  visible,
  initialTitle,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const theme = useTheme();
  // Estado local simples, semeado uma vez. Quem garante que ele não fica com o
  // texto da conversa ANTERIOR é o `key` no chamador, que REMONTA o componente:
  // sincronizar por efeito daria o mesmo resultado com um render em cascata a
  // mais — e o lint reprova, com razão.
  const [titulo, setTitulo] = useState(initialTitle);

  const restantes = MAX_TITLE_LENGTH - titulo.trim().length;
  const podeSalvar = canSaveTitle(titulo) && !saving;

  return (
    <Sheet visible={visible} onClose={onClose}>
      {/*
        Cabeçalho Cancelar · título · Salvar, igual ao sheet de nome do Perfil.
        No Android o `Sheet` é um `Modal` de tela CHEIA (está escrito lá dentro):
        sem esse cabeçalho e sem calha lateral, o título nascia colado na borda
        esquerda e a ação primária ficava perdida no meio do corpo — foi o que a
        conferência no emulador mostrou.
      */}
      <View style={styles.cabecalho}>
        <Button label="Cancelar" variant="ghost" size="sm" onPress={onClose} />
        <ThemedText type="smallBold">Renomear conversa</ThemedText>
        <Button
          label="Salvar"
          size="sm"
          onPress={() => onSave(titulo.trim())}
          disabled={!podeSalvar}
          loading={saving}
        />
      </View>

      <View style={styles.corpo}>
        <TextField
          value={titulo}
          onChangeText={setTitulo}
          placeholder="Contas do mês"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => podeSalvar && onSave(titulo.trim())}
          invalid={titulo.length > 0 && !canSaveTitle(titulo)}
          accessibilityLabel="Nome da conversa"
          maxLength={MAX_TITLE_LENGTH}
        />

        {restantes <= 20 ? (
          <ThemedText
            type="caption"
            style={[tabular, { color: restantes < 0 ? theme.danger : theme.textSecondary }]}>
            {restantes} caracteres restantes
          </ThemedText>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  corpo: { gap: Space.md, paddingHorizontal: Space.lg },
});
