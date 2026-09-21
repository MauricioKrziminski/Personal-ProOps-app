import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatActions } from '@/components/agent/chat-actions';
import { AgentChatStart } from '@/components/agent/agent-chat-start';
import { AgentThreadHeading } from '@/components/agent/agent-thread-heading';
import { ChatComposer } from '@/components/agent/chat-composer';
import { ChatMessage } from '@/components/agent/chat-message';
import { RenameConversationSheet } from '@/components/agent/rename-conversation-sheet';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth } from '@/constants/theme';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { Icon } from '@/components/ui/icon';
import { TAB_BAR_SPACE } from '@/components/ui/pill-tab-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Radius, Space } from '@/design/tokens';
import {
  agentKeys,
  useAgentMessages,
  useCreateAgentConversation,
  useDeleteAgentConversation,
  useRenameAgentConversation,
  useResolveAgentPending,
  useSendAgentMessage,
  useTurnoLocal,
} from '@/hooks/use-agent-chat';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import {
  AgentApiError,
  AgentAuthExpiredError,
  type AgentMessage,
  type AgentTurn,
} from '@/lib/agent-api';
import {
  abrirConversaNova,
  conversationRoute,
  falhaDoTurno,
  newClientMessageId,
  retryDoTurno,
  sementeDaConversa,
  tituloProvisorio,
  isNearChatEnd,
  parseUiActions,
  prependMessagePage,
  type UiOption,
} from '@/lib/agent-chat';
import { confirmDestructive } from '@/lib/item-actions';


interface Props {
  /** `undefined` na tela `new`: a conversa ainda não existe. */
  conversationId?: string;
  /** Frase pronta vinda de um atalho. Só semeia o campo. */
  initialText?: string;
  title?: string;
  /** A conversa nova mora na própria aba e deixa a dock visível. */
  tabMode?: boolean;
}

/** O lease do turno no servidor dura 300s. Depois disso ninguém está rodando. */
const LEASE_MS = 300_000;

type Item =
  | { key: string; kind: 'user' | 'assistant'; message: AgentMessage }
  | { key: string; kind: 'processing' }
  | { key: string; kind: 'failed'; texto: string; retryable: boolean };

/**
 * A conversa — a mesma tela para `new` e para `[id]`.
 *
 * Um componente só porque as duas fazem exatamente a mesma coisa: mostram o
 * histórico (vazio, no caso de `new`), escrevem uma mensagem e esperam a
 * resposta. A ÚNICA diferença é qual mutation o primeiro envio chama, e duplicar
 * a tela por causa disso seria duplicar também o retry, o `Pensando...`, o HITL
 * e o scroll — quatro lugares para divergir.
 *
 * `new` não grava nada antes do primeiro envio: abrir e voltar não deixa
 * conversa vazia na lista, e é por isso que a criação carrega a mensagem junto.
 */
