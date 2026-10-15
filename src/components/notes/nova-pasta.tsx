import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { actionSheet, FOLDER_ICONS, symbol } from '@/components/notes/note-actions';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Forte } from '@/components/ui/forte';
import { Icon } from '@/components/ui/icon';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useSaveFolder, type NoteFolder } from '@/hooks/use-notes';
import { useTheme } from '@/hooks/use-theme';
import { destinosDePasta, mensagemDoErroDePasta, nomeRepetidoEntreIrmas } from '@/lib/pastas';
import { normalizeFolderName } from '@/lib/search';

/**
 * Criar e renomear pasta, uma regra só — "Organizar pastas" e a folha "Nova pasta" chamam esta.
 *
 * Nome repetido (entre irmãs, na mesma mãe) é ERRO aqui (diferente do "Mover para", onde a nota vai para a pasta que já existe):
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
    // Sem `paiId` (editar sem mexer na mãe) vale a mãe que a pasta já tem.
    const paiDestino = entrada.paiId !== undefined ? entrada.paiId : (pastas.find((f) => f.id === entrada.id)?.parent_id ?? null);
    if (nomeRepetidoEntreIrmas(pastas, nome, paiDestino, entrada.id)) return { erro: repetida };
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
      toast({ message: mensagemDoErroDePasta(e, 'Não deu para salvar a pasta.'), tone: 'error' });
      return {};
    }
  };
  return { salvar, salvando: saveFolder.isPending };
}

/**
 * Mover uma pasta para dentro de outra, ou para a raiz — UMA regra para Organizar pastas, a tela da
 * pasta e o menu do ladrilho (25/09/2026: só existia na árvore, e o "Renomear e mover" de dentro da
 * pasta abria uma folha que não movia nada). Falhando, diz — antes a falha era muda.
 */
export function useMoverPasta(pastas: NoteFolder[]) {
  const saveFolder = useSaveFolder();
  const toast = useToast();
  return (folder: NoteFolder) => {
    const destinos = destinosDePasta(pastas, folder);
    actionSheet(
      {
        title: `Mover a pasta ${folder.name} para`,
        options: ['Raiz (nenhuma pasta)', ...destinos.map((f) => f.caminho)],
      },
      (index) => {
        if (index === undefined) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        saveFolder.mutate(
          { id: folder.id, name: folder.name, icon: folder.icon, parentId: index === 0 ? null : destinos[index - 1].id },
          { onError: (e) => toast({ message: mensagemDoErroDePasta(e, 'Não deu para mover a pasta.'), tone: 'error' }) },
        );
      },
    );
  };
}

/**
 * Soltar o ladrilho de uma pasta sobre outra (grade de pastas): move para dentro dela, pela mesma
 * escrita do "Mover para". Sucesso traz "Desfazer" (devolve a mãe de antes); o erro do banco
 * (ciclo, 5 níveis, nome repetido na mãe) vira toast com a frase.
 */
export function useSoltarPastaDentro() {
  const saveFolder = useSaveFolder();
  const toast = useToast();
  return (arrastada: NoteFolder, alvo: NoteFolder) => {
    const mover = (paiId: string | null) =>
      saveFolder.mutateAsync({ id: arrastada.id, name: arrastada.name, icon: arrastada.icon, parentId: paiId });
    mover(alvo.id).then(
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({
          message: <>Movida para <Forte>{alvo.name}</Forte></>,
          tone: 'success',
          action: {
            label: 'Desfazer',
            onPress: () =>
              mover(arrastada.parent_id).catch((e) =>
                toast({ message: mensagemDoErroDePasta(e, 'Não deu para desfazer.'), tone: 'error' })
              ),
          },
        });
      },
      (e) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toast({ message: mensagemDoErroDePasta(e, 'Não deu para mover a pasta.'), tone: 'error' });
      }
    );
  };
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
 * A folha da pasta: CRIAR e RENOMEAR são o mesmo formulário (25/09/2026). Criar mora onde a pessoa
 * está — o "…" de Notas e o menu de uma pasta (`paiId` faz dela subpasta) —, e renomear/trocar o
 * ícone abre esta mesma folha com `pasta`. Organizar pastas deixou de criar: tinha um editor
 * próprio no topo que repetia este.
 *
 * Com `pasta`, o nome, o ícone e o "Dentro de" nascem dela; trocar o "Dentro de" MOVE a pasta. Quem abre para editar troca a `key` ao trocar de pasta, para os campos nascerem
 * de novo.
 */
export function NovaPastaSheet({
  visible,
  onClose,
  pastas,
  paiId,
  pasta,
}: {
  visible: boolean;
  onClose: () => void;
  pastas: NoteFolder[];
  paiId?: string;
  pasta?: NoteFolder | null;
}) {
  const toast = useToast();
  const { salvar, salvando } = useSalvarPasta(pastas);
  const [nome, setNome] = useState(pasta?.name ?? '');
  const [icone, setIcone] = useState(pasta?.icon ?? 'folder');
  const [erro, setErro] = useState<ReactNode>(null);
  // `undefined` = a pessoa não mexeu: vale `paiId` (criar) ou a mãe da pasta (editar).
  const [paiEscolhido, setPaiEscolhido] = useState<string | null | undefined>(undefined);
  const paiAtual = paiEscolhido !== undefined ? paiEscolhido : pasta ? pasta.parent_id : (paiId ?? null);
  const opcoesDeMae: SelectOption[] = [
    { id: null, label: 'Nenhuma (raiz)', icon: 'tray', neutral: true },
    ...destinosDePasta(pastas, pasta).map((d) => ({
      id: d.id,
      label: d.caminho,
      icon: symbol(d.icon),
    })),
  ];

  const fechar = () => {
    setPaiEscolhido(undefined);
    setNome('');
    setIcone('folder');
    setErro(null);
    onClose();
  };

  const criar = async () => {
    // Editando, só escreve `parent_id` se a pessoa trocou o "Dentro de" (aí a pasta MOVE).
    const moveu = !!pasta && paiAtual !== pasta.parent_id;
    const r = await salvar({ id: pasta?.id, nome, icone, paiId: pasta && !moveu ? undefined : paiAtual });
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    if (!r.id) return;
    toast({
      message: <>Pasta <Forte>{normalizeFolderName(nome)}</Forte> {pasta ? 'salva' : 'criada'}.</>,
      tone: 'success',
    });
    fechar();
  };

  return (
    <Sheet visible={visible} onClose={fechar}>
      <TaskHeader
        title={pasta ? 'Editar pasta' : paiAtual ? 'Nova subpasta' : 'Nova pasta'}
        onClose={fechar}
        action={<Button label={pasta ? 'Salvar' : 'Criar'} size="sm" loading={salvando} onPress={() => void criar()} />}
      />
      <SheetScroll contentContainerStyle={styles.corpo}>
        <Field label="Nome" obrigatorio error={erro ?? undefined}>
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
        <Field label="Dentro de">
          <SelectField
            options={opcoesDeMae}
            value={paiAtual}
            onChange={(id) => {
              setPaiEscolhido(id);
              setErro(null);
            }}
          />
        </Field>
        <Field label="Ícone">
          <GradeDeIcones valor={icone} onChange={setIcone} />
        </Field>
      </SheetScroll>
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
