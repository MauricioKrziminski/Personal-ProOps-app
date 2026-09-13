import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { monthTitle } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { SectionHead } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Space } from '@/design/tokens';
import { useCycleLines, type CycleLine, type CycleView } from '@/hooks/use-finance';
import { isoToBR } from '@/lib/dates';

type Recorte = 'entra' | 'sai' | 'faturas';

const TITULO: Record<Recorte, string> = {
  entra: 'O que entra',
  sai: 'O que sai',
  faturas: 'Faturas',
};

/**
 * **O detalhe de um recorte do ciclo** — as linhas que produziram o número, e nada além delas.
 *
 * Pedido do dono do produto (13/09/2026): *"aparece que eu vou ter −615,87 ao fim do ciclo de
 * outubro, mas como eu vejo tudo que dá dentro disso? As faturas organizadas, os lançamentos,
 * entra e sai olhando individualmente cada receita e gasto"*.
 *
 * ⚠️ **Ela lê exatamente a mesma fonte do número de cima** (`cycle_lines`, que é
 * `private.cash_events`), filtrada. Montar a lista de outra consulta é como o detalhe passa a
 * não somar o total que ele explica — e essa divergência não dá erro, só um número que não
 * fecha. É a mesma razão pela qual o resumo do ciclo não é calculado no cliente.
 *
 * ⚠️ **Fatura aparece como UMA linha, pelo valor cheio, no dia em que o dinheiro sai.** Ela leva
 * para a tela da fatura, que já lista as compras — repetir as compras aqui quebraria a soma (a
 * compra já está dentro da fatura) e diria a mesma coisa em dois lugares.
 */
export default function CycleDetailScreen() {
  const params = useLocalSearchParams<{ month?: string; view?: string; tipo?: string }>();
  const month = params.month ?? '';
  const view = (params.view === 'civil' ? 'civil' : 'cycle') as CycleView;
  const tipo = (['entra', 'sai', 'faturas'].includes(params.tipo ?? '') ? params.tipo : 'sai') as Recorte;

  const linhas = useCycleLines(month, view);

  const { dias, total } = useMemo(() => agrupar(linhas.data ?? [], tipo), [linhas.data, tipo]);

  if (linhas.isError) {
    return (
      <ScrollView contentContainerStyle={styles.conteudo}>
        <ErrorCard onRetry={() => { void linhas.refetch(); }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.conteudo}>
      <View style={styles.topo}>
        <ThemedText type="caption" themeColor="textSecondary">
          {TITULO[tipo].toUpperCase()} · {monthTitle(month)}
        </ThemedText>
        <Money cents={total} variant="title" tone={tipo === 'entra' ? 'success' : 'danger'} />
      </View>

      {linhas.isPending ? (
        <Skeleton height={220} radius={Radius.md} />
      ) : dias.length === 0 ? (
        <EmptyState title="Nada neste recorte" hint="Nenhum movimento deste tipo cai neste ciclo." />
      ) : (
        dias.map(([dia, itens]) => (
          <View key={dia}>
            {/* O dia é o cabeçalho porque a pergunta aqui é "quando o dinheiro sai", que é a
                própria base de cálculo do ciclo. Agrupar por categoria seria a outra pergunta,
                e ela já tem tela ("Onde o dinheiro foi"). */}
            <SectionHead title={isoToBR(dia)} />
            <Section>
              {itens.map((l, i) => (
                <Row
                  key={`${l.origin}-${l.ref_id}-${i}`}
                  title={l.title}
                  subtitle={`${legenda(l.origin)} · ${l.method_label}`}
                  trailing={
                    <Money
                      cents={Number(l.in_cents) > 0 ? Number(l.in_cents) : Number(l.out_cents)}
                      tone={Number(l.in_cents) > 0 ? 'success' : 'danger'}
                    />
                  }
                  onPress={destino(l)}
                />
              ))}
            </Section>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/** O que a linha É, em uma palavra — a pessoa precisa saber por que ela está nesta soma. */
function legenda(origin: string) {
  switch (origin) {
    case 'invoice':
      return 'Fatura a pagar';
    case 'invoice_payment':
      return 'Pagamento de fatura';
    case 'debt_schedule':
      return 'Parcela do financiamento';
    case 'recurring_projection':
      return 'Recorrente (projetada)';
    case 'transaction_overdue':
      return 'Atrasado';
    default:
      return 'Lançamento';
  }
}

/**
 * Cada linha leva para onde ela MORA. Sem destino para o que é projetado da regra: ali não existe
 * lançamento para abrir, e mandar a pessoa para uma tela vazia é pior que não ter link.
 */
function destino(l: CycleLine) {
  switch (l.origin) {
    case 'invoice':
      return () => router.push({ pathname: '/finance/invoice/[id]', params: { id: l.ref_id } });
    // O pagamento é uma TRANSAÇÃO (o transfer para o cartão), não a fatura — mandar para a tela
    // da fatura com o id do transfer abriria uma tela vazia.
    case 'invoice_payment':
    case 'transaction':
    case 'transaction_overdue':
      return () => router.push({ pathname: '/finance/[txId]', params: { txId: l.ref_id } });
    case 'debt_schedule':
      return () => router.push('/finance/debts');
    default:
      return undefined;
  }
}

/** Agrupa por dia e soma — a soma tem que ser a MESMA que a linha de cima do ciclo mostra. */
function agrupar(linhas: CycleLine[], tipo: Recorte) {
  const filtradas = linhas.filter((l) => {
    if (tipo === 'entra') return Number(l.in_cents) > 0;
    if (tipo === 'faturas') return l.origin === 'invoice' || l.origin === 'invoice_payment';
    return Number(l.out_cents) > 0;
  });

  const mapa = new Map<string, CycleLine[]>();
  for (const l of filtradas) {
    const atual = mapa.get(l.day);
    if (atual) atual.push(l);
    else mapa.set(l.day, [l]);
  }

  return {
    dias: [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    total: filtradas.reduce((s, l) => s + Number(l.in_cents) + Number(l.out_cents), 0),
  };
}

const styles = StyleSheet.create({
  conteudo: { padding: Space.md, paddingBottom: Space.xxl, gap: Space.sm },
  topo: { gap: Space.xs, paddingBottom: Space.sm },
});
