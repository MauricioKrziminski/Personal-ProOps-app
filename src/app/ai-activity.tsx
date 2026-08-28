import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { ErrorCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, Type, tabular } from '@/design/tokens';
import { confirmDestructive } from '@/lib/item-actions';
import { formatBRL } from '@/hooks/use-items';
import {
  useAiEvents,
  usePlanStatus,
  useUndoAiEvent,
  type AiActionSummary,
  type AiEvent,
} from '@/hooks/use-finance';

/** Frase do que a IA entendeu, por tipo de ação. Sem emoji: o ícone é a família da ação. */
const ACTION_LABEL: Record<string, string> = {
  create_expense: 'registrou um gasto',
  create_income: 'registrou uma receita',
  create_transfer: 'registrou uma transferência',
  create_installment_purchase: 'registrou uma compra parcelada',
  pay_invoice: 'deu baixa numa fatura',
  query_invoice: 'consultou o cartão',
  query_forecast: 'consultou a projeção',
  simulate_purchase: 'simulou uma compra',
  mark_paid: 'deu baixa numa conta',
  set_rule: 'criou uma regra',
  update_transaction: 'corrigiu um lançamento',
  delete_item: 'apagou um item',
  create_note: 'salvou uma nota',
  create_reminder: 'criou um lembrete',
  create_goal: 'criou uma meta',
  goal_deposit: 'registrou um aporte',
  query_balance: 'consultou o saldo',
  query_transactions: 'consultou gastos',
  query_budgets: 'consultou orçamentos',
  query_goals: 'consultou metas',
  undo_last: 'desfez o último',
  unknown: 'não entendeu',
};

const ACTION_ICON: Record<string, SymbolViewProps['name']> = {
  create_expense: 'arrow.down.circle',
  create_income: 'arrow.up.circle',
  create_transfer: 'arrow.left.arrow.right.circle',
  create_installment_purchase: 'creditcard',
  pay_invoice: 'creditcard',
  mark_paid: 'checkmark.circle',
  set_rule: 'text.badge.checkmark',
  update_transaction: 'pencil.circle',
  delete_item: 'trash',
  create_note: 'note.text',
  create_reminder: 'bell',
  create_goal: 'target',
  goal_deposit: 'target',
  unknown: 'questionmark.circle',
};

/** Onde mora o que a ação criou, quando o `ai_events` não guarda id para desfazer. */
const ACTION_DESTINO: Record<string, { label: string; go: () => void }> = {
  create_note: { label: 'Ver notas', go: () => router.push('/notes') },
  create_reminder: {
    label: 'Ver lembretes',
    go: () => router.push('/reminders'),
  },
  create_goal: { label: 'Ver metas', go: () => router.push('/finance/goals') },
  goal_deposit: { label: 'Ver metas', go: () => router.push('/finance/goals') },
};

type Filtro = 'tudo' | 'criou' | 'consultou' | 'erro';

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'tudo', label: 'tudo' },
  { value: 'criou', label: 'criou' },
  { value: 'consultou', label: 'consultou' },
  { value: 'erro', label: 'não entendeu' },
];

function familia(type: string): 'criou' | 'consultou' | 'erro' {
  if (type === 'unknown') return 'erro';
  if (type.startsWith('query_') || type === 'simulate_purchase') return 'consultou';
  return 'criou';
}

function casa(event: AiEvent, filtro: Filtro): boolean {
  if (filtro === 'tudo') return true;
  if (filtro === 'erro') {
    return (
      Boolean(event.error) ||
      event.actions.length === 0 ||
      event.actions.some((a) => a.type === 'unknown')
    );
  }
  return event.actions.some((a) => familia(a.type) === filtro);
}

function descreveAcao(action: AiActionSummary): string {
  const base = ACTION_LABEL[action.type] ?? action.type;
  const detalhe = [
    action.amount_cents ? formatBRL(action.amount_cents) : null,
    action.category ? `#${action.category}` : null,
    action.content ?? action.title,
  ]
    .filter(Boolean)
    .join(' · ');
  return detalhe ? `${base} · ${detalhe}` : base;
}

function horaRelativa(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 60 * 24) return `há ${Math.round(minutos / 60)}h`;
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Resumo dos últimos 7 dias.
 *
 * Fora do componente de propósito: `Date.now()` chamado no corpo do render (ou dentro de um
 * `useMemo`) é leitura impura e o lint reprova — a regra existe porque o valor mudaria sozinho
 * entre dois renders idênticos.
 */