export function ConversationScreen({ conversationId, initialText = '', title, tabMode = false }: Props) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const lista = useRef<FlashListRef<Item>>(null);

  const [texto, setTexto] = useState(initialText);
  const [erro, setErro] = useState<AgentApiError | null>(null);
  const [desistiu, setDesistiu] = useState(false);
  const [perto, setPerto] = useState(true);
  const [renomeando, setRenomeando] = useState(false);
  // O sticky translada a barra sem encolher sua posição no layout. A lista
  // precisa de uma JANELA menor; padding no conteúdo não muda o alinhamento
  // inferior de conversas curtas feito pela FlashList.
  const alturaDoTeclado = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const obstrucao = Math.max(0, alturaDoTeclado - insets.bottom);
  const entradaDaAba = tabMode && !conversationId;

  const turno = useTurnoLocal();
  const criar = useCreateAgentConversation();
  const enviar = useSendAgentMessage(conversationId ?? '');
  const resolver = useResolveAgentPending(conversationId ?? '');
  const renomear = useRenameAgentConversation();
  const excluir = useDeleteAgentConversation();
  const historico = useAgentMessages(conversationId);

  const mensagens = useMemo(
    () =>
      (historico.data?.pages ?? []).reduce<AgentMessage[]>(
        // A paginação anda para trás: cada página nova é MAIS VELHA que a
        // anterior, então ela entra no começo.
        (acc, p) => prependMessagePage(acc, p.items),
        [],
      ),
    [historico.data],
  );

  const local = turno.turno;

  /** A última coisa que o usuário mandou — a âncora do turno em aberto. */
  const ultimaDoUsuario = useMemo(
    () => [...mensagens].reverse().find((m) => m.role === 'user'),
    [mensagens],
  );

  /**
   * A mesma mensagem, já gravada pelo servidor.
   *
   * É ela que substitui um estado `processando` na tela: enquanto ela não
   * existe, o balão é o local; enquanto ela está `processing`, o turno ainda
   * roda — inclusive quando quem está rodando é OUTRO worker e a mutation já
   * voltou. Derivar do cache em vez de guardar um booleano é o que faz o
   * `Pensando...` sumir sozinho quando a resposta chega pela releitura.
   */
  const espelho = local
    ? mensagens.find((m) => m.client_message_id === local.clientMessageId)
    : undefined;

  /**
   * O turno que ainda não terminou, venha de onde vier.
   *
   * `local` cobre o envio desta sessão da tela. O segundo ramo cobre o caso que
   * um estado em memória NUNCA cobriria: a pessoa fechou o app com a mensagem
   * `processing` (lease morto) ou `failed` e voltou depois. O UUID que torna o
   * retry idempotente está gravado na própria linha — sem lê-lo de volta, o
   * "Tentar novamente" sumiria justamente quando ele é mais necessário.
   */
  const emVoo = useMemo(
    () =>
      local ??
      (ultimaDoUsuario?.status !== 'completed' && ultimaDoUsuario?.client_message_id
        ? {
            clientMessageId: ultimaDoUsuario.client_message_id,
            content: ultimaDoUsuario.content,
          }
        : null),
    [local, ultimaDoUsuario],
  );

  const noBanco = local ? espelho : ultimaDoUsuario;
  const noServidor = noBanco?.status === 'processing';
  // `criar` fica de fora: a criação navega no toque, e o estado dela chega à
  // tela de destino pelo CACHE (`noServidor`). Contá-lo aqui deixaria o
  // compositor da aba travado enquanto a conversa roda em outra tela.
  const rodando = enviar.isPending || resolver.isPending || noServidor;

  const ultima = mensagens[mensagens.length - 1];
  const pergunta = ultima?.role === 'assistant' ? ultima.ui_payload : null;
  /**
   * Uma pergunta de HITL aberta trava o campo: a resposta dela sai dos botões.
   *
   * ⚠️ **Pergunta de RASCUNHO não trava, e isso é o desenho.** Ali os botões são
   * atalho para o que já existe — digitar continua sendo resposta válida, e é
   * assim que se escolhe um cartão que não coube na lista ou se cria um novo
   * ("digita o nome de outro cartão"). Travar o campo transformaria a lista de
   * cartões existentes na única resposta possível.
   */
  const esperandoAcao = Boolean(pergunta?.pending_id && !pergunta.resolved);

  // O teto do lease. Sem ele, um turno que morreu no servidor deixaria a tela
  // com "Pensando..." para sempre, e ele nunca viraria um botão. A contagem sai
  // do `created_at` da mensagem, não da montagem: quem reabre o app com um turno
  // travado de ontem não espera mais cinco minutos para ver o botão.
  const desde = noBanco?.created_at ?? null;
  useEffect(() => {
    if (!rodando) return;
    const inicio = desde ? Date.parse(desde) : Date.now();
    const t = setTimeout(() => setDesistiu(true), Math.max(0, LEASE_MS - (Date.now() - inicio)));
    return () => clearTimeout(t);
  }, [rodando, desde]);

  const disparar = useCallback(
    (t: { clientMessageId: string; content: string }) => {
      setErro(null);
      setDesistiu(false);
      enviar.mutate(
        { clientMessageId: t.clientMessageId, content: t.content },
        {
          onSuccess: (resultado: AgentTurn) => {
            // `processing` significa que outro worker já roda ESTE turno. Não há
            // nada a reenviar; o `Pensando...` continua porque a mensagem no
            // cache continua `processing`, e a releitura o encerra.
            if (resultado.status !== 'processing') turno.concluir();
          },
          onError: (e: Error) => {
            // A sessão acabou: o `signOut()` já rodou e o portão do `_layout` vai
            // desmontar esta tela. Um toast aqui apareceria depois dela sumir.
            if (e instanceof AgentAuthExpiredError) return;
            const api = e as AgentApiError;
            setErro(api);
            if (api.policy?.paywall) router.push('/paywall');
          },
        },
      );
    },
    [enviar, turno],
  );

  const submeter = useCallback(() => {
    const conteudo = texto.trim();
    setTexto('');
    if (conversationId) {
      disparar(turno.iniciar(conteudo));
      return;
    }
    // Conversa nova: a tela da conversa abre NO TOQUE, com a mensagem já no
    // cache dela. Nenhum callback no `.mutate()` — o resultado chega pelo cache
    // (callbacks do hook), e na aba um callback aqui abriria o paywall duas vezes.
    abrirConversaNova(conteudo, {
      gerarId: newClientMessageId,
      semear: (id, t) =>
        qc.setQueryData(agentKeys.messages(id), sementeDaConversa(t.clientMessageId, t.content)),
      enviar: (v) => criar.mutate(v),
      // A raiz da aba precisa continuar na pilha para o Android voltar à
      // conversa nova. A rota /agent/new já ocupa um detalhe e é substituída.
      navegar: (id) => (tabMode ? router.push(conversationRoute(id)) : router.replace(conversationRoute(id))),
    });
  }, [conversationId, criar, disparar, qc, tabMode, texto, turno]);

  const tentarDeNovo = useCallback(() => {
    // O MESMO UUID de antes. Gerar um novo criaria um segundo lançamento do que
    // talvez já tenha rodado no servidor — a idempotência mora nessa chave, e o
    // servidor responde a ela com `recover_turn` em vez de reexecutar.
    if (!emVoo) return;
    if (conversationId && retryDoTurno(mensagens) === 'criar') {
      // A criação ainda não voltou do servidor: repete o POST com o MESMO par
      // (id da conversa + cmid). O estado sai do cache, como no primeiro envio.
      setDesistiu(false);
      criar.mutate({ id: conversationId, clientMessageId: emVoo.clientMessageId, content: emVoo.content });
      return;
    }
    disparar(emVoo);
  }, [conversationId, criar, disparar, emVoo, mensagens]);

  // 404 na criação: este id não é uma conversa desta pessoa. Ficar aqui seria
  // uma tela vazia sem saída; volta para o Agente e diz o que houve.
  const saiu = useRef(false);
  const sair = conversationId && noBanco?.status === 'failed' && falhaDoTurno(noBanco).sair;
  useEffect(() => {
    if (!sair || saiu.current) return;
    saiu.current = true;
    toast({ message: 'Não deu para abrir essa conversa.', tone: 'error' });
    if (router.canGoBack()) router.back();
    else router.replace('/agent');
  }, [sair, toast]);

  // O cabeçalho nasce com o título que o servidor VAI dar (mesma regra) e não
  // some enquanto a lista de conversas é relida — sem salto de layout.
  const provisorio =
    mensagens.length > 0 && retryDoTurno(mensagens) === 'criar'
      ? tituloProvisorio(mensagens[0].content)
      : undefined;
  const [tituloVisto, setTituloVisto] = useState<string | undefined>(undefined);
  const tituloAtual = title ?? provisorio;
  if (tituloAtual && tituloAtual !== tituloVisto) setTituloVisto(tituloAtual);
  const titulo = tituloAtual ?? tituloVisto;

  const decidir = useCallback(
    (mensagem: AgentMessage, opcao: UiOption) => {
      if (opcao.decision === 'draft') {
        // Rascunho não tem rota de resolução: o clique é uma MENSAGEM levando o
        // id cru do botão. O rótulo vira o texto do balão do usuário, como no
        // HITL — quem reabrir a conversa amanhã precisa ver o que respondeu, não
        // um payload.
        //
        // O mesmo par que `disparar` faz antes de todo envio: sem ele o
        // "demorou demais" do turno ANTERIOR fica na tela embaixo da resposta
        // que acabou de chegar (visto no emulador em 15/09/2026).
        setErro(null);
        setDesistiu(false);
        enviar.mutate(
          { clientMessageId: turno.novoId(), content: opcao.label, clickedId: opcao.id },
          {
            onError: (e: Error) => {
              if (e instanceof AgentAuthExpiredError) return;
              const api = e as AgentApiError;
              if (api.policy?.paywall) {
                router.push('/paywall');
                return;
              }
              toast({ message: 'Não deu para responder agora.', tone: 'error' });
            },
          },
        );
        return;
      }
      const pendingId = mensagem.ui_payload?.pending_id;
      if (!pendingId) return;
      resolver.mutate(
        {
          pendingId,
          clientMessageId: turno.novoId(),
          decision: opcao.decision,
          candidateId: opcao.candidateId,
        },
        {
          onError: (e: Error) => {
            if (e instanceof AgentAuthExpiredError) return;
            const api = e as AgentApiError;
            if (api.policy?.paywall) {
              router.push('/paywall');
              return;
            }
            // Sem retry aqui de propósito: a pergunta continua aberta e os
            // botões continuam na tela, que já são o "tentar de novo" dela.
            toast({
              message:
                api.status === 422
                  ? 'Essa confirmação expirou.'
                  : 'Não deu para responder agora.',
              tone: 'error',
            });
          },
        },
      );
    },
    [enviar, resolver, toast, turno],
  );

  const itens = useMemo<Item[]>(() => {
    const out: Item[] = mensagens.map((m) => ({ key: m.id, kind: m.role, message: m }));
    // O balão local só existe ENQUANTO o servidor não gravou o dele. Mantê-lo
    // depois duplicaria a mensagem na tela; guardá-lo no cache faria o mesmo.
    if (local && !espelho) {
      out.push({
        key: `local:${local.clientMessageId}`,
        kind: 'user',
        message: {
          id: `local:${local.clientMessageId}`,
          role: 'user',
          content: local.content,
          status: 'processing',
        },
      });
    }

    const falha = erro
      ? { texto: erro.message, retryable: erro.policy.retryable }
      : desistiu
        ? { texto: 'Essa mensagem demorou demais.', retryable: true }
        : noBanco?.status === 'failed'
          ? falhaDoTurno(noBanco)
          : null;

    if (falha) {
      out.push({
        key: 'falhou',
        kind: 'failed',
        texto: falha.texto,
        retryable: falha.retryable && Boolean(emVoo),
      });
    } else if (rodando) {
      out.push({ key: 'pensando', kind: 'processing' });
    }
    return out;
  }, [mensagens, local, espelho, erro, desistiu, noBanco, emVoo, rodando]);

  const desenharLinha = useCallback(
    ({ item }: { item: Item }) => (
      <View style={styles.messageFrame}>
        <Linha item={item} busy={rodando} onDecide={decidir} onRetry={tentarDeNovo} />
      </View>
    ),
    // A identidade precisa ser estável: sem isso cada tecla digitada no composer
    // devolveria um `renderItem` novo e a conversa inteira remontaria.
    [rodando, decidir, tentarDeNovo],
  );

  const aoRolar = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const novo = isNearChatEnd({
      contentOffset: contentOffset.y,
      layoutHeight: layoutMeasurement.height,
      contentHeight: contentSize.height,
    });
    // Só troca quando o booleano muda: `onScroll` dispara dezenas de vezes por
    // rolagem e um `setState` por evento remontaria a conversa inteira.
    setPerto((atual) => (atual === novo ? atual : novo));
  }, []);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = historico;
  const carregarAnteriores = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const acoesDoHeader = conversationId
    ? [
        { label: 'Renomear', icon: 'pencil' as const, onPress: () => setRenomeando(true) },
        {
          label: 'Excluir',
          icon: 'trash' as const,
          destructive: true,
          onPress: () =>
            confirmDestructive(
              'Excluir conversa?',
              'Excluir',
              () =>
                excluir.mutate(conversationId, {
                  onSuccess: () => router.replace('/agent/history'),
                  onError: (e) =>
                    toast({
                      message:
                        (e as AgentApiError).status === 409
                          ? 'O turno ainda está terminando. Tenta em instantes.'
                          : 'Não deu para excluir a conversa.',
                      tone: 'error',
                    }),
                }),
              'O histórico e as confirmações pendentes desta conversa serão apagados.',
            ),
        },
      ]
    : [];

  return (
    <View style={[
      styles.raiz,
      { backgroundColor: theme.background },
      tabMode && Platform.OS === 'android' ? { paddingBottom: TAB_BAR_SPACE + insets.bottom } : null,
    ]}>
      {!tabMode ? <Stack.Screen options={{ title: conversationId ? 'Conversa' : 'Nova conversa' }} /> : null}
      {!tabMode ? <HeaderActions
        actions={[
          {
            label: 'Histórico de conversas',
            icon: 'clock.arrow.circlepath',
            onPress: () => router.push('/agent/history'),
          },
        ]}
        menu={conversationId ? {
          title: 'Conversa',
          actions: [
            { label: 'Nova conversa', icon: 'square.and.pencil', onPress: () => router.replace('/agent/new') },
            ...acoesDoHeader,
          ],
        } : undefined}
      /> : null}

      {conversationId && titulo ? <AgentThreadHeading title={titulo} /> : null}

      {entradaDaAba ? (
        <KeyboardAwareScrollView
          style={styles.lista}
          contentContainerStyle={styles.entradaScroll}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          bottomOffset={Space.xl}>
          <AgentChatStart
            onSelectPrompt={setTexto}
            composer={
              <ChatComposer
                inline
                value={texto}
                onChangeText={setTexto}
                onSubmit={submeter}
                sending={rodando}
                awaitingAction={esperandoAcao}
              />
            }
          />
        </KeyboardAwareScrollView>
      ) : (
        <>
          <View style={[styles.lista, { paddingBottom: obstrucao }]}>
            {historico.isPending && conversationId ? (
              <View style={styles.esqueleto}>
                {/* Alturas diferentes de propósito: o esqueleto tem a FORMA da
                    conversa (pergunta curta, resposta longa), não três barras iguais. */}
                {[70, 44, 90].map((h) => (
                  <Skeleton key={h} height={h} radius={Radius.md} />
                ))}
              </View>
            ) : historico.isError && !historico.data ? (
              <EmptyState
                icon="exclamationmark.triangle"
                title="Não consegui carregar essa conversa"
                hint="Confere a conexão e tenta de novo."
                action={{ label: 'Tentar novamente', onPress: () => historico.refetch() }}
              />
            ) : (
              <ConversationTimeline
                key={conversationId ?? 'new'}
                listRef={lista}
                items={itens}
                renderItem={desenharLinha}
                onScroll={aoRolar}
                onStartReached={carregarAnteriores}
                onSelectPrompt={setTexto}
              />
            )}

            {!perto ? (
              <Pressable
                onPress={() => lista.current?.scrollToEnd({ animated: true })}
                accessibilityRole="button"
                accessibilityLabel="Ir para a mensagem mais recente"
                style={[
                  styles.irAoFim,
                  {
                    bottom: obstrucao + Space.sm,
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.cardBorder,
                  },
                ]}>
                <Icon name="arrow.down" size={18} color="text" />
              </Pressable>
            ) : null}
          </View>

          <ChatComposer
            value={texto}
            onChangeText={setTexto}
            onSubmit={submeter}
            sending={rodando}
            awaitingAction={esperandoAcao}
          />
        </>
      )}

      <RenameConversationSheet
        key={renomeando ? 'aberto' : 'fechado'}
        visible={renomeando}
        initialTitle={titulo ?? ''}
        saving={renomear.isPending}
        onClose={() => setRenomeando(false)}
        onSave={(novo) => {
          if (!conversationId) return;
          renomear.mutate(
            { id: conversationId, title: novo },
            {
              onSuccess: () => setRenomeando(false),
              onError: () =>
                toast({ message: 'Não deu para renomear a conversa.', tone: 'error' }),
            },
          );
        }}
      />
    </View>
  );
}

