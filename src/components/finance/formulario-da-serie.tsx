import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CorpoProps } from '@/components/finance/corpo-do-lancar';
import { ErrorCard } from '@/components/error-card';
import { useBRL } from '@/components/ui/conceal';
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
  useEndRecurring,
  usePreviewEndRecurring,
  useRecurringFirstDate,
  useRecurringTransactions,
  useSaveRecurringAll,
  useSaveRecurringSeries,
  type RecurringTransaction,
} from '@/hooks/use-finance';
import { useRascunho } from '@/hooks/use-rascunho';
import { newClientMessageId } from '@/lib/agent-chat';
import { brToISO } from '@/lib/dates';
import { askEditScope } from '@/lib/edit-scope';
import { confirmDestructive } from '@/lib/item-actions';
import { fraseDoEncerramento } from '@/lib/encerrar-serie';
import { linhaDaRecorrente, detalheDaEscrita, mudancaDoDetalhe, type EntradaRecorrente } from '@/lib/escrita';
import { financeErrorMessage } from '@/lib/finance-form';
import { normalizePaymentMethod, paymentMethodError } from '@/lib/payment-method';
import { comumParaSerie } from '@/lib/lancar';
import { estadoDaRecorrencia } from '@/lib/recurring-state';
import { SERIE_VAZIA, pisoDoInicio, serieDoRegistro, validaSerie, type SerieForm } from '@/lib/serie';
import { useExpenseClassificationDraft } from '@/hooks/use-expense-classification';
import { expenseClassificationFromRecord, expenseClassificationPatch } from '@/lib/expense-classification';

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

