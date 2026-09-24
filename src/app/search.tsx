import { useMemo, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/finance/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Search } from '@/components/ui/search';
import { SkeletonRow } from '@/components/ui/skeleton';
import { Space } from '@/design/tokens';
import { useGlobalSearch } from '@/hooks/use-search';
import { VerMais } from '@/components/ui/ver-mais';
import { PASSO } from '@/lib/aos-poucos';
import { formatDateBR } from '@/hooks/use-items';
import { useDebounced } from '@/hooks/use-debounced';
import { noteTitle, notePreview } from '@/lib/search';
import { describeRRule } from '@/lib/rrule-text';

type Scope = 'tudo' | 'notas' | 'lancamentos' | 'lembretes';

/** Em "Tudo", nenhum domínio pode empurrar os outros para fora da tela. */
const PREVIEW = 5;

/**
 * Busca global — notas, lançamentos e lembretes numa tela.
 *
 * Ordem das seções não é alfabética, é de probabilidade: busca por texto livre é comportamento de
 * segundo cérebro. Dinheiro tem tela própria com filtros; lembrete se acha pela aba Hoje.
 *
 * **Sem card de destaque**: esta tela não tem um número que responda a nada. O único glass aqui é
 * a chrome.
 */
export default function SearchScreen() {
  const [text, setText] = useState('');
  const [scope, setScope] = useState<Scope>('tudo');
  const q = useDebounced(text, 250);
  /**
   * Aos poucos (24/09/2026): 20 por tipo, e o "Ver mais" pede mais 20 — antes o teto era 30 em
   * silêncio, e o chip dizia "30" como se fosse o total. Outra busca ou outro escopo recomeça.
   */
  const [janela, setJanela] = useState({ chave: '', limite: PASSO });
  const chave = `${q}|${scope}`;
  const limite = janela.chave === chave ? janela.limite : PASSO;
  const { notes, transactions, reminders, enabled, term } = useGlobalSearch(q, limite);
  // A consulta traz um a mais que o limite: sobrou um, existe mais no servidor.
  const temMais = (rows: unknown[] | undefined) => (rows?.length ?? 0) > limite;
  const contagem = (rows: unknown[] | undefined) =>
    `${Math.min(rows?.length ?? 0, limite)}${temMais(rows) ? '+' : ''}`;

  const counts = useMemo(
    () => ({
      notas: Math.min(notes.data?.length ?? 0, limite),
      lancamentos: Math.min(transactions.data?.length ?? 0, limite),
      lembretes: Math.min(reminders.data?.length ?? 0, limite),
    }),
    [notes.data, transactions.data, reminders.data, limite]
  );

  const show = (s: Scope) => scope === 'tudo' || scope === s;
  const cut = <T,>(rows: T[] | undefined) =>
    scope === 'tudo' ? (rows ?? []).slice(0, PREVIEW) : (rows ?? []).slice(0, limite);
  /** Em "Tudo", o "Ver mais" abre a seção; dentro dela, pede mais 20 ao servidor. */
  const verMais = (rows: unknown[] | undefined, s: Scope) =>
    scope === 'tudo' ? (
      <VerMais
        restantes={temMais(rows) ? null : Math.max(0, (rows?.length ?? 0) - PREVIEW)}
        onPress={() => setScope(s)}
      />
    ) : (
      <VerMais
        restantes={temMais(rows) ? null : 0}
        onPress={() => setJanela({ chave, limite: limite + PASSO })}
      />
    );

  const loading = enabled && (notes.isLoading || transactions.isLoading || reminders.isLoading);
  const nothing =
    enabled &&
    !loading &&
    counts.notas + counts.lancamentos + counts.lembretes === 0 &&
    !notes.isError &&
    !transactions.isError &&
    !reminders.isError;

  return (
    <Screen
      grouped
      onRefresh={enabled ? () => Promise.all([notes.refetch(), transactions.refetch(), reminders.refetch()]) : undefined}
      search={
        <Search
          autoFocus
          value={text}
          onChangeText={setText}
          placeholder="Buscar em tudo"
          accessibilityLabel="Buscar em notas, lançamentos e lembretes"
        />
      }>
      <Stack.Screen
        options={{
          title: 'Buscar',
        }}
      />
      <View style={styles.chips}>
        {(
          [
            ['tudo', 'Tudo'],
            ['notas', `Notas${counts.notas ? ` ${contagem(notes.data)}` : ''}`],
            ['lancamentos', `Lançamentos${counts.lancamentos ? ` ${contagem(transactions.data)}` : ''}`],
            ['lembretes', `Lembretes${counts.lembretes ? ` ${contagem(reminders.data)}` : ''}`],
          ] as [Scope, string][]
        ).map(([value, label]) => (
          <Chip key={value} label={label} selected={scope === value} onPress={() => setScope(value)} />
        ))}
      </View>

      {!enabled ? (
        <EmptyState
          icon="magnifyingglass"
          title="Procurando o quê?"
          hint="Notas, lançamentos e lembretes"
        />
      ) : null}

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {show('notas') && (notes.isError || counts.notas > 0) ? (
        <Section title="Notas">
          {notes.isError ? (
            <Row title="Não deu para buscar em notas" subtitle="Toque para tentar de novo" icon="exclamationmark.triangle" onPress={() => notes.refetch()} />
          ) : (
            cut(notes.data).map((n) => (
              <Row
                key={n.id}
                title={noteTitle(n.content) || 'Nota sem título'}
                subtitle={notePreview(n.content) || (n.source === 'whatsapp' ? 'via WhatsApp' : '')}
                icon="note.text"
                onPress={() => router.push(`/notes/${n.id}`)}
              />
            ))
          )}
        </Section>
      ) : null}
      {show('notas') && !notes.isError && counts.notas > 0 ? verMais(notes.data, 'notas') : null}

      {show('lancamentos') && (transactions.isError || counts.lancamentos > 0) ? (
        <Section title="Lançamentos">
          {transactions.isError ? (
            <Row title="Não deu para buscar em lançamentos" subtitle="Toque para tentar de novo" icon="exclamationmark.triangle" onPress={() => transactions.refetch()} />
          ) : (
            cut(transactions.data).map((t) => (
              <Row
                key={t.id}
                title={t.description ?? t.merchant ?? t.category ?? 'Lançamento'}
                subtitle={`${formatDateBR(t.occurred_at)}${t.category ? ` · ${t.category}` : ''}`}
                icon={t.kind === 'income' ? 'arrow.down.circle' : 'arrow.up.circle'}
                trailing={
                  <Money
                    cents={Number(t.amount_cents)}
                    variant="ticker"
                    tone={t.kind === 'income' ? 'success' : 'text'}
                  />
                }
                onPress={() =>
                  router.push({ pathname: '/finance/[txId]', params: { txId: t.id } })
                }
              />
            ))
          )}
        </Section>
      ) : null}
      {show('lancamentos') && !transactions.isError && counts.lancamentos > 0 ? verMais(transactions.data, 'lancamentos') : null}

      {show('lembretes') && (reminders.isError || counts.lembretes > 0) ? (
        <Section title="Lembretes">
          {reminders.isError ? (
            <Row title="Não deu para buscar em lembretes" subtitle="Toque para tentar de novo" icon="exclamationmark.triangle" onPress={() => reminders.refetch()} />
          ) : (
            cut(reminders.data).map((r) => (
              <Row
                key={r.id}
                title={r.title}
                subtitle={
                  !r.active
                    ? 'pausado'
                    : r.recurrence
                      ? describeRRule(r.recurrence)
                      : formatDateBR(r.next_run_at)
                }
                icon="bell"
                onPress={() => router.push(`/reminder-form?id=${r.id}`)}
              />
            ))
          )}
        </Section>
      ) : null}
      {show('lembretes') && !reminders.isError && counts.lembretes > 0 ? verMais(reminders.data, 'lembretes') : null}

      {nothing ? (
        <EmptyState
          icon="magnifyingglass"
          title={`Nada encontrado para «${term}»`}
          hint="Tente outra palavra"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
});