function resumoSemana(eventos: AiEvent[]) {
  const corte = Date.now() - 7 * 86_400_000;
  const recentes = eventos.filter((e) => new Date(e.created_at).getTime() >= corte);
  return {
    total: recentes.length,
    criaram: recentes.filter((e) => e.actions.some((a) => familia(a.type) === 'criou')).length,
    // Mesmo critério do filtro "não entendeu" (`casa`) — senão o número do card diz uma coisa e a
    // lista filtrada mostra outra.
    falharam: recentes.filter((e) => casa(e, 'erro')).length,
  };
}

/** "Hoje" / "Ontem" / "12 de agosto" — cabeçalho do grupo do dia. */
function tituloDoDia(iso: string): string {
  const dia = new Date(iso);
  const hoje = new Date();
  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmoDia(dia, hoje)) return 'Hoje';
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (mesmoDia(dia, ontem)) return 'Ontem';
  return dia.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

/**
 * Atividade da IA — "o que a IA fez com o que eu falei, e dá para voltar atrás?".
 *
 * Nenhum concorrente mostra isto. É o contra-argumento à queixa nº1 de quem usa esse tipo de app:
 * *"categorizou errado e eu não sei por quê"*.
 *
 * **`ai_events` NÃO está na publicação `supabase_realtime`** (e foi decidido que não entra: uma
 * linha por parse de todos os usuários numa tela que se abre uma vez por semana não paga um canal
 * permanente). Por isso a tela recarrega no foco e no pull-to-refresh — e o empty state promete
 * exatamente isso, em vez do "aparece aqui na hora" que era mentira.
 */