type EstadoDaSerie = {
  form: SerieForm;
  baseline?: RecurringTransaction;
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
  const accounts = useAccounts();
  const create = useCreateRecurring();
  const editar = useSaveRecurringSeries();
  const editarTudo = useSaveRecurringAll();
  const brl = useBRL();
  const previaDoFim = usePreviewEndRecurring();
  const encerrar = useEndRecurring();
  const tentativaTudo = useRef<{ key: string; id: string } | null>(null);
  const tentativaFuturo = useRef<{ key: string; id: string } | null>(null);
  /** `deHipotese`: aberta pelo "Aplicar" do "E se…?" — criar tira aquela hipótese do rascunho. */
  const { tirar } = useRascunho();
  /** O corpo ainda está aberto? O que é dele (toast, avisar o hospedeiro) só roda com ele montado. */
  const [montado] = useState(() => ({ current: true }));
  useEffect(() => () => {
    montado.current = false;
  }, [montado]);

  const [estado, setEstado] = useState<EstadoDaSerie>(() => {
    const guardado = props.estadoGuardado as EstadoDaSerie | SerieForm | undefined;
    // Estados antigos guardavam só os campos. Os novos preservam também o registro
    // aberto: realtime não pode trocar o baseline do diff nem a revisão do CAS.
    if (guardado && 'form' in guardado) return {
      ...guardado,
      form: { ...guardado.form,
        ...(Object.hasOwn(comum, 'subcategory_id') ? { category: comum.categoria, ...detalheDaEscrita(comum) } : {}),
        expenseClassification: comum.expenseClassification ?? guardado.form.expenseClassification },
    };
    const baseline = alvo ? { ...alvo } : undefined;
    // A classificação segue a última intenção comum; o baseline continua sendo o registro aberto.
    if (guardado) return { form: {
      ...guardado, expenseClassification: comum.expenseClassification ?? guardado.expenseClassification,
      ...(Object.hasOwn(comum, 'subcategory_id') ? { category: comum.categoria, ...detalheDaEscrita(comum) } : {}),
    }, baseline };
    if (baseline) return { form: serieDoRegistro(baseline), baseline };
    const c = comumParaSerie(comum);
    return {
      form: {
        ...SERIE_VAZIA,
        kind: c.kind,
        counterpartyId: c.kind === 'transfer' ? c.contraId ?? null : null,
        preset: props.preset ?? SERIE_VAZIA.preset,
        amountCents: c.valorCents,
        description: c.descricao,
        merchant: c.estabelecimento ?? '',
        category: c.categoria,
        ...detalheDaEscrita(c),
        accountId: c.contaId,
        paymentMethod: c.paymentMethod,
        expenseClassification: c.expenseClassification,
        inicio: c.dataBR,
      },
    };
  });
  const { form: formBase, baseline } = estado;
  // O piso do "Termina em" inclui a primeira ocorrência gravada (o calendário reescreve o `dtstart`).
  const primeira = useRecurringFirstDate(formBase.id ?? null);
  const form = formBase.id ? { ...formBase, inicioOriginal: pisoDoInicio(formBase.inicioOriginal, primeira.data) } : formBase;
  const setForm = (form: SerieForm) => setEstado((anterior) => ({ ...anterior, form }));

  const classification = useExpenseClassificationDraft(form.expenseClassification, form.category, form.kind,
    Boolean(editandoId || form.id), baseline?.workspace_id);
  const resolvedForm = { ...form, expenseClassification: classification.classification };

  useEffect(() => {
    registrarComum(() => ({ kind: form.kind, descricao: form.description, valorCents: form.amountCents, contaId: form.accountId, contraId: form.counterpartyId, dataBR: form.inicio, categoria: form.category, ...detalheDaEscrita(form), estabelecimento: form.merchant, paymentMethod: form.paymentMethod, expenseClassification: classification.classification }));
    registrarEstado(() => estado);
  });

  const { inicioDate, agendaNoPassado, fimEncerra, podeSalvar: basicoPodeSalvar, rrulePrevia } = validaSerie(form);
  const transferencia = form.kind === 'transfer';

  const erroMetodo = transferencia ? null : paymentMethodError(form.paymentMethod, (accounts.data ?? []).find((c) => c.id === form.accountId) ?? null);
  const podeSalvar = basicoPodeSalvar && !erroMetodo && classification.ready
    && (Boolean(editandoId || form.id) || !classification.isError);

  const creationInput: EntradaRecorrente | null = podeSalvar && inicioDate && rrulePrevia ? {
    kind: form.kind,
    amount_cents: form.amountCents,
    description: form.description.trim(),
    merchant: transferencia ? null : form.merchant.trim() || null,
    category: transferencia ? null : form.category,
    ...detalheDaEscrita(form, form.kind),
    account_id: form.accountId,
    ...(transferencia ? { counterparty_account_id: form.counterpartyId } : {}),
    ...(form.paymentMethod !== undefined && !transferencia ? { payment_method: form.paymentMethod } : {}),
    rrule: rrulePrevia,
    next_run_at: inicioDate.toISOString(),
    end_date: form.fim ? brToISO(form.fim) : null,
    auto_confirm: form.autoConfirm,
    ...classification.classification,
  } : null;

  /**
   * Fim antes do próximo vencimento = encerrar (F18): a prévia diz o que fica e o que sai e, na
   * confirmação, `end_recurring_series` faz o fim e a limpeza juntos (a mesma conta do "Encerrar"
   * da lista). Editar o fim NÃO passa pelo patch da série nesse caso.
   */
  const confirmarEncerramento = (lastDate: string) => {
    previaDoFim.mutate({ id: form.id!, lastDate }, {
      onSuccess: (previa) => confirmDestructive(
        'Encerrar a série?',
        'Encerrar',
        () => encerrar.mutate({ id: form.id!, lastDate }, {
          onSuccess: () => {
            toast({ message: 'Série encerrada.', tone: 'success' });
            onFechar();
          },
          onError: (erro) => toast({ message: financeErrorMessage(erro, 'Não deu para encerrar a série.'), tone: 'error' }),
        }),
        fraseDoEncerramento(previa, brl),
      ),
      onError: (erro) => toast({ message: financeErrorMessage(erro, 'Não deu para conferir o encerramento.'), tone: 'error' }),
    });
  };

  const salvar = (criarOutro: boolean) => {
    if (salvarBloqueadoAtual.current || !podeSalvar) return;
    if (form.id) {
      /**
       * Só o que MUDOU. `update_recurring_series` propaga toda chave presente para as
       * ocorrências futuras: mandar o objeto inteiro faria "corrigi só o valor do
       * aluguel" reescrever a categoria e o nome de ocorrências que alguém ajustou à
       * mão. É a mesma regra do `patchDaSerie` do formulário de lançamento.
       */
      const antes = baseline;
      const patch: Parameters<typeof editar.mutate>[0]['patch'] = {};
      if (!antes || form.amountCents !== Number(antes.amount_cents)) patch.amount_cents = form.amountCents;
      // Transferência: sem categoria, forma de pagamento nem classificação.
      if (!transferencia && (!antes || form.category !== antes.category)) patch.category = form.category;
      if (!transferencia) Object.assign(patch, mudancaDoDetalhe(antes ?? {}, form, antes?.category ?? null, form.category));
      const desc = form.description.trim();
      if (!antes || desc !== antes.description) patch.description = desc;
      if (!antes || form.accountId !== antes.account_id) patch.account_id = form.accountId;
      if (!transferencia && form.paymentMethod !== undefined && (!antes || form.paymentMethod !== normalizePaymentMethod(antes.payment_method))) patch.payment_method = form.paymentMethod;
      if (!antes || form.autoConfirm !== antes.auto_confirm) patch.auto_confirm = form.autoConfirm;
      const fim = form.fim ? brToISO(form.fim) : null;
      if (!antes || fim !== antes.end_date) patch.end_date = fim;
      const merchant = form.merchant.trim() || null;
      if (!transferencia && (!antes || merchant !== (antes.merchant ?? null))) patch.merchant = merchant;
      // Trocar de/para transferência é conversão (`converter_registro`): o patch nunca leva o tipo dela.
      if (form.kind !== 'transfer' && antes?.kind !== 'transfer' && (!antes || form.kind !== antes.kind)) patch.kind = form.kind;
      if (transferencia && (form.counterpartyId ?? null) !== (antes?.counterparty_account_id ?? null)) {
        patch.counterparty_account_id = form.counterpartyId ?? null;
      }
      const classificationPatch = transferencia ? {} : expenseClassificationPatch(expenseClassificationFromRecord(antes), classification.classification);
      Object.assign(patch, classificationPatch);
      if (form.agendaMudou) {
        if (!inicioDate || !rrulePrevia || agendaNoPassado) return;
        patch.rrule = rrulePrevia;
        patch.next_run_at = inicioDate.toISOString();
      }
      const linePatch: Parameters<typeof editarTudo.mutate>[0]['linePatch'] = {};
      if (patch.amount_cents !== undefined) linePatch.amount_cents = patch.amount_cents;
      if (patch.category !== undefined) linePatch.category = patch.category;
      if ('subcategory_id' in patch) linePatch.subcategory_id = patch.subcategory_id as string | null;
      if (patch.description !== undefined) linePatch.description = patch.description;
      if (patch.merchant !== undefined) linePatch.merchant = patch.merchant;
      if (patch.account_id !== undefined) linePatch.account_id = patch.account_id;
      if (patch.payment_method !== undefined) linePatch.payment_method = patch.payment_method;
      Object.assign(linePatch, classificationPatch);

      /*
        Aqui a pessoa edita a SÉRIE, não uma ocorrência (28/09/2026): "Das próximas em diante" ou
        "Todas". O "Só esta" mexia na próxima ocorrência gravada, que ninguém abriu — uma
        ocorrência se edita pelo lançamento dela, em Lançamentos ou em "Ver ocorrências".
      */
      // Fim que encerra: o fim e a limpeza das futuras são do `end_recurring_series`, depois do resto.
      let encerrarDepois: (() => void) | null = null;
      if (fimEncerra && fim && fim !== (antes?.end_date ?? null)) {
        delete patch.end_date;
        encerrarDepois = () => confirmarEncerramento(fim);
      }
      const concluir = () => (encerrarDepois ? encerrarDepois() : onFechar());
      if (Object.keys(patch).length === 0) {
        // nada mudou além do fim (ou nada): sem pergunta de alcance
        concluir();
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
              concluir();
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
            concluir();
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

  const salvando = props.salvando || create.isPending || editar.isPending || editarTudo.isPending || previaDoFim.isPending || encerrar.isPending;

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
          <CamposDaSerie form={resolvedForm} onChange={setForm} contas={accounts.data ?? []} workspaceId={baseline?.workspace_id}
            classificationDefaults={classification.defaults}
            onUseCategoryDefaults={classification.defaults ? () => setForm({ ...form, expenseClassification: classification.adoptCategoryDefaults() }) : undefined} />
          {classification.isError ? <ErrorCard onRetry={() => void classification.refetch()} /> : null}
          {/* A prévia de efeito ainda não conhece a transferência recorrente: ela só aparece nas outras. */}
          <FinanceWritePreview accounts={accounts.data ?? []} write={creationInput && !transferencia && !editandoId && !form.id && !converter
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