/**
 * A âncora inicial pertence ao ciclo de vida da lista, não ao número atual de
 * mensagens. A quinta mensagem não muda a posição de uma conversa em leitura.
 */
function ConversationTimeline({
  listRef,
  items,
  renderItem,
  onScroll,
  onStartReached,
  onSelectPrompt,
}: {
  listRef: RefObject<FlashListRef<Item> | null>;
  items: Item[];
  renderItem: ({ item }: { item: Item }) => ReactElement;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onStartReached: () => void;
  onSelectPrompt: (prompt: string) => void;
}) {
  const [startAtBottom] = useState(() => items.length > 4);
  return (
    <FlashList
      ref={listRef}
      style={styles.lista}
      data={items}
      keyExtractor={(item) => item.key}
      getItemType={(item) => item.kind}
      renderItem={renderItem}
      contentContainerStyle={{ paddingHorizontal: Space.lg, paddingVertical: Space.md }}
      onScroll={onScroll}
      scrollEventThrottle={64}
      maintainVisibleContentPosition={{
        startRenderingFromBottom: startAtBottom,
        autoscrollToBottomThreshold: 0.2,
      }}
      onStartReachedThreshold={0.3}
      onStartReached={onStartReached}
      ListEmptyComponent={<AgentChatStart onSelectPrompt={onSelectPrompt} />}
    />
  );
}

