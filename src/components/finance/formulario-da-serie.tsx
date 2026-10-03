import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CorpoProps } from '@/components/finance/corpo-do-lancar';
import { ErrorCard } from '@/components/error-card';
import { CamposDaSerie } from '@/components/finance/serie-form';
import { FinanceWritePreview } from '@/components/finance/finance-write-preview';
import { escritaDaRecorrente } from '@/lib/finance-write-input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SheetScroll } from '@/components/ui/sheet';
import { SkeletonList } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import {
  useAccounts,
  useCreateRecurring,
  useRecurringTransactions,
  useSaveRecurringAll,
  useSaveRecurringSeries,
  type RecurringTransaction,
} from '@/hooks/use-finance';
import { useRascunho } from '@/hooks/use-rascunho';
import { newClientMessageId } from '@/lib/agent-chat';
import { brToISO } from '@/lib/dates';
import { askEditScope } from '@/lib/edit-scope';
import { linhaDaRecorrente, type EntradaRecorrente } from '@/lib/escrita';
import { financeErrorMessage } from '@/lib/finance-form';
import { normalizePaymentMethod, paymentMethodError } from '@/lib/payment-method';
import { comumParaSerie } from '@/lib/lancar';
import { estadoDaRecorrencia } from '@/lib/recurring-state';
import { SERIE_VAZIA, serieDoRegistro, validaSerie, type SerieForm } from '@/lib/serie';

/**
 * O formulário da série recorrente como CORPO (spec 2026-09-29, formulário único): estado, campos e
 * salvar, saídos da folha de Recorrentes sem mudar a regra. Quem hospeda decide o que fechar quer
 * dizer (`onFechar`) e o que vem depois de criar (`onSalvo`).
 *
 * A rolagem é `SheetScroll`: dentro de uma folha ela desconta o que fica abaixo dela; fora (a tela
 * modal), é o `KeyboardAwareScrollView` comum — o mesmo corpo serve aos dois.
 */
type Props = CorpoProps & {
  preset?: SerieForm['preset'];
};

export function FormularioDaSerie(props: Props) {
  const series = useRecurringTransactions();
  const alvo = props.editandoId ? (series.data ?? []).find((r) => r.id === props.editandoId) : undefined;
  // Links antigos podem chegar à origem mantida pela conversão: ela é histórico,
  // e não deve voltar a oferecer o formulário de uma recorrência em andamento.
  if (alvo && estadoDaRecorrencia(alvo) === 'encerrada') {
    return (
      <>
        <TaskHeader title="Recorrência encerrada" onClose={props.onFechar} />
        <SheetScroll contentContainerStyle={styles.corpo}>
          <EmptyState
            icon="repeat"
            title="Esta recorrência já terminou"
            hint="O histórico permanece em Lançamentos. Um registro criado pela conversão se edita por ele."
            action={{ label: 'Voltar', onPress: props.onFechar }}
            compacto
          />
        </SheetScroll>
      </>
    );
  }
  /*
    Editando sem a série carregada, o estado inicial cairia na CRIAÇÃO — e o `useState` não relê:
    "Criar" gravaria uma série duplicada. Espera (ou diz que falhou); com a série, o formulário monta
    com ela, pela chave.
  */
  if (props.editandoId && !alvo && !props.estadoGuardado) {
    return (
      <>
        <TaskHeader title="Editar recorrência" onClose={props.onFechar} />
        <SheetScroll contentContainerStyle={styles.corpo}>
          {series.isError ? <ErrorCard onRetry={() => void series.refetch()} /> : <SkeletonList linhas={4} />}
        </SheetScroll>
      </>
    );
  }
  return <CorpoDaSerie key={alvo?.id ?? 'novo'} {...props} alvo={alvo} />;
}

