import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { FormularioDoLancamento } from '@/components/finance/formulario-do-lancamento';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { MaxContentWidth } from '@/constants/theme';
import { Space, Type } from '@/design/tokens';
import { useInstallmentPlan, useJurosDoPix, useTransaction } from '@/hooks/use-finance';
import { isoToBR, localISODate } from '@/lib/dates';

/**
 * Novo/editar lançamento — modal do Stack raiz (Cancelar nativo vem do `_layout.tsx`).
 *
 * O item em edição vem de `useTransaction(id)`, nunca do cache da lista: com cache frio o modal
 * de EDIÇÃO virava modal de CRIAÇÃO em silêncio e duplicava o lançamento. Por isso a decisão
 * "é edição ou criação?" acontece ANTES de montar o form (o gate abaixo) — enquanto a query não
 * responde, não existe formulário para submeter.
 */

export default function TransactionFormScreen() {
  const params = useLocalSearchParams<{ id?: string; conta?: string; deHipotese?: string; kind?: string; amount?: string; data?: string; parcelas?: string }>();
  const query = useTransaction(params.id);
  // A parcela edita o valor da COMPRA: sem o plano (travadas, total) o campo não sabe o que
  // "cada parcela" alcança. Espera junto com a linha, na mesma tela de esqueleto.
  const planoId = query.data?.installment_plan_id;
  const plano = useInstallmentPlan(planoId);
  const esperandoPlano = Boolean(planoId) && plano.isPending;
  // O juro do Pix desta compra, se houver: o campo abre com ele (26/09/2026, "tudo que se cria se
  // edita"). Mesmo esqueleto — `useForm` só lê os valores na montagem.
  const juros = useJurosDoPix(query.data);
  const esperandoJuros = juros.fetchStatus === 'fetching' && juros.isPending;

  if (params.id && (query.isLoading || esperandoPlano || esperandoJuros)) {
    return (
      <Screen scroll={false}>
        <TaskHeader title="Editar lançamento" onClose={() => router.back()} />
        <View style={[styles.body, styles.loading]}>
          <Skeleton height={56} />
          <Skeleton height={36} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
        </View>
      </Screen>
    );
  }

  // Nunca cair em modo criação por omissão: um id que não resolve é erro, não formulário vazio.
  // A compra da parcela também: sem ela o campo Valor não sabe o que "cada parcela" alcança.
  if (params.id && (query.isError || !query.data || (planoId && plano.isError))) {
    const semLinha = query.isError || !query.data;
    return (
      <Screen scroll={false}>
        <TaskHeader title="Lançamento" onClose={() => router.back()} />
        <View style={styles.body}>
          <Card>
            <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">
              {semLinha ? 'Não encontrei esse lançamento' : 'Não deu para carregar a compra desta parcela'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {semLinha ? 'Ele pode ter sido apagado em outro aparelho.' : 'Pode ter sido a conexão.'}
            </ThemedText>
            <View style={styles.errorActions}>
              <Button
                label="Tentar de novo"
                variant="secondary"
                size="sm"
                onPress={() => (semLinha ? query.refetch() : plano.refetch())}
              />
              <Button label="Voltar" size="sm" onPress={() => router.back()} />
            </View>
            </View>
          </Card>
        </View>
      </Screen>
    );
  }

  // `?? undefined`: `useTransaction` devolve null quando a linha não existe mais
  // (maybeSingle), e "não achei" e "não estou editando" são o mesmo caso aqui —
  // o form abre em branco, que é o comportamento de criar.
  const editing = query.data ?? undefined;
  // Aberto pelo "Aplicar" de uma hipótese do "E se…?": o formulário nasce com o tipo, o valor (o
  // total, com parcelas), a data, as parcelas e a conta dela.
  const rapida = !editing && params.deHipotese !== undefined;
  return (
    // Outro id é outro formulário: aberto por link sobre um já aberto, a tela era reaproveitada
    // e o `useForm` (que só lê os valores na montagem) seguia com o lançamento anterior.
    <FormularioDoLancamento
      key={params.id ?? `novo:${params.conta ?? ''}:${params.deHipotese ?? ''}`}
      editing={editing}
      plano={plano.data ?? undefined}
      jurosDoPix={juros.data ?? null}
      comum={{
        kind: rapida && params.kind === 'income' ? 'income' : 'expense',
        descricao: '',
        valorCents: rapida ? Number(params.amount) || 0 : 0,
        contaId: editing ? null : (params.conta ?? null),
        dataBR: (rapida && params.data) || isoToBR(localISODate()),
        categoria: null,
      }}
      parcelas={rapida ? Math.max(1, Number(params.parcelas) || 1) : undefined}
      deHipotese={rapida ? params.deHipotese : undefined}
      registrarComum={() => {}}
      registrarEstado={() => {}}
      onSalvo={() => router.back()}
      onFechar={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  // Replica o padding do `Screen`, que está com `scroll={false}` para o teclado ser
  // responsabilidade do `KeyboardAwareScrollView`.
  body: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  loading: {
    gap: Space.lg,
  },
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
});
