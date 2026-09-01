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
  const { notes, transactions, reminders, enabled, term } = useGlobalSearch(q);

  const counts = useMemo(
    () => ({
      notas: notes.data?.length ?? 0,
      lancamentos: transactions.data?.length ?? 0,
      lembretes: reminders.data?.length ?? 0,
    }),
    [notes.data, transactions.data, reminders.data]
  );

  const show = (s: Scope) => scope === 'tudo' || scope === s;
  const cut = <T,>(rows: T[] | undefined, s: Scope) =>
    scope === 'tudo' ? (rows ?? []).slice(0, PREVIEW) : (rows ?? []);

  const loading = enabled && (notes.isLoading || transactions.isLoading || reminders.isLoading);
  const nothing =
    enabled &&
    !loading &&
    counts.notas + counts.lancamentos + counts.lembretes === 0 &&
    !notes.isError &&
    !transactions.isError &&
    !reminders.isError;

  return (
    <Screen grouped>
      <Stack.Screen
        options={{
          title: 'Buscar',
          headerLargeTitle: false,
        }}
      />
      <Search
        autoFocus
        value={text}
        onChangeText={setText}
        placeholder="Buscar em tudo"
        accessibilityLabel="Buscar em notas, lançamentos e lembretes"
      />

      <View style={styles.chips}>
        {(
          [
            ['tudo', 'Tudo'],
            ['notas', `Notas${counts.notas ? ` ${counts.notas}` : ''}`],
            ['lancamentos', `Lançamentos${counts.lancamentos ? ` ${counts.lancamentos}` : ''}`],
            ['lembretes', `Lembretes${counts.lembretes ? ` ${counts.lembretes}` : ''}`],
          ] as [Scope, string][]
        ).map(([value, label]) => (
          <Chip key={value} label={label} selected={scope === value} onPress={() => setScope(value)} />
        ))}
      </View>

      {!enabled ? (
        <EmptyState
          icon="magnifyingglass"
          title="Procurando o quê?"
          hint="Digite pelo menos duas letras — busca em notas, lançamentos e lembretes de uma vez."
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
            cut(notes.data, 'notas').map((n) => (
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

      {show('lancamentos') && (transactions.isError || counts.lancamentos > 0) ? (
        <Section title="Lançamentos">
          {transactions.isError ? (
            <Row title="Não deu para buscar em lançamentos" subtitle="Toque para tentar de novo" icon="exclamationmark.triangle" onPress={() => transactions.refetch()} />
          ) : (
            cut(transactions.data, 'lancamentos').map((t) => (
              <Row
                key={t.id}
                title={t.description ?? t.merchant ?? t.category ?? 'Lançamento'}
                subtitle={`${formatDateBR(t.occurred_at)}${t.category ? ` · ${t.category}` : ''}`}
                icon={t.kind === 'income' ? 'arrow.down.circle' : 'arrow.up.circle'}
                trailing={
                  <Money
                    cents={Number(t.amount_cents)}
                    variant="headline"
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

      {show('lembretes') && (reminders.isError || counts.lembretes > 0) ? (
        <Section title="Lembretes">
          {reminders.isError ? (
            <Row title="Não deu para buscar em lembretes" subtitle="Toque para tentar de novo" icon="exclamationmark.triangle" onPress={() => reminders.refetch()} />
          ) : (
            cut(reminders.data, 'lembretes').map((r) => (
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

      {nothing ? (
        <EmptyState
          icon="magnifyingglass"
          title={`Nada encontrado para «${term}»`}
          hint="Tente outra palavra — a busca de notas ignora acento, mas não adivinha sinônimo."
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