export default function AiActivityScreen() {
  const toast = useToast();
  const { data: events, isLoading, isError, refetch, isRefetching } = useAiEvents();
  const { data: plano } = usePlanStatus();
  const undo = useUndoAiEvent();

  const [filtro, setFiltro] = useState<Filtro>('tudo');
  const [detalhe, setDetalhe] = useState<string | null>(null);
  // O `delete` não toca no `ai_events`: sem isto o botão voltaria no próximo refetch.
  const [desfeitos, setDesfeitos] = useState<string[]>([]);

  // O gesto real é: manda a mensagem no WhatsApp, volta para o app.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const lista = useMemo(() => events ?? [], [events]);
  const visiveis = useMemo(() => lista.filter((e) => casa(e, filtro)), [lista, filtro]);
  const semana = resumoSemana(lista);

  const grupos = useMemo(() => {
    const mapa: { titulo: string; eventos: AiEvent[] }[] = [];
    for (const evento of visiveis) {
      const titulo = tituloDoDia(evento.created_at);
      const ultimo = mapa[mapa.length - 1];
      if (ultimo?.titulo === titulo) ultimo.eventos.push(evento);
      else mapa.push({ titulo, eventos: [evento] });
    }
    return mapa;
  }, [visiveis]);

  const desfazer = (event: AiEvent) => {
    const ids = event.created_transaction_ids ?? [];
    confirmDestructive(
      `Apagar ${ids.length} ${ids.length === 1 ? 'lançamento criado' : 'lançamentos criados'} por esta mensagem?`,
      'Desfazer',
      () =>
        undo.mutate(ids, {
          onSuccess: () => {
            setDesfeitos((atual) => [...atual, event.id]);
            toast({ message: 'Lançamentos apagados.', tone: 'success' });
          },
          // Desfazer não tinha `onError`: falhar não mostrava absolutamente nada.
          onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }),
        }),
      'A linha continua aqui, marcada como desfeita — é o registro de que aconteceu.'
    );
  };

  const linha = (event: AiEvent, index: number) => {
    const confianca = event.confidence ?? 0;
    const duvida = confianca < 0.8;
    const desfeito = desfeitos.includes(event.id);
    const podeDesfazer = !desfeito && (event.created_transaction_ids ?? []).length > 0;
    const primeira = event.actions[0];
    const destino = primeira ? ACTION_DESTINO[primeira.type] : undefined;
    const aberto = detalhe === event.id;

    // `Row` trunca o título em uma linha, então a mensagem com várias ações mostra a primeira e
    // conta o resto — o detalhe abre no toque. Uma mensagem não pode ocupar a tela inteira.
    const frase = primeira ? descreveAcao(primeira) : 'Não gerou nenhuma ação';
    const extras = Math.max(0, event.actions.length - 1);

    return (
      <Animated.View
        key={event.id}
        layout={LinearTransition.duration(Motion.duration.base)}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * 40, Motion.stagger.cap)
        )}
        style={desfeito ? styles.desfeito : undefined}
      >
        <Row
          title={frase}
          subtitle={[
            horaRelativa(event.created_at),
            extras > 0 ? `+${extras} nesta mensagem` : null,
            desfeito ? 'desfeito' : null,
            duvida ? (confianca < 0.6 ? 'chutei' : 'tive dúvida') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          icon={ACTION_ICON[primeira?.type ?? 'unknown'] ?? 'magnifyingglass'}
          chevron={false}
          accessibilityLabel={`${horaRelativa(event.created_at)}, ${frase}${extras > 0 ? `, mais ${extras} nesta mensagem` : ''}${desfeito ? ', desfeito' : ''}`}
          onPress={() => setDetalhe(aberto ? null : event.id)}
        />

        {event.error ? (
          <ThemedText type="small" themeColor="danger" style={styles.extra}>
            {event.error}
          </ThemedText>
        ) : null}

        {podeDesfazer || destino ? (
          <View style={styles.acoes}>
            {podeDesfazer ? (
              <Chip label="Desfazer" selected={false} onPress={() => desfazer(event)} />
            ) : destino ? (
              <Chip label={destino.label} selected={false} onPress={destino.go} />
            ) : null}
          </View>
        ) : null}

        {aberto ? (
          <View style={styles.detalhe}>
            {event.actions.slice(1).map((acao, i) => (
              <ThemedText key={`${event.id}-${i}`} type="small">
                {descreveAcao(acao)}
              </ThemedText>
            ))}
            {/* Observabilidade de quem construiu, não informação para quem usa — por isso fica a
                um toque de distância, e não na linha. */}
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {event.model} · {(event.input_tokens ?? 0) + (event.output_tokens ?? 0)} tokens
              {duvida ? ` · confiança ${Math.round(confianca * 100)}%` : ''}
            </ThemedText>
          </View>
        ) : null}
      </Animated.View>
    );
  };

  return (
    <Screen grouped onRefresh={refetch} refreshing={isRefetching}>
      <Stack.Screen options={{ title: 'Atividade da IA', headerLargeTitle: true }} />

      {/* A RLS de `ai_events` é por `user_id`, sem `workspace_id`: num workspace compartilhado o
          registro do que o outro mandou é invisível. Uma linha honesta hoje custa menos que a
          desconfiança de um lançamento sem origem amanhã. */}
      <View style={styles.faixa}>
        <Icon name="person.crop.circle" size="sm" color="textSecondary" />
        <ThemedText type="small" themeColor="textSecondary" style={styles.faixaTexto}>
          Só as suas mensagens.
          {plano && plano.members > 1
            ? ' O que os outros membros mandam não aparece aqui — os lançamentos deles aparecem, a interpretação não.'
            : ''}
        </ThemedText>
      </View>

      <View style={styles.chips}>
        {FILTROS.map((f) => (
          <Chip
            key={f.value}
            label={f.label}
            selected={filtro === f.value}
            onPress={() => setFiltro(f.value)}
          />
        ))}
      </View>

      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading && !isError ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela: um número que resume merece o destaque; um parágrafo, não. */}
      {semana.total > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <HeroLabel>Esta semana</HeroLabel>
            <ThemedText style={[Type.title2, tabular]}>
              {semana.total} {semana.total === 1 ? 'mensagem' : 'mensagens'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {semana.criaram} viraram lançamento ·{' '}
              {semana.falharam === 0 ? 'entendi todas' : `${semana.falharam} não entendi`}
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {grupos.map((grupo) => (
        <Section key={grupo.titulo} title={grupo.titulo}>
          {grupo.eventos.map(linha)}
        </Section>
      ))}

      {!isLoading && !isError && lista.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title="A IA ainda não entendeu nada seu"
          hint={
            'Manda “gastei 45 no mercado” no WhatsApp —\no que ela entender aparece aqui quando você voltar.'
          }
        />
      ) : null}

      {!isLoading && !isError && lista.length > 0 && visiveis.length === 0 ? (
        <EmptyState
          icon="checkmark.circle"
          title={`Nada em «${FILTROS.find((f) => f.value === filtro)?.label}»`}
          hint={filtro === 'erro' ? 'Boa notícia.' : undefined}
          action={{ label: 'Ver tudo', onPress: () => setFiltro('tudo') }}
        />
      ) : null}

      {!isLoading && !isError && lista.length > 0 ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
          Também dá para corrigir conversando: “muda o último pra 54”. Nota, lembrete e meta ainda
          não guardam o id de origem, então não têm desfazer aqui.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  faixaTexto: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  hero: {
    gap: Space.xs,
  },
  desfeito: {
    opacity: 0.5,
  },
  extra: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
  detalhe: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  acoes: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  rodape: {
    paddingHorizontal: Space.lg,
  },
});
