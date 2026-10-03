import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ErrorCard } from '@/components/error-card';
import { CategoriaSheet } from '@/components/finance/categoria-sheet';
import { SubcategoryManager } from '@/components/finance/subcategory-manager';
import { transicaoDeLayout } from '@/components/motion/transicao';
import { ThemedText } from '@/components/themed-text';
import { Deslizavel } from '@/components/ui/deslizavel';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { VerMais } from '@/components/ui/ver-mais';
import { Motion, Space } from '@/design/tokens';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { useApagarCategoria, useCategoriesUsed } from '@/hooks/use-finance';
import { aparenciaDaCategoria, type Categoria } from '@/lib/categorias';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';

const lancamentos = (n: number) => `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`;

/**
 * Categorias (spec 2026-09-29, Parte 4): criar, dar ícone e cor, renomear, juntar e apagar.
 *
 * A categoria continua sendo o TEXTO do registro; o que esta tela grava é a aparência de um nome
 * e, ao renomear ou apagar, o texto de todos os registros que o usam (`rename_category`,
 * `delete_category`). Aparece toda categoria EM USO — inclusive a que nasceu no WhatsApp e nunca
 * foi personalizada — e as criadas aqui que ainda não têm lançamento, na ordem de uso.
 */
export default function CategoriesScreen() {
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useCategoriesUsed();
  const apagar = useApagarCategoria();
  // `undefined` = fechada; `null` = nova.
  const [aberta, setAberta] = useState<Categoria | null | undefined>(undefined);
  const [detalhes, setDetalhes] = useState<string | null>(null);

  const lista = isError ? [] : (data ?? []);
  const itens = useAosPoucos(lista);

  const pedirApagar = (c: Categoria) =>
    confirmDestructive(
      `Apagar a categoria ${c.category}?`,
      'Apagar',
      () =>
        void apagar.mutateAsync(c.category).then(
          () => toast({ message: `Categoria ${c.category} apagada.`, tone: 'success' }),
          (e: unknown) => toast({ message: financeErrorMessage(e, 'Não deu para apagar a categoria.'), tone: 'error' })
        ),
      `${c.uses} ${c.uses === 1 ? 'lançamento fica' : 'lançamentos ficam'} sem categoria` +
        `${c.budgets ? ` e ${c.budgets} ${c.budgets === 1 ? 'orçamento sai' : 'orçamentos saem'}` : ''}.`
    );

  const acoesDe = (c: Categoria): ItemAction[] => [
    { label: 'Detalhes', icon: 'list.bullet', onPress: () => setDetalhes(c.category) },
    { label: 'Editar', icon: 'pencil', arrasto: 'direita', onPress: () => setAberta(c) },
    { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => pedirApagar(c) },
  ];

  return (
    <Screen grouped onRefresh={refetch}>
      <Stack.Screen options={{ title: 'Categorias' }} />
      <HeaderActions actions={[{ label: 'Nova categoria', icon: 'plus', onPress: () => setAberta(null) }]} />

      {isError ? <ErrorCard onRetry={refetch} /> : null}
      {isLoading && !isError ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {lista.length > 0 ? (
        <View style={styles.lista}>
          <View style={styles.faixa}>
            <ThemedText type="small" themeColor="textSecondary">
              Toque para organizar detalhes ou editar a categoria. Renomear também muda os lançamentos e orçamentos.
            </ThemedText>
          </View>
          <Section title="Suas categorias">
            {itens.visiveis.map((c, index) => {
              const a = aparenciaDaCategoria(c.category, lista);
              return (
                <Animated.View
                  key={c.category}
                  layout={transicaoDeLayout}
                  entering={FadeInDown.duration(Motion.duration.slow).delay(
                    Math.min(index * Motion.stagger.step, Motion.stagger.cap)
                  )}>
                  <Deslizavel titulo={c.category} acoes={acoesDe(c)}>
                    <Row
                      title={c.category}
                      subtitle={lancamentos(c.uses)}
                      icon={a.icon}
                      tinta={a.cor}
                      chevron={false}
                      onPress={() => showItemActions(c.category, acoesDe(c))}
                      onLongPress={() => showItemActions(c.category, acoesDe(c))}
                    />
                  </Deslizavel>
                </Animated.View>
              );
            })}
          </Section>
          <VerMais restantes={itens.restantes} onPress={itens.verMais} />
        </View>
      ) : null}

      {!isLoading && !isError && lista.length === 0 ? (
        <EmptyState
          icon="tag"
          title="Nenhuma categoria ainda"
          hint="Crie uma, ou lance um gasto com categoria."
          action={{ label: 'Nova categoria', onPress: () => setAberta(null) }}
        />
      ) : null}

      <CategoriaSheet
        visible={aberta !== undefined}
        categoria={aberta ?? null}
        onClose={() => setAberta(undefined)}
        onSalva={() => {}}
      />
      <SubcategoryManager visible={detalhes !== null} parent={detalhes ?? ''}
        onClose={() => setDetalhes(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lista: { gap: Space.md },
  faixa: { paddingHorizontal: Space.lg },
});