/** Uma linha da conversa. Fora do componente-pai para não remontar a cada tecla. */
const Linha = memo(function Linha({
  item,
  busy,
  onDecide,
  onRetry,
}: {
  item: Item;
  busy: boolean;
  onDecide: (m: AgentMessage, o: UiOption) => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  if (item.kind === 'processing') {
    return (
      // Uma linha ESTÁVEL, sem bolha entrando e saindo: o que muda é o texto, e
      // a lista não se mexe. `polite` para o leitor de tela anunciar sem cortar
      // o que estava lendo.
      <View style={[styles.status, styles.statusBusy]} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={theme.textSecondary} />
        <ThemedText type="footnote" themeColor="textSecondary">
          Organizando sua resposta…
        </ThemedText>
      </View>
    );
  }

  if (item.kind === 'failed') {
    return (
      <View style={styles.status}>
        <ThemedText type="footnote" themeColor="danger">
          {item.texto}
        </ThemedText>
        {item.retryable ? (
          <Button label="Tentar novamente" variant="secondary" size="sm" onPress={onRetry} />
        ) : null}
      </View>
    );
  }

  const { body, options } = parseUiActions(item.message.ui_payload);
  return (
    <View style={styles.item}>
      {/*
        Com botões, o balão mostra o `body` e não o `content`: o `content` é o
        texto numerado do WhatsApp ("1) ... responde com o número"), que aqui
        seria a mesma pergunta escrita duas vezes.
      */}
      <ChatMessage
        role={item.kind}
        content={options.length > 0 && body ? body : item.message.content}
      />
      {item.message.ui_payload ? (
        <ChatActions
          payload={item.message.ui_payload}
          busy={busy}
          onDecide={(o) => onDecide(item.message, o)}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  raiz: { flex: 1 },
  lista: { flex: 1 },
  entradaScroll: { paddingBottom: Space.xxxl },
  messageFrame: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  item: { paddingVertical: Space.lg },
  status: { paddingVertical: Space.lg, gap: Space.sm, alignItems: 'flex-start' },
  statusBusy: { flexDirection: 'row', alignItems: 'center' },
  esqueleto: { padding: Space.lg, gap: Space.md },
  irAoFim: {
    position: 'absolute',
    right: Space.lg,
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
