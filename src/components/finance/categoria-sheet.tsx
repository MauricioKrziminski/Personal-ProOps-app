import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { GradeDeCores } from '@/components/notes/color-picker';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Forte } from '@/components/ui/forte';
import { Icon, type IconName } from '@/components/ui/icon';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import type { NoteColorName } from '@/constants/theme';
import { noteInk } from '@/design/note-colors';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useCategoriesUsed, useSalvarCategoria } from '@/hooks/use-finance';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { foldCategory } from '@/lib/categories-merge';
import { aparenciaDaCategoria, ICONES_DE_CATEGORIA, nomeDaCategoria, ROTULO_DO_ICONE, type Categoria } from '@/lib/categorias';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * Criar ou editar uma categoria: nome, ícone e cor (spec 2026-09-29, Parte 4). Usada pela tela
 * Categorias e pelo "+ Nova" do seletor de categoria.
 *
 * A cor entra INLINE (`GradeDeCores`): esta folha já é um `Modal`, e abrir o `ColorPicker` aqui
 * seria folha dentro de folha — no Android ela abre no lugar errado.
 *
 * Renomear para um nome que já é outra categoria (sem acento e sem caixa) é JUNTAR as duas, e a
 * folha pergunta antes: o banco recusa com `CATEGORIA_EXISTE` e só junta com a resposta.
 */
export function CategoriaSheet({
  visible,
  categoria,
  onClose,
  onSalva,
}: {
  visible: boolean;
  /** `null` = nova. */
  categoria: Categoria | null;
  onClose: () => void;
  /** O nome que ficou (o da que recebe, se juntou) — o seletor o escolhe. */
  onSalva: (nome: string) => void;
}) {
  const toast = useToast();
  const usadas = useCategoriesUsed().data ?? [];
  const salvarCategoria = useSalvarCategoria();
  const inicial = (c: Categoria | null) => ({
    nome: c?.category ?? '',
    icon: (c?.icon ?? (c ? aparenciaDaCategoria(c.category, usadas).icon : 'tag')) as IconName,
    cor: c?.color ?? null,
  });
  const [campos, setCampos] = useState(() => inicial(categoria));
  // Reaberta (para outra categoria, ou nova), a folha começa do que ELA é, não do que foi digitado
  // da última vez. Estado ajustado no render, o padrão do React para "resetar quando a prop muda".
  const [abertaPara, setAbertaPara] = useState<string | null>(visible ? (categoria?.category ?? '') : null);
  const chave = visible ? (categoria?.category ?? '') : null;
  if (chave !== abertaPara) {
    setAbertaPara(chave);
    if (chave !== null) setCampos(inicial(categoria));
  }
  const { nome, icon, cor } = campos;

  const limpo = nomeDaCategoria(nome);
  // Criando com um nome que já existe: salvar só muda a aparência DELA — a folha diz isso antes.
  const jaExiste = !categoria && limpo
    ? usadas.find((c) => foldCategory(c.category) === foldCategory(limpo))
    : undefined;
  const podeSalvar = limpo.length > 0 && limpo.length <= 40 && !salvarCategoria.isPending;

  const terminou = (nomeFinal: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSalva(nomeFinal);
    onClose();
  };

  const salvar = () =>
    salvarCategoria
      .mutateAsync({ name: jaExiste?.category ?? limpo, icon, color: cor, renomearDe: categoria?.category ?? null })
      .then(
        () => terminou(jaExiste?.category ?? limpo),
        (e: unknown) => {
          const erro = e as { code?: string; existente?: string };
          if (erro?.code === 'CATEGORIA_EXISTE' && erro.existente) {
            const alvo = erro.existente;
            const de = categoria?.category ?? limpo;
            const temOrcamento =
              (categoria?.budgets ?? 0) > 0 &&
              (usadas.find((c) => c.category === alvo)?.budgets ?? 0) > 0;
            // Diálogo nativo não tem negrito: a frase nomeia o tipo (design.md §3).
            confirmDestructive(
              `Juntar a categoria ${de} com ${alvo}?`,
              'Juntar',
              () =>
                void salvarCategoria
                  .mutateAsync({ name: alvo, icon, color: cor, renomearDe: de, juntar: true })
                  .then(
                    () => terminou(alvo),
                    (e2: unknown) => toast({ message: financeErrorMessage(e2, 'Não deu para juntar as categorias.'), tone: 'error' })
                  ),
              `Tudo que está em ${de} passa para ${alvo}.${temOrcamento ? ` No mês em que as duas têm orçamento, fica o de ${alvo}.` : ''}`
            );
            return;
          }
          toast({ message: financeErrorMessage(e, 'Não deu para salvar a categoria.'), tone: 'error' });
        }
      );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader
        title={categoria ? 'Editar categoria' : 'Nova categoria'}
        onClose={onClose}
        action={
          <Button
            label="Salvar"
            size="sm"
            loading={salvarCategoria.isPending}
            disabled={!podeSalvar}
            onPress={() => void salvar()}
          />
        }
      />
      <SheetScroll contentContainerStyle={styles.corpo} keyboardShouldPersistTaps="handled">
        <Field
          label="Nome"
          hint={
            jaExiste
              ? <>Essa categoria já existe: salvar muda o ícone e a cor de <Forte>{jaExiste.category}</Forte>.</>
              : undefined
          }>
          <TextField
            value={nome}
            onChangeText={(n) => setCampos((c) => ({ ...c, nome: n }))}
            placeholder="Ex.: viagem"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={!categoria}
            maxLength={40}
          />
        </Field>
        <Field label="Ícone">
          <GradeDeIcones valor={icon} cor={cor} onPick={(i) => setCampos((c) => ({ ...c, icon: i }))} />
        </Field>
        <Field label="Cor">
          <GradeDeCores value={cor} onPick={(k) => setCampos((c) => ({ ...c, cor: k }))} />
        </Field>
      </SheetScroll>
    </Sheet>
  );
}

function GradeDeIcones({
  valor,
  cor,
  onPick,
}: {
  valor: IconName;
  cor: NoteColorName | null;
  onPick: (icon: IconName) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const tinta = cor ? noteInk(cor, scheme) : null;
  return (
    <View style={styles.grade}>
      {ICONES_DE_CATEGORIA.map((i) => {
        const selecionado = i === valor;
        return (
          <Pressable
            key={String(i)}
            accessibilityRole="button"
            accessibilityLabel={ROTULO_DO_ICONE[String(i)] ?? String(i)}
            accessibilityState={{ selected: selecionado }}
            onPress={() => {
              Haptics.selectionAsync();
              onPick(i);
            }}
            style={({ pressed }) => [
              styles.icone,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: selecionado ? theme.text : 'transparent',
                opacity: pressed ? 0.6 : 1,
              },
            ]}>
            <Icon name={i} size="md" color="text" tint={selecionado && tinta ? tinta : undefined} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxl },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  icone: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