function CorpoDaSerie(props: Props & { alvo?: RecurringTransaction }) {
  const { comum, editandoId, converter, deHipotese, onSalvo, onFechar, registrarComum, registrarEstado, alvo } = props;
  const toast = useToast();
  const salvarBloqueadoAtual = useRef(Boolean(props.salvarBloqueado));
  useLayoutEffect(() => { salvarBloqueadoAtual.current = Boolean(props.salvarBloqueado); }, [props.salvarBloqueado]);
  const series = useRecurringTransactions();
  const accounts = useAccounts();
  const create = useCreateRecurring();
  const editar = useSaveRecurringSeries();
  const editarTudo = useSaveRecurringAll();
  const tentativaTudo = useRef<{ key: string; id: string } | null>(null);
  const tentativaFuturo = useRef<{ key: string; id: string } | null>(null);
  /** `deHipotese`: aberta pelo "Aplicar" do "E se…?" — criar tira aquela hipótese do rascunho. */
  const { tirar } = useRascunho();
  /** O corpo ainda está aberto? O que é dele (toast, avisar o hospedeiro) só roda com ele montado. */
  const [montado] = useState(() => ({ current: true }));
  useEffect(() => () => {
    montado.current = false;
  }, [montado]);

  const [form, setForm] = useState<SerieForm>(() => {
    if (props.estadoGuardado) return props.estadoGuardado as SerieForm;
    if (alvo) return serieDoRegistro(alvo);
    const c = comumParaSerie(comum);
    return {
      ...SERIE_VAZIA,
      kind: c.kind === 'income' ? 'income' : 'expense',
      preset: props.preset ?? SERIE_VAZIA.preset,
      amountCents: c.valorCents,
      description: c.descricao,
      merchant: c.estabelecimento ?? '',
      category: c.categoria,
      accountId: c.contaId,
      paymentMethod: c.paymentMethod,
      inicio: c.dataBR,
    };
  });

  useEffect(() => {
    registrarComum(() => ({ kind: form.kind, descricao: form.description, valorCents: form.amountCents, contaId: form.accountId, dataBR: form.inicio, categoria: form.category, estabelecimento: form.merchant, paymentMethod: form.paymentMethod }));
    registrarEstado(() => form);
  });

  const { inicioDate, agendaNoPassado, podeSalvar: basicoPodeSalvar, rrulePrevia } = validaSerie(form);

  const erroMetodo = paymentMethodError(form.paymentMethod, (accounts.data ?? []).find((c) => c.id === form.accountId) ?? null);
  const podeSalvar = basicoPodeSalvar && !erroMetodo;

  const creationInput: EntradaRecorrente | null = podeSalvar && inicioDate && rrulePrevia ? {
    kind: form.kind,
    amount_cents: form.amountCents,
    description: form.description.trim(),
    merchant: form.merchant.trim() || null,
    category: form.category,
    account_id: form.accountId,
    ...(form.paymentMethod !== undefined ? { payment_method: form.paymentMethod } : {}),
    rrule: rrulePrevia,
    next_run_at: inicioDate.toISOString(),
    end_date: form.fim ? brToISO(form.fim) : null,
    auto_confirm: form.autoConfirm,
  } : null;

  const salvar = (criarOutro: boolean) => {
    if (salvarBloqueadoAtual.current || !podeSalvar) return;
    if (form.id) {
      /**
       * Só o que MUDOU. `update_recurring_series` propaga toda chave presente para as
       * ocorrências futuras: mandar o objeto inteiro faria "corrigi só o valor do
       * aluguel" reescrever a categoria e o nome de ocorrências que alguém ajustou à
       * mão. É a mesma regra do `patchDaSerie` do formulário de lançamento.
       */
      const antes = (series.data ?? []).find((r) => r.id === form.id);
      const patch: Parameters<typeof editar.mutate>[0]['patch'] = {};
      if (!antes || form.amountCents !== Number(antes.amount_cents)) patch.amount_cents = form.amountCents;
      if (!antes || form.category !== antes.category) patch.category = form.category;
      const desc = form.description.trim();
      if (!antes || desc !== antes.description) patch.description = desc;
      if (!antes || form.accountId !== antes.account_id) patch.account_id = form.accountId;
      if (form.paymentMethod !== undefined && (!antes || form.paymentMethod !== normalizePaymentMethod(antes.payment_method))) patch.payment_method = form.paymentMethod;
      if (!antes || form.autoConfirm !== antes.auto_confirm) patch.auto_confirm = form.autoConfirm;
      const fim = form.fim ? brToISO(form.fim) : null;
      if (!antes || fim !== antes.end_date) patch.end_date = fim;
      const merchant = form.merchant.trim() || null;
      if (!antes || merchant !== (antes.merchant ?? null)) patch.merchant = merchant;
      if (!antes || form.kind !== antes.kind) patch.kind = form.kind;
      if (form.agendaMudou) {
        if (!inicioDate || !rrulePrevia || agendaNoPassado) return;
        patch.rrule = rrulePrevia;
        patch.next_run_at = inicioDate.toISOString();
      }
      const linePatch: Parameters<typeof editarTudo.mutate>[0]['linePatch'] = {};
      if (patch.amount_cents !== undefined) linePatch.amount_cents = patch.amount_cents;
      if (patch.category !== undefined) linePatch.category = patch.category;
      if (patch.description !== undefined) linePatch.description = patch.description;
      if (patch.merchant !== undefined) linePatch.merchant = patch.merchant;
      if (patch.account_id !== undefined) linePatch.account_id = patch.account_id;
      if (patch.payment_method !== undefined) linePatch.payment_method = patch.payment_method;

      /*
        Aqui a pessoa edita a SÉRIE, não uma ocorrência (28/09/2026): "Das próximas em diante" ou
        "Todas". O "Só esta" mexia na próxima ocorrência gravada, que ninguém abriu — uma
        ocorrência se edita pelo lançamento dela, em Lançamentos ou em "Ver ocorrências".
      */
      if (Object.keys(patch).length === 0) {
        // nada mudou: nada a perguntar
        onFechar();
        return;
      }
      askEditScope('occurrence', async (scope) => {
        if (scope === 'all') {
          if (!antes || antes.edit_revision == null) {
            toast({ message: 'A recorrência mudou. Abra a edição novamente antes de salvar.', tone: 'error' });
            return;
          }
          const key = JSON.stringify([form.id, patch, antes.edit_revision]);
          if (tentativaTudo.current?.key !== key) tentativaTudo.current = { key, id: newClientMessageId() };
          editarTudo.mutate({
            recurringId: form.id!,
            linePatch,
            seriesPatch: patch,
            expectedRevision: Number(antes.edit_revision),
            requestId: tentativaTudo.current.id,
          }, {
            onSuccess: () => {
              tentativaTudo.current = null;
              toast({ message: 'Série e ocorrências gravadas alteradas.', tone: 'success' });
              onFechar();
            },
            onError: (saveError) => toast({ message: financeErrorMessage(saveError, 'Não deu para alterar todas as ocorrências.'), tone: 'error' }),
          });
          return;
        }
        if (!antes || antes.edit_revision == null) {
          toast({ message: 'A recorrência mudou. Abra a edição novamente antes de salvar.', tone: 'error' });
          return;
        }
        const key = JSON.stringify([form.id, patch, antes.edit_revision]);
        if (tentativaFuturo.current?.key !== key) tentativaFuturo.current = { key, id: newClientMessageId() };
        editar.mutate({
          id: form.id!, patch,
          expectedRevision: Number(antes.edit_revision),
          requestId: tentativaFuturo.current.id,
        }, {
          onSuccess: ({ quantas, aviso }) => {
            tentativaFuturo.current = null;
            toast({
              message: aviso ?? (quantas > 0
                ? `Série alterada e ${quantas} ${quantas === 1 ? 'ocorrência futura' : 'ocorrências futuras'} junto.`
                : 'Série alterada.'),
              tone: 'success',
            });
            onFechar();
          },
          onError: (saveError) => toast({ message: financeErrorMessage(saveError, 'Não deu para alterar a série.'), tone: 'error' }),
        });
      }, 'Todas também corrige as ocorrências já passadas.', { contrato: true });
      return;
    }
    // Editando, o formulário SEMPRE tem o id: sem ele, nunca cai na criação (seria uma duplicata).
    if (editandoId) return;
    if (!creationInput) return;
    const entrada = creationInput;
    // Convertendo outro registro nesta série: o hospedeiro pergunta o alcance e grava.
    if (converter) {
      converter({ tipo: 'recorrente', dados: linhaDaRecorrente(entrada) });
      return;
    }
    // Pela PROMESSA: aberta pelo "Aplicar" de uma hipótese, ela sai do rascunho mesmo com o corpo já
    // fechado; o que é do corpo (toast, avisar o hospedeiro), só com ele montado.
    create.mutateAsync(entrada).then(
      () => {
        if (deHipotese) tirar(deHipotese);
        if (!montado.current) return;
        toast({ message: 'Recorrência criada.', tone: 'success' });
        onSalvo(criarOutro);
      },
      () => {
        if (montado.current) toast({ message: 'Não deu para criar a recorrência.', tone: 'error' });
      }
    );
  };

  const salvando = props.salvando || create.isPending || editar.isPending || editarTudo.isPending;

  return (
    <>
      <TaskHeader
        title={form.id ? 'Editar recorrência' : 'Nova recorrência'}
        onClose={onFechar}
        action={
          <Button
            label={form.id || converter ? 'Salvar' : 'Criar'}
            size="sm"
            loading={salvando}
            disabled={Boolean(props.salvarBloqueado) || !podeSalvar || salvando}
            onPress={() => salvar(false)}
          />
        }
      />
      <SheetScroll contentContainerStyle={styles.corpo}>
        {props.topo}
        <View style={styles.conteudo}>
          <CamposDaSerie form={form} onChange={setForm} contas={accounts.data ?? []} />
          <FinanceWritePreview accounts={accounts.data ?? []} write={creationInput && !editandoId && !form.id && !converter
            && !props.salvarBloqueado && !salvando && !accounts.isError && !accounts.isPending ? escritaDaRecorrente(creationInput) : null} />
          {!editandoId && !converter ? (
            <Button
              variant="secondary"
              block
              label="Salvar e criar outro"
              disabled={Boolean(props.salvarBloqueado) || !podeSalvar || salvando}
              onPress={() => salvar(true)}
            />
          ) : null}
        </View>
      </SheetScroll>
    </>
  );
}

const styles = StyleSheet.create({
  conteudo: {
    gap: Space.xl,
  },
  corpo: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
});
