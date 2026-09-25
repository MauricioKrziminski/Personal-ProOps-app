import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';

import { AgentApiError } from '@/lib/agent-api';

import { ErrorCard } from '@/components/error-card';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { ThemedText } from '@/components/themed-text';
import { ComNegrito } from '@/components/ui/forte';
import { HeaderMenu } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { Segmented } from '@/components/ui/segmented';
import { Screen } from '@/components/ui/screen';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useLock } from '@/hooks/use-lock';
import { Space, tabular } from '@/design/tokens';
import { formatDateBR } from '@/hooks/use-items';
import { useBRL } from '@/components/ui/conceal';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { CategoryPicker } from '@/components/finance/category-picker';
import {
  useAccounts,
  useFinishImport,
  useImportBatch,
  useImportItems,
  useImportUnmatched,
  useDeleteTransaction,
  useApplyImportToExisting,
  useImportStatement,
  usePlanStatus,
  useUpdateImportItem,
  type ImportItem,
} from '@/hooks/use-finance';
import { ImportRow } from '@/components/finance/import-row';
import {
  TITULO_DO_GRUPO,
  agrupar,
  fraseDaParcela,
  grupoDe,
  motivoDaLinha,
  nomeDoItem,
  selecaoInicial,
  totais,
  type Grupo,
} from '@/lib/import-preview';
import { AccountPicker } from '@/components/finance/account-picker';
import { VerMais } from '@/components/ui/ver-mais';
import { useAosPoucos, useJanelasPorGrupo } from '@/hooks/use-aos-poucos';
import { transicaoDeLayoutRapida } from '@/components/motion/transicao';

/**
 * O MIME curinga está na lista de propósito: banco brasileiro manda MIME errado com frequência, e
 * barrar no picker deixaria o usuário sem conseguir escolher o próprio extrato. A barreira de
 * verdade é a mensagem de erro amigável do 422.
 */
const ACCEPTED = [
  'application/x-ofx',
  'application/vnd.intu.qfx',
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'text/plain',
  '*/*',
];

/** Teto do `import-statement` (`MAX_ITEMS`). O corte era silencioso; agora está escrito na tela. */
const MAX_ITENS = 500;

interface FalhaImport {
  titulo: string;
  detalhe: string;
}

/**
 * A mensagem que o servidor escreveu tem que CHEGAR na tela.
 *
 * Antes a importação ia por `functions.invoke`, que lança `FunctionsHttpError` em qualquer
 * não-2xx com `data` nulo: a frase gentil (402 do plano, 422 do arquivo ilegível) se perdia e o
 * usuário lia "Edge Function returned a non-2xx status code". Agora vai pelo agente, e o
 * `agentFetch` já entrega `AgentApiError` com `status` e `message` prontos — o motivo de a
 * tradução ter encolhido pela metade.
 */
function traduzErro(err: unknown): FalhaImport {
  // `status: 0` é o que o `agentFetch` usa para "nem chegou ao servidor".
  const erro = err instanceof AgentApiError && err.status !== 0 ? err : null;
  if (!erro) {
    return {
      titulo: 'Não deu para importar agora',
      detalhe: 'Pode ter sido a conexão. Tenta de novo em instantes.',
    };
  }
  const doServidor = erro.message ?? '';

  if (erro.status === 402) {
    return {
      titulo: 'Importar é do plano Pro',
      detalhe: doServidor || 'No Free dá para registrar pelo WhatsApp à vontade.',
    };
  }
  if (erro.status === 422) {
    return {
      titulo: 'Não achei lançamentos nesse arquivo',
      detalhe:
        doServidor ||
        'Ele é o extrato em OFX ou CSV, e não o comprovante em PDF? Foto e PDF entram pelo WhatsApp.',
    };
  }
  return {
    titulo: 'Não deu para importar agora',
    detalhe: doServidor || 'Tenta de novo em instantes.',
  };
}

/**
 * Importar extrato ou fatura — o substituto do Open Finance.
 *
 * Duas etapas: escolher conta e arquivo, depois a PRÉVIA. Na prévia tudo aparece e tudo se
 * marca: o que é novo nasce marcado, o que já está no app (sete camadas de conciliação, no
 * agente) e o que não é gasto nem receita nascem desmarcados, com o motivo na linha. "Importar N"
 * grava exatamente o marcado — compra parcelada inteira — e descarta o resto numa transação só.
 * Plano: `docs/superpowers/plans/2026-09-22-importacao-inteligente.md`.
 */
