import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { monthTitle } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, Type } from '@/design/tokens';
import {
  useAccounts,
  useDeleteImportBatch,
  useImportBatches,
  usePlanStatus,
  type ImportBatchSummary,
} from '@/hooks/use-finance';
import { formatDateBR } from '@/hooks/use-items';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

/**
 * Importações — "cadê aquele extrato que eu comecei a importar?".
 *
 * O `batch_id` vivia só num `useState` da tela de importação: fechou o app no meio da revisão de
 * 80 linhas, perdeu o lote de vista. Ele continua no banco, com os itens pendentes intactos, e
 * até agora não existia caminho de volta.
 *
 * **`import_batches.status` é decorativo** — gravado como `review` na criação e nunca atualizado.
 * Por isso o rótulo da linha sai da contagem dos itens, e lote com zero item (o insert dos itens
 * estourou depois do insert do lote) aparece como falha.
 */

/** Nome de arquivo de banco é comprido e feio — trunca no MEIO, que é onde não tem informação. */
function encurta(nome: string, max = 30): string {
  if (nome.length <= max) return nome;
  return `${nome.slice(0, max - 12)}…${nome.slice(-10)}`;
}

interface Estado {
  texto: string;
  tom: 'warning' | 'danger' | 'textSecondary';
}

function estadoDoLote(lote: ImportBatchSummary): Estado {
  if (lote.pendentes > 0) return { texto: `${lote.pendentes} esperando revisão`, tom: 'warning' };
  if (lote.status === 'failed' || lote.total === 0) return { texto: 'Falhou', tom: 'danger' };
  return {
    texto: `${lote.aprovados} ${lote.aprovados === 1 ? 'lançado' : 'lançados'}`,
    tom: 'textSecondary',
  };
}

