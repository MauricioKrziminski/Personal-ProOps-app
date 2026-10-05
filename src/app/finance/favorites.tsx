import { useState } from 'react';
import { Stack, router } from 'expo-router';

import { ErrorCard } from '@/components/error-card';
import { useNomeDoFavorito } from '@/components/finance/nome-do-favorito';
import { Deslizavel } from '@/components/ui/deslizavel';
import { EmptyState } from '@/components/ui/empty-state';
import { Forte } from '@/components/ui/forte';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { NOME_REPETIDO, useApagarFavorito, useFavoritos, useSalvarFavorito, useUsouFavorito, type Favorito } from '@/hooks/use-favoritos';
import { useBRL } from '@/components/ui/conceal';
import { localISODate } from '@/hooks/use-items';
import { isoToBR } from '@/lib/dates';
import { paramsDaCopia } from '@/lib/duplicar';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { hrefDoLancar } from '@/lib/lancar';

/**
 * Favoritos de lançamento (F22): modelos que só PREENCHEM o formulário. Usar, renomear, editar (os
 * mesmos campos do formulário), arquivar/desarquivar e apagar — nenhum toca um lançamento.
 */
export default function FavoritesScreen() {
  const { windowClass } = useAdaptiveWindow();
  const toast = useToast();
  const brl = useBRL();
  const ativos = useFavoritos(false);
  const arquivados = useFavoritos(true);
  const salvar = useSalvarFavorito();
  const apagar = useApagarFavorito();
  const usou = useUsouFavorito();
  const nome = useNomeDoFavorito();
  const [abertos, setAbertos] = useState(false);

  const erro = (e: any) => toast({ message: e?.code === NOME_REPETIDO ? 'Já existe um favorito com esse nome.' : 'Não deu certo. Tenta de novo.', tone: 'error' });

  const usar = (f: Favorito) => {
    usou.mutate({ id: f.id, use_count: f.use_count });
    router.push(hrefDoLancar('uma', paramsDaCopia(f.modelo, isoToBR(localISODate())).params));
  };
  const editar = (f: Favorito) => router.push(hrefDoLancar('uma', { ...paramsDaCopia(f.modelo, isoToBR(localISODate())).params, favorito: f.id }));
  const renomear = (f: Favorito) => nome.pedir(f.name, (novo) => salvar.mutate({ id: f.id, name: novo }, { onError: erro }));
  const arquivar = (f: Favorito, valor: boolean) => salvar.mutate({ id: f.id, archived: valor }, {
    onSuccess: () => toast({
      message: valor ? <><Forte>{f.name}</Forte> foi para os arquivados.</> : <><Forte>{f.name}</Forte> voltou para a lista.</>,
      tone: 'success',
      ...(valor ? { action: { label: 'Desfazer', onPress: () => salvar.mutate({ id: f.id, archived: false }, { onError: erro }) } } : {}),
    }),
    onError: erro,
  });
  const excluir = (f: Favorito) => confirmDestructive(`Apagar o favorito ${f.name}?`, 'Apagar', () => apagar.mutate(f.id, {
    onSuccess: () => toast({ message: <><Forte>{f.name}</Forte> saiu. Nenhum lançamento mudou.</>, tone: 'success' }),
    onError: erro,
  }), 'Os lançamentos que você já fez com ele continuam como estão.');

  const acoesDoAtivo = (f: Favorito): ItemAction[] => [
    { label: 'Usar', icon: 'plus', arrasto: 'direita', onPress: () => usar(f) },
    { label: 'Editar', icon: 'pencil', onPress: () => editar(f) },
    { label: 'Renomear', icon: 'tag', onPress: () => renomear(f) },
    { label: 'Arquivar', icon: 'archivebox', arrasto: 'esquerda', desfaz: true, onPress: () => arquivar(f, true) },
    { label: 'Apagar', icon: 'trash', destructive: true, onPress: () => excluir(f) },
  ];
  const acoesDoArquivado = (f: Favorito): ItemAction[] => [
    { label: 'Desarquivar', curto: 'Restaurar', icon: 'arrow.uturn.backward', arrasto: 'direita', onPress: () => arquivar(f, false) },
    { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => excluir(f) },
  ];

  const legenda = (f: Favorito) => [
    f.modelo.amount_cents ? brl(f.modelo.amount_cents as number) : null,
    typeof f.modelo.category === 'string' ? f.modelo.category : null,
    f.use_count > 0 ? `usado ${f.use_count}x` : null,
  ].filter(Boolean).join(' · ') || 'Sem valor definido';

  const linha = (f: Favorito, acoes: ItemAction[], aoTocar: () => void) => (
    <Deslizavel key={f.id} titulo={f.name} acoes={acoes}>
      <Row title={f.name} subtitle={legenda(f)} icon="star" chevron={false}
        onPress={aoTocar} onLongPress={() => showItemActions(f.name, acoes)}
        accessibilityLabel={`${f.name}, ${legenda(f)}`} />
    </Deslizavel>
  );

  const lista = ativos.data ?? [];
  const guardados = arquivados.data ?? [];
  return (
    <Screen grouped wide={windowClass !== 'compact'} onRefresh={() => Promise.all([ativos.refetch(), arquivados.refetch()])}>
      <Stack.Screen options={{ title: 'Favoritos' }} />
      {ativos.isError ? <ErrorCard onRetry={ativos.refetch} /> : null}
      {ativos.isPending && !ativos.isError ? <SkeletonRow /> : null}
      {ativos.isSuccess && lista.length > 0 ? (
        <Section title="Seus favoritos">{lista.map((f) => linha(f, acoesDoAtivo(f), () => usar(f)))}</Section>
      ) : null}
      {ativos.isSuccess && lista.length === 0 ? (
        <EmptyState compacto icon="star" title="Nenhum favorito ainda" hint="Em um lançamento, toque em *Salvar como favorito*." />
      ) : null}
      {arquivados.isSuccess && guardados.length > 0 ? (
        <Section>
          <Row icon="archivebox" title={`Arquivados · ${guardados.length}`} chevron={false}
            trailing={<Icon name={abertos ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
            onPress={() => setAbertos((v) => !v)} accessibilityState={{ expanded: abertos }} />
          {abertos ? guardados.map((f) => linha(f, acoesDoArquivado(f), () => arquivar(f, false))) : null}
        </Section>
      ) : null}
      {nome.folha}
    </Screen>
  );
}