export default function ImportScreen() {
  const toast = useToast();
  const brl = useBRL();
  const insets = useSafeAreaInsets();
  // `conta`: quem chega pela fatura, pelos Cartões ou pelo Próximo passo já vem com o cartão.
  const params = useLocalSearchParams<{ batch?: string; conta?: string }>();

  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data;
  const importar = useImportStatement();
  const usarDoExtrato = useApplyImportToExisting();
  const { semTrancar } = useLock();
  const apagarLancamento = useDeleteTransaction();
  const [batchId, setBatchId] = useState<string | undefined>(params.batch);
  /** `undefined` = a pessoa ainda não escolheu nesta tela; aí vale a conta que veio no link. */
  const [contaEscolhida, setAccountId] = useState<string | null | undefined>(undefined);
  // Id do link que não é uma conta da pessoa é ignorado — nunca pré-escolhe o que ela não tem.
  const accountId =
    contaEscolhida !== undefined
      ? contaEscolhida
      : params.conta && (accounts ?? []).some((a) => a.id === params.conta)
        ? params.conta
        : null;
  /**
   * O aviso do Pro vem ANTES do arquivo (23/09/2026). O 402 só chegava depois de escolher a conta
   * e o arquivo — o Free descobria no fim que a porta estava fechada.
   */
  const plano = usePlanStatus();
  const semPro = plano.data?.plan === 'free';
  const [falha, setFalha] = useState<FalhaImport | null>(null);
  const [editando, setEditando] = useState<ImportItem | null>(null);
  /** `null` = ainda a seleção sugerida (`selecaoInicial`); tocar numa linha a torna explícita. */
  const [marcados, setMarcados] = useState<Set<string> | null>(null);

  const { data: items, isLoading, isError, refetch } = useImportItems(batchId);
  const lote = useImportBatch(batchId);
  const finalizar = useFinishImport();
  const atualizar = useUpdateImportItem();

  // `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch
  // falha, e sem este corte a tela seguia afirmando números embaixo da faixa de erro.
  const lista = isError ? [] : (items ?? []);
  const cartao = lote.data?.accounts?.type === 'credit_card';
  const grupos = agrupar(lista, cartao);
  const escolhidos = marcados ?? selecaoInicial(lista, cartao);
  const soma = totais(lista, escolhidos, cartao);
  const fechado = lote.data?.status === 'done';
  const jaNoApp = lista.filter((i) => grupoDe(i, cartao) === 'no_app').length;
  const decididos = lista.filter((i) => i.status === 'approved' || i.status === 'discarded');
  const importados = decididos.filter((i) => i.status === 'approved').length;
  /*
    A conciliação inversa só faz sentido depois que o lote foi fechado: antes disso tudo que veio
    no extrato ainda está na prévia, e a lista seria o financeiro inteiro do período acusado de
    estar sobrando. É uma SEÇÃO à parte: o que ela lista são lançamentos do app, não do arquivo.
  */
  const sobrando = useImportUnmatched(batchId, fechado);
  /**
   * Aos poucos (24/09/2026): a prévia vai a 500 linhas e desenhava todas de uma vez. Cada grupo
   * mostra um passo; "Marcar todos" continua valendo para o grupo INTEIRO, visível ou não. E o que
   * está no app sem estar no arquivo vem do mais recente para o mais antigo (a RPC devolve na
   * ordem contrária).
   */
  const janelas = useJanelasPorGrupo(batchId ?? '');
  const sobra = useAosPoucos(
    [...(sobrando.data ?? [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    batchId ?? '',
  );

  // Estáveis (`useCallback` + atualização funcional): a linha é `memo` e a lista vai a 500.
  const selecaoSugerida = selecaoInicial(lista, cartao);
  const alternar = useCallback(
    (id: string) =>
      setMarcados((atual) => {
        const proximo = new Set(atual ?? selecaoSugerida);
        if (proximo.has(id)) proximo.delete(id);
        else proximo.add(id);
        return proximo;
      }),
    // a sugestão só importa enquanto não houve toque; depois `atual` manda
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, cartao],
  );
  const marcarGrupo = (ids: string[], marcar: boolean) => {
    Haptics.selectionAsync();
    const proximo = new Set(escolhidos);
    for (const id of ids) {
      if (marcar) proximo.add(id);
      else proximo.delete(id);
    }
    setMarcados(proximo);
  };

  const escolherArquivo = async () => {
    setFalha(null);
    if (!accountId) return;
    /*
      ⚠️ **`semTrancar` não é opcional aqui.** No Android abrir o seletor de arquivo dispara
      `AppState: background`, e sem a bandeira a trava do app pediria o PIN no meio da
      importação — a pessoa escolhe o extrato, volta, e leva uma tela de bloqueio por cima.
    */
    const escolha = await semTrancar(() =>
      DocumentPicker.getDocumentAsync({
        type: ACCEPTED,
        copyToCacheDirectory: true,
        multiple: false,
      })
    );
    if (escolha.canceled) return;

    const arquivo = escolha.assets[0];
    const ehOfx = /\.(ofx|qfx)$/i.test(arquivo.name);
    try {
      // SDK 57: leitura por `new File(uri).text()` (readAsStringAsync é legado).
      const conteudo = await new File(arquivo.uri).text();
      const resultado = await importar.mutateAsync({
        content: conteudo,
        source: ehOfx ? 'ofx' : 'csv',
        filename: arquivo.name,
        accountId,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMarcados(null);
      setBatchId(resultado.batch_id);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFalha(traduzErro(err));
    }
  };

  /*
    Sem diálogo de confirmação: o botão já diz "Importar N" em cima do total, e importar não
    destrói nada (o diálogo do app é o destrutivo, vermelho). Dois toques não gravam duas vezes —
    `finish_import_batch` trava o lote e devolve 0 no segundo.
  */
  const confirmar = () => {
    if (!batchId || soma.quantos === 0 || finalizar.isPending) return;
    const ids = lista.filter((i) => escolhidos.has(i.id) && grupoDe(i, cartao)).map((i) => i.id);
    finalizar.mutate(
      { batchId, itemIds: ids },
      {
        onSuccess: (n) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          toast({
            message: `${n} ${n === 1 ? 'lançamento importado' : 'lançamentos importados'}.`,
            tone: 'success',
          });
        },
        onError: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          toast({ message: 'Não deu para importar. Nada foi gravado.', tone: 'error' });
        },
      }
    );
  };

  const trocarSentido = (item: ImportItem, kind: 'income' | 'expense') => {
    if (item.kind === kind) return;
    setEditando({ ...item, kind });
    atualizar.mutate(
      { id: item.id, kind },
      {
        onError: () => {
          // volta o controle para o que o banco tem: ele não gravou
          setEditando((e) => (e?.id === item.id ? { ...e, kind: item.kind } : e));
          toast({ message: 'Não deu para trocar o tipo.', tone: 'error' });
        },
      }
    );
  };

  const trocarCategoria = (item: ImportItem, cat: string | null) => {
    setEditando(null);
    atualizar.mutate(
      { id: item.id, category: cat },
      {
        onError: () => toast({ message: 'Não deu para trocar a categoria.', tone: 'error' }),
      }
    );
  };

  /**
   * As saídas de uma linha. Nenhuma é automática: o app achou o par, quem decide é a pessoa.
   * "Usar no app" só existe onde o par difere no dia ou no VALOR — o extrato é a fonte dos dois.
   */
  const acoes = useCallback((id: string) => {
    const item = (items ?? []).find((i) => i.id === id);
    if (!item) return;
    const alvo = item.transactions;
    showItemActions(nomeDoItem(item), [
      { label: 'Trocar categoria ou tipo', onPress: () => setEditando(item) },
      ...(alvo
        ? [{ label: 'Abrir o lançamento do app', onPress: () => router.push(`/finance/${alvo.id}`) }]
        : []),
      ...(alvo && (item.status === 'near_match' || item.status === 'uncertain') &&
      (alvo.occurred_at !== item.occurred_at || alvo.amount_cents !== item.amount_cents)
        ? [
            {
              label: alvo.amount_cents !== item.amount_cents
                ? `Usar no app o valor do extrato (${brl(item.amount_cents)})`
                : `Corrigir a data no app para ${formatDateBR(item.occurred_at)}`,
              onPress: () =>
                usarDoExtrato.mutate(
                  {
                    itemId: item.id,
                    transactionId: alvo.id,
                    occurredAt: item.occurred_at,
                    amountCents: item.amount_cents,
                    baixar: !cartao,
                    contaId: alvo.account_id ? null : lote.data?.account_id,
                  },
                  {
                    onSuccess: () => toast({ message: 'Lançamento do app atualizado pelo extrato.', tone: 'success' }),
                    onError: () => toast({ message: 'Não deu para atualizar o lançamento.', tone: 'error' }),
                  }
                ),
            },
          ]
        : []),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cartao, brl, lote.data?.account_id]);

  // ── Etapa 1: trazer o arquivo ────────────────────────────────────────────
  if (!batchId) {
    return (
      <Screen grouped>
        {/* "Importar", sem "extrato": três caminhos chegam aqui por "Importar fatura". */}
        <Stack.Screen options={{ title: 'Importar' }} />

        {/* O único destaque da etapa: a instrução é o conteúdo da tela. */}
        <Card style={styles.hero}>
          <Icon name="arrow.down.doc" size="xl" color="tint" />
          <ThemedText type="smallBold">Traga a fatura ou o extrato</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
            OFX ou CSV do app do banco
          </ThemedText>
        </Card>

        {falha ? (
          <Card style={styles.falha}>
            <ThemedText type="smallBold" themeColor="danger">
              {falha.titulo}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {/* A frase é do servidor (nossa): o nome do campo vem em `*negrito*`. */}
              <ComNegrito texto={falha.detalhe} />
            </ThemedText>
          </Card>
        ) : null}

        {/*
          No Free a tela não pede conta nem arquivo que não levariam a lugar nenhum: o aviso É a
          etapa, e "Ver planos" a ação dela. Enquanto o plano carrega, esqueleto — sem ele o botão
          nascia ligado e o aviso entrava depois, empurrando a lista para baixo do dedo.
        */}
        {plano.isPending ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : semPro ? (
          <Card style={styles.aviso}>
            <ThemedText type="smallBold">Importar é do plano Pro</ThemedText>
            <Button label="Ver planos" onPress={() => router.push('/paywall')} block />
          </Card>
        ) : accountsQuery.isPending ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : accountsQuery.isError ? (
          <ErrorCard onRetry={() => void accountsQuery.refetch()} />
        ) : (accounts ?? []).length > 0 ? (
          <View style={styles.bloco}>
            <SectionHead title="Conta ou cartão" />
            {/*
              ⚠️ Obrigatória desde 22/09/2026: a conta decide o SENTIDO das linhas (numa fatura a
              compra vem positiva) e é contra ela que a prévia procura o que já está lançado.
            */}
            <AccountPicker accounts={accounts ?? []} value={accountId} onChange={setAccountId} />
          </View>
        ) : (
          <EmptyState
            icon="creditcard"
            title="Cadastre a conta ou o cartão primeiro"
            hint="A importação precisa saber de onde é o arquivo."
            action={{ label: 'Cadastrar', onPress: () => router.push('/finance/accounts') }}
          />
        )}

        {/* Com as contas chegando, o botão e "Escolha a conta primeiro" esperam junto: texto
            não aparece ao lado de esqueleto (25/09/2026). */}
        {plano.isPending || semPro || accountsQuery.isPending ? null : (
          <>
            <Button
              label={importar.isPending ? 'Lendo o arquivo…' : 'Escolher arquivo'}
              icon="doc.badge.plus"
              loading={importar.isPending}
              disabled={!accountId}
              onPress={escolherArquivo}
              block
            />

            <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
              {accountId
                ? `Até ${MAX_ITENS} lançamentos por arquivo.`
                : 'Escolha a conta primeiro'}
            </ThemedText>
          </>
        )}
      </Screen>
    );
  }

  // ── Etapa 2: a prévia ────────────────────────────────────────────────────
  return (
    <Screen grouped onRefresh={() => Promise.all([accountsQuery.refetch(), lote.refetch(), refetch()])}>
      <Stack.Screen options={{ title: fechado ? 'Importação' : 'Revisar importação' }} />

      {/* Montado SEMPRE, com a lista condicional: `Stack.Screen` não desfaz `setOptions` no
          unmount, então `{cond ? <HeaderMenu/> : null}` deixaria o "…" no header do Android. */}
      <HeaderMenu
        title="Importação"
        actions={
          fechado || lista.length === 0
            ? []
            : [
                {
                  label: 'Sair e continuar depois',
                  icon: 'arrow.uturn.backward',
                  onPress: () => router.back(),
                },
              ]
        }
      />

      {isError || lote.isError ? <ErrorCard onRetry={() => { void refetch(); void lote.refetch(); }} /> : null}

      {(isLoading || lote.isPending) && !isError && !lote.isError ? (
        <>
          <Skeleton height={160} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {!fechado && lote.isSuccess && lista.length > 0 ? (
        <>
          {/* O único destaque da etapa: o que VAI entrar, com o número de verdade no botão. */}
          {/*
            Sem `entering`: texto dentro de contêiner com animação de entrada já foi pintado pela
            metade no APK de release (§3 do design), e aqui ela não teria propósito nomeável.
            O rótulo diz o que o NÚMERO é; a contagem mora no botão.
          */}
          <View>
            <Card style={styles.resumo}>
              <HeroLabel>{soma.saiCents > 0 || soma.entraCents === 0 ? 'Sai' : 'Entra'}</HeroLabel>
              <Money
                cents={soma.saiCents > 0 || soma.entraCents === 0 ? -soma.saiCents : soma.entraCents}
                variant="money"
              />
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                {[
                  soma.saiCents > 0 && soma.entraCents > 0 ? `entra ${brl(soma.entraCents)}` : null,
                  soma.compras > 0
                    ? `${soma.compras} ${soma.compras === 1 ? 'compra parcelada completa' : 'compras parceladas completas'}`
                    : null,
                  jaNoApp > 0 ? `${jaNoApp} já no app` : null,
                ].filter(Boolean).join(' · ')}
              </ThemedText>
              <Button
                label={finalizar.isPending ? 'Importando…' : `Importar ${soma.quantos}`}
                loading={finalizar.isPending}
                disabled={soma.quantos === 0}
                onPress={confirmar}
                block
              />
            </Card>
          </View>

          {/*
            A IA marca toda compra como `compra` e todo dinheiro recebido como `receita`: sem
            nenhum dos dois, ela não respondeu (o Gemini devolveu 503 por horas em 22/09/2026). A
            prévia continua certa no que é ESTRUTURA — o que já está no app, o crédito da fatura,
            o par que entrou e saiu no mesmo dia —, mas aplicação e transferência para outra conta
            podem ter nascido marcadas. Dizer isso é o que evita importar sem olhar.
          */}
          {!lista.some((i) => i.nature === 'compra' || i.nature === 'receita') ? (
            <Note icon="exclamationmark.triangle">
              Não classifiquei as linhas. Revise.
            </Note>
          ) : null}

          {grupos.map(({ grupo, itens }) => {
            const ids = itens.map((i) => i.id);
            const todos = ids.every((id) => escolhidos.has(id));
            const j = janelas.janelaDe(grupo, itens);
            return (
              <Animated.View key={grupo} layout={transicaoDeLayoutRapida} style={styles.bloco}>
                <SectionHead
                  title={`${TITULO_DO_GRUPO[grupo]} · ${itens.length}`}
                  action={
                    <Button
                      label={todos ? 'Desmarcar todos' : 'Marcar todos'}
                      variant="ghost"
                      size="sm"
                      onPress={() => marcarGrupo(ids, !todos)}
                      style={styles.acaoDoGrupo}
                    />
                  }
                />
                <Section>
                  {j.visiveis.map((item) => (
                    <ImportRow
                      key={item.id}
                      id={item.id}
                      titulo={nomeDoItem(item)}
                      dia={item.occurred_at}
                      categoria={item.suggested_category}
                      kind={item.kind}
                      cents={item.amount_cents}
                      marcado={escolhidos.has(item.id)}
                      parcela={fraseDaParcela(item, cartao)}
                      motivo={motivoDaLinha(item, cartao)}
                      onToggle={alternar}
                      onLongPress={acoes}
                    />
                  ))}
                </Section>
                <VerMais restantes={j.restantes} onPress={() => janelas.verMais(grupo)} />
                {EXPLICACAO[grupo] ? (
                  <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
                    {EXPLICACAO[grupo]}
                  </ThemedText>
                ) : null}
              </Animated.View>
            );
          })}
        </>
      ) : null}

      {!fechado && lote.isSuccess && !isLoading && !isError && lista.length === 0 ? (
        <EmptyState
          icon="arrow.down.doc"
          title="Nada para revisar neste arquivo"
          action={{ label: 'Importar outro arquivo', onPress: () => { setBatchId(undefined); setMarcados(null); } }}
        />
      ) : null}

      {fechado && !isError && !isLoading ? (
        <EmptyState
          icon="checkmark.circle"
          title={importados === 0 ? 'Nada importado' : `${importados} ${importados === 1 ? 'lançamento importado' : 'lançamentos importados'}`}
          hint={`${decididos.length - importados} ficaram de fora.`}
          action={{
            label: 'Importar outro arquivo',
            onPress: () => {
              setBatchId(undefined);
              setMarcados(null);
              setFalha(null);
            },
          }}
        />
      ) : null}

      {fechado && sobrando.isError ? <ErrorCard onRetry={() => void sobrando.refetch()} /> : null}

      {/* Espera o esqueleto de cima sair: chegando antes dos itens, a seção nascia embaixo dele. */}
      {fechado && !isLoading && (sobrando.data?.length ?? 0) > 0 ? (
        <View style={styles.bloco}>
          <Section title="Está no app e não veio no arquivo">
            {sobra.visiveis.map((t) => (
              <Row
                key={t.id}
                title={t.description}
                subtitle={`${formatDateBR(t.occurred_at)} · ${t.category ?? 'sem categoria'}`}
                chevron={false}
                onPress={() =>
                  showItemActions(t.description, [
                    { label: 'Abrir', onPress: () => router.push(`/finance/${t.id}`) },
                    {
                      label: 'Apagar',
                      destructive: true,
                      onPress: () =>
                        confirmDestructive(
                          'Apagar lançamento',
                          'Apagar',
                          () =>
                            apagarLancamento.mutate(t.id, {
                              onSuccess: () => {
                                void sobrando.refetch();
                                toast({ message: 'Lançamento apagado.', tone: 'success' });
                              },
                              onError: () =>
                                toast({ message: 'Não deu para apagar.', tone: 'error' }),
                            }),
                          'Ele some do financeiro. O arquivo não o trouxe, mas isso não prova que ele não existiu.'
                        ),
                    },
                  ])
                }
                trailing={
                  <Money
                    cents={t.kind === 'income' ? t.amount_cents : -t.amount_cents}
                    variant="ticker"
                    tone="auto"
                    signed
                  />
                }
              />
            ))}
          </Section>
          <VerMais restantes={sobra.restantes} onPress={sobra.verMais} />
        </View>
      ) : null}

      {/* Trocar categoria e sentido: sheet, não accordion que empurra a lista. */}
      <Sheet visible={editando !== null} onClose={() => setEditando(null)}>
          <TaskHeader
            title={editando ? nomeDoItem(editando) : 'Categoria'}
            onClose={() => setEditando(null)}
          />

          <ScrollView keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + Space.xxl }]}
          >
            {/*
              O sentido vem ANTES da categoria: ele muda o que a linha significa, e a ordem dos
              campos do projeto manda o controle que decide vir antes do que ele decide.
              Existe porque o OFX do BB marca saída como `CREDIT` — ver `useUpdateImportItem`.
            */}
            <View style={styles.sentido}>
              <SectionHead title="Tipo" />
              <Segmented
                options={[
                  { value: 'expense', label: 'Gasto' },
                  { value: 'income', label: 'Receita' },
                ]}
                value={editando?.kind === 'income' ? 'income' : 'expense'}
                onChange={(k) => editando && trocarSentido(editando, k)}
              />
            </View>

            {/* As categorias que a pessoa USA, mais as sugeridas (`finance.md`), como no lançamento. */}
            <View style={styles.sentido}>
              <CategoryPicker
                value={editando?.suggested_category ?? null}
                onChange={(cat) => editando && trocarCategoria(editando, cat)}
              />
            </View>
          </ScrollView>
      </Sheet>
    </Screen>
  );
}

/** Só onde a linha pede um cuidado que o título não diz (§7b: menos texto). */
const EXPLICACAO: Partial<Record<Grupo, string>> = {
  no_app: 'Marcar importa de novo.',
  fora: 'Marque só se quiser lançar.',
};

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.xl,
  },
  centro: {
    textAlign: 'center',
  },
  resumo: {
    gap: Space.md,
  },
  bloco: {
    gap: Space.md,
  },
  /**
   * O botão fantasma tem 36 de altura contra os 19 do título: sem a margem negativa ele esticava a
   * linha e o rótulo ficava ~20 do card, não `Space.md` (§2). O toque continua com os 36.
   */
  acaoDoGrupo: { marginVertical: -Space.sm },
  /* Só o recuo: o TAMANHO vem de `type="footnote"` no próprio texto. */
  rodape: {
    paddingHorizontal: Space.lg,
  },
  sentido: { gap: Space.md, paddingHorizontal: Space.lg },
  falha: {
    gap: Space.xs,
  },
  aviso: { gap: Space.md },
  sheetBody: {
    gap: Space.xl,
    paddingVertical: Space.lg,
  },
});