export default function ImportHistoryScreen() {
  const toast = useToast();
  const batches = useImportBatches();
  const accounts = useAccounts();
  const plano = usePlanStatus();
  const apagar = useDeleteImportBatch();

  const contaPorId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const conta of accounts.data ?? []) mapa.set(conta.id, conta.name);
    return mapa;
  }, [accounts.data]);

  const lista = batches.data ?? [];
  const pendente = lista.find((l) => l.pendentes > 0);
  const bloqueadoNoPlano = plano.data ? !plano.data.can_import : false;

  const porMes = useMemo(() => {
    const grupos: [string, ImportBatchSummary[]][] = [];
    for (const lote of batches.data ?? []) {
      const mes = lote.created_at.slice(0, 7);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo[0] === mes) ultimo[1].push(lote);
      else grupos.push([mes, [lote]]);
    }
    return grupos;
  }, [batches.data]);

  const abrir = (lote: ImportBatchSummary) =>
    router.push({ pathname: '/import', params: { batch: lote.id } });

  const confirmarApagar = (lote: ImportBatchSummary) =>
    confirmDestructive(
      'Apagar o registro desta importação?',
      'Apagar',
      () =>
        apagar.mutate(lote.id, {
          onSuccess: () => toast({ message: 'Registro apagado.', tone: 'success' }),
          onError: () => toast({ message: 'Não deu para apagar o registro.', tone: 'error' }),
        }),
      `Os ${lote.aprovados} lançamentos que você confirmou continuam no financeiro. Só o histórico da importação some.`,
    );

  const acoes = (lote: ImportBatchSummary) =>
    showItemActions(lote.filename ?? 'Extrato', [
      {
        label: lote.pendentes > 0 ? 'Retomar a revisão' : 'Ver os itens',
        onPress: () => abrir(lote),
      },
      { label: 'Apagar registro', destructive: true, onPress: () => confirmarApagar(lote) },
    ]);

  return (
    <Screen
      grouped
      onRefresh={() => {
        batches.refetch();
        plano.refetch();
      }}
      refreshing={batches.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Importações',
          headerLargeTitle: true,
        }}
      />

      <HeaderActions
        actions={[{ label: 'Nova importação', icon: 'plus', onPress: () => router.push('/import') }]}
      />

      {batches.isLoading ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : null}

      {batches.isError ? (
        <Section title="Importações">
          <Row
            title="Não deu para carregar suas importações"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => batches.refetch()}
          />
        </Section>
      ) : null}

      {/* A razão nº1 de alguém abrir esta tela. Não pode estar no meio de uma lista cronológica. */}
      {pendente ? (
        <Animated.View layout={LinearTransition.duration(Motion.duration.base)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${pendente.pendentes} itens esperando revisão. Retomar.`}
            onPress={() => abrir(pendente)}>
            <Card style={styles.aviso}>
              <Icon name="exclamationmark.circle.fill" size="lg" color="warning" />
              <View style={styles.avisoTexto}>
                <ThemedText type="smallBold">
                  {pendente.pendentes} {pendente.pendentes === 1 ? 'item espera' : 'itens esperam'}{' '}
                  revisão
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Toque para retomar de onde parou.
                </ThemedText>
              </View>
              <Icon name="chevron.right" size="sm" color="textSecondary" />
            </Card>
          </Pressable>
        </Animated.View>
      ) : null}

      {porMes.map(([mes, lotes]) => (
        <Section key={mes} title={monthTitle(mes)}>
          {lotes.map((lote, index) => {
            const estado = estadoDoLote(lote);
            const conta = lote.account_id ? contaPorId.get(lote.account_id) : null;
            const detalhes = [
              lote.source.toUpperCase(),
              lote.descartados > 0 ? `${lote.descartados} descartados` : null,
              lote.duplicados > 0 ? `${lote.duplicados} repetidos` : null,
              conta,
              lote.error ? lote.error.slice(0, 60) : null,
            ].filter(Boolean);
            return (
              <Animated.View
                key={lote.id}
                layout={LinearTransition.duration(Motion.duration.fast)}
                entering={FadeInDown.duration(Motion.duration.base).delay(
                  Math.min(index * Motion.stagger.step, Motion.stagger.cap),
                )}>
                <Row
                  title={encurta(lote.filename ?? 'Extrato')}
                  subtitle={detalhes.join(' · ')}
                  icon="doc.text"
                  accessibilityLabel={`${lote.filename ?? 'Extrato'}, ${lote.source.toUpperCase()}, ${formatDateBR(lote.created_at)}, ${estado.texto}`}
                  trailing={
                    <View style={styles.trailing}>
                      <ThemedText type="small" themeColor={estado.tom}>
                        {estado.texto}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatDateBR(lote.created_at)}
                      </ThemedText>
                    </View>
                  }
                  onPress={() => abrir(lote)}
                  onLongPress={() => acoes(lote)}
                />
              </Animated.View>
            );
          })}
        </Section>
      ))}

      {/* Esconder a funcionalidade não vende plano; explicar vende. */}
      {!batches.isLoading && !batches.isError && lista.length === 0 && bloqueadoNoPlano ? (
        <EmptyState
          icon="lock"
          title="Importação é do Pro"
          hint="No Free dá para registrar pelo WhatsApp à vontade — foto de cupom e PDF de fatura também viram lançamento."
          action={{
            label: 'Ver planos',
            onPress: () => router.push({ pathname: '/paywall', params: { from: 'import' } }),
          }}
        />
      ) : null}

      {!batches.isLoading && !batches.isError && lista.length === 0 && !bloqueadoNoPlano ? (
        <EmptyState
          icon="tray"
          title="Nenhuma importação ainda"
          hint={'Exporte o extrato do banco em OFX ou CSV e traga aqui —\nou manda foto do cupom no WhatsApp, que também vira lançamento.'}
          action={{ label: 'Importar agora', onPress: () => router.push('/import') }}
        />
      ) : null}

      {/* Só com histórico: sem nenhuma importação a nota ficava órfã 200px abaixo do empty
          state, explicando o "Tentar de novo" de uma linha que não existe na tela. */}
      {lista.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
          Os arquivos não ficam guardados — só os lançamentos que você confirmou. “Tentar de novo”
          pede o arquivo outra vez.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  avisoTexto: {
    flex: 1,
    gap: Space.xs,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: Space.xs,
  },
  rodape: {
    ...Type.footnote,
    paddingHorizontal: Space.lg,
  },
});
