import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { FOLDER_ICONS, symbol } from '@/components/notes/note-actions';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Forte } from '@/components/ui/forte';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useSaveFolder, type NoteFolder } from '@/hooks/use-notes';
import { useTheme } from '@/hooks/use-theme';
import { normalizeFolderName } from '@/lib/search';

/**
 * Criar e renomear pasta, uma regra só — "Organizar pastas" e a folha "Nova pasta" chamam esta.
 *
 * Nome repetido é ERRO aqui (diferente do "Mover para", onde a nota vai para a pasta que já existe):
 * o caminho de criação é `.upsert()`, que com nome repetido atualizaria a pasta existente em
 * silêncio. `23505` é outro aparelho criando a mesma pasta entre a checagem e o insert.
 */
export function useSalvarPasta(pastas: NoteFolder[]) {
  const saveFolder = useSaveFolder();
  const toast = useToast();
  const salvar = async (entrada: {
    id?: string;
    nome: string;
    icone: string;
    paiId?: string | null;
  }): Promise<{ id?: string; erro?: ReactNode }> => {
    const nome = normalizeFolderName(entrada.nome);
    if (!nome) return { erro: 'Dá um nome para a pasta.' };
    const repetida = <>Já existe uma pasta chamada <Forte>{nome}</Forte>.</>;
    if (pastas.some((f) => f.name === nome && f.id !== entrada.id)) return { erro: repetida };
    try {
      const id = await saveFolder.mutateAsync({
        id: entrada.id,
        name: nome,
        icon: entrada.icone,
        ...(entrada.paiId !== undefined ? { parentId: entrada.paiId } : {}),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { id };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return { erro: repetida };
      toast({ message: 'Não deu para salvar a pasta.', tone: 'error' });
      return {};
    }
  };
  return { salvar, salvando: saveFolder.isPending };
}

/**
 * A grade dos ícones de pasta: seis por linha, doze ícones, duas linhas exatas.
 *
 * ⚠️ Com `gap` + largura fixa a fileira embrulhava por largura e dava 7 em cima e 5 embaixo — lê
 * como acidente, não como grade. A célula em porcentagem fecha a conta em qualquer tela sem medir
 * nada; o respiro vem do padding dela.
 */
export function GradeDeIcones({ valor, onChange }: { valor: string; onChange: (icone: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.grade}>
      {FOLDER_ICONS.map((opcao) => {
        const escolhido = opcao.name === valor;
        return (
          <Pressable
            key={opcao.label}
            accessibilityRole="button"
            accessibilityLabel={opcao.label}
            accessibilityState={{ selected: escolhido }}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(opcao.name);
            }}
            style={styles.celula}>
            <View
              style={[
                styles.icone,
                { backgroundColor: escolhido ? theme.accentSoft : theme.backgroundElement },
              ]}>
              <Icon name={symbol(opcao.name)} size="lg" color={escolhido ? 'tint' : 'textSecondary'} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * "Nova pasta" onde a pessoa está (25/09/2026): *"se eu estou na tela de notas e quero criar pasta,
 * eu tenho que ter um botão de criar pasta"* — criar só existia dentro de "Organizar pastas".
 * `paiId` faz dela uma subpasta. Criada, a folha fecha e o aviso diz o nome.
 */
export function NovaPastaSheet({
  visible,
  onClose,
  pastas,
  paiId,
}: {
  visible: boolean;
  onClose: () => void;
  pastas: NoteFolder[];
  paiId?: string;
}) {
  const toast = useToast();
  const { salvar, salvando } = useSalvarPasta(pastas);
  const [nome, setNome] = useState('');
  const [icone, setIcone] = useState('folder');
  const [erro, setErro] = useState<ReactNode>(null);

  const fechar = () => {
    setNome('');
    setIcone('folder');
    setErro(null);
    onClose();
  };

  const criar = async () => {
    const r = await salvar({ nome, icone, paiId: paiId ?? null });
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    if (!r.id) return;
    toast({ message: <>Pasta <Forte>{normalizeFolderName(nome)}</Forte> criada.</>, tone: 'success' });
    fechar();
  };

  return (
    <Sheet visible={visible} onClose={fechar}>
      <TaskHeader
        title={paiId ? 'Nova subpasta' : 'Nova pasta'}
        onClose={fechar}
        action={<Button label="Criar" size="sm" loading={salvando} onPress={() => void criar()} />}
      />
      <ScrollView contentContainerStyle={styles.corpo} keyboardShouldPersistTaps="handled">
        <Field label="Nome" error={erro ?? undefined}>
          <TextField
            value={nome}
            onChangeText={(texto) => {
              setNome(texto);
              setErro(null);
            }}
            placeholder="Ex.: mercado"
            autoCapitalize="none"
            autoFocus
            maxLength={40}
            invalid={!!erro}
            accessibilityLabel="Nome da pasta"
            onSubmitEditing={() => void criar()}
          />
        </Field>
        <Field label="Ícone">
          <GradeDeIcones valor={icone} onChange={setIcone} />
        </Field>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  grade: { flexDirection: 'row', flexWrap: 'wrap' },
  celula: { width: '16.666%', padding: Space.xs / 2 },
  /** Ícone menor que a área de toque: o alvo é 44, o símbolo é 24. */
  icone: {
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
});
