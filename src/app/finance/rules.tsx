import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ErrorCard } from '@/components/error-card';
import { CategoryPicker } from '@/components/finance/category-picker';
import { SubcategoryField } from '@/components/finance/subcategory-field';
import { useSubcategories } from '@/hooks/use-subcategories';
import { useNoteFolders } from '@/hooks/use-notes';
import { Segmented } from '@/components/ui/segmented';
import { SelectField } from '@/components/ui/select-field';
import { separaRegras, tipoDaRegra, type TipoDeRegra } from '@/lib/regras';
import { subcategoryAfterParentChange } from '@/lib/subcategories';
import { detalheDaEscrita } from '@/lib/escrita';
import { foldCategory } from '@/lib/categories-merge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { HeaderActions } from '@/components/ui/header-actions';
import { EmptyState } from '@/components/ui/empty-state';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Field, TextField } from '@/components/ui/field';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Deslizavel } from '@/components/ui/deslizavel';
import { VerMais } from '@/components/ui/ver-mais';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { HeroLabel } from '@/components/ui/section-head';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, Type, tabular } from '@/design/tokens';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import {
  useAccounts,
  useDeleteRule,
  useRules,
  useSaveRule,
  type CategorizationRule,
} from '@/hooks/use-finance';
import { AccountPicker } from '@/components/finance/account-picker';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { transicaoDeLayout } from '@/components/motion/transicao';

/** Postgres: violação de unique. Aqui só pode ser `categorization_rules_ws_tipo_pattern_uq` (o termo, por lançamento ou nota). */
const UNIQUE_VIOLATION = '23505';

function ehGatilhoRepetido(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

interface Rascunho {
  id?: string;
  workspaceId?: string;
  subcategory_id?: string | null;
  pattern: string;
  category: string | null;
  accountId: string | null;
  /** Regra de nota (palavra -> pasta) ou de lançamento (palavra -> categoria): mesma tabela. */
  tipo: TipoDeRegra;
  folderId: string | null;
}

const VAZIO: Rascunho = { pattern: '', category: null, accountId: null, tipo: 'lancamento', folderId: null };

/**
 * Regras de categoria — a resposta do produto à queixa nº1 contra os concorrentes:
 * *"categorizou errado e não dá para consertar"*.
 *
 * A regra do usuário **ganha da IA**, e a tela diz isso em texto: `_match_rule` roda depois do
 * parse no WhatsApp e antes do Gemini na importação. `hits` é a única métrica de valor aqui —
 * regra com zero acerto é lixo, e o usuário precisa ver isso para limpar.
 */
export default function RulesScreen() {
  const toast = useToast();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const { data: rules, isLoading, isError, refetch } = useRules();
  const { data: accounts } = useAccounts();
  const { data: pastas } = useNoteFolders();
  const save = useSaveRule();
  const remove = useDeleteRule();

  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroSalvar, setErroSalvar] = useState<ReactNode>(null);
  const defaultDetails = useSubcategories(undefined, !rascunho?.id);
  const visita = useRef(0);
  const [detailVisit, setDetailVisit] = useState(0);
  const gravando = useRef(false);
  const atual = useRef(rascunho);
  const detailWorkspace = rascunho?.workspaceId ?? (!rascunho?.id && !defaultDetails.isError
    ? defaultDetails.data?.workspace_id : undefined);
  const workspaceAtual = useRef(detailWorkspace);
  useLayoutEffect(() => {
    atual.current = rascunho;
    workspaceAtual.current = detailWorkspace;
  }, [rascunho, detailWorkspace]);
  const detailOwner = `${detailVisit}:${rascunho?.id ?? 'new'}:${detailWorkspace ?? ''}`;
  const podeEditarDetalhe = Boolean(rascunho && detailWorkspace) && !save.isPending;
  const visitaAtual = (visit: number) => visita.current === visit && atual.current !== null;

  // `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch
  // falha, e sem este corte a tela seguia afirmando números embaixo da faixa de erro.
  const lista = isError ? [] : (rules ?? []);
  const totalHits = lista.reduce((soma, r) => soma + (r.hits ?? 0), 0);
  const ativas = lista.filter((r) => (r.hits ?? 0) > 0).length;
  const ehNota = rascunho?.tipo === 'nota';
  const podeSalvar = (rascunho?.pattern.trim().length ?? 0) >= 2
    && Boolean(ehNota ? rascunho?.folderId : rascunho?.category);

  const nomeConta = (id: string | null) =>
    id ? ((accounts ?? []).find((c) => c.id === id)?.name ?? 'conta') : null;

  const abrir = (rule?: CategorizationRule, tipo: TipoDeRegra = 'lancamento') => {
    visita.current += 1;
    setDetailVisit(visita.current);
    gravando.current = false;
    setErroSalvar(null);
    setRascunho(
      rule
        ? {
            id: rule.id,
            workspaceId: rule.workspace_id,
            ...detalheDaEscrita(rule),
            pattern: rule.pattern,
            category: rule.category,
            accountId: rule.account_id,
            tipo: tipoDaRegra(rule),
            folderId: rule.folder_id ?? null,
          }
        : { ...VAZIO, tipo }
    );
  };

  const fechar = () => {
    visita.current += 1;
    setDetailVisit(visita.current);
    atual.current = null;
    setRascunho(null);
    setErroSalvar(null);
  };

  const salvar = () => {
    if (!rascunho || !podeSalvar || gravando.current || save.isPending) return;
    if (!ehNota && !detailWorkspace) return;
    const owner = visita.current;
    gravando.current = true;
    setErroSalvar(null);
    save.mutate(
      {
        id: rascunho.id,
        pattern: rascunho.pattern.trim(),
        category: ehNota ? null : rascunho.category!,
        folderId: ehNota ? rascunho.folderId : null,
        accountId: ehNota ? null : rascunho.accountId,
        workspaceId: ehNota ? rascunho.workspaceId : detailWorkspace,
        ...(ehNota ? {} : detalheDaEscrita(rascunho)),
      },
      {
        onSuccess: () => {
          if (!visitaAtual(owner)) return;
          gravando.current = false;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          fechar();
        },
        onError: (err) => {
          if (!visitaAtual(owner)) return;
          gravando.current = false;
          // Erro adivinhado ("regra repetida?") é o app chutando. O motivo real é o unique da
          // `0017`, e dá para dizer QUAL regra já existe.
          if (ehGatilhoRepetido(err)) {
            const existente = lista.find(
              (r) => r.pattern.toLowerCase() === rascunho.pattern.trim().toLowerCase()
                && tipoDaRegra(r) === rascunho.tipo
            );
            setErroSalvar(
              existente
                ? <>Já existe uma regra para <Forte>{existente.pattern}</Forte> → {destinoDaRegra(existente)}. Edite ela em vez de criar outra.</>
                : 'Já existe uma regra com esse gatilho.'
            );
            return;
          }
          setErroSalvar('Não deu para salvar. Tenta de novo.');
          toast({ message: 'Não deu para salvar a regra.', tone: 'error' });
        },
      }
    );
  };

  const apagar = (rule: CategorizationRule) =>
    confirmDestructive(
      tipoDaRegra(rule) === 'nota'
        ? `Parar de mandar para a pasta as notas que citam ${rule.pattern}?`
        : `Parar de categorizar ${rule.pattern} automaticamente?`,
      'Apagar regra',
      () =>
        remove.mutate(rule.id, {
          onSuccess: () => toast({ message: 'Regra apagada.', tone: 'success' }),
          // Hoje apagar falha em silêncio: a linha some da UI e volta na próxima query.
          onError: () => toast({ message: 'Não deu para apagar a regra.', tone: 'error' }),
        }),
      tipoDaRegra(rule) === 'nota'
        ? 'As notas já guardadas continuam onde estão.'
        : 'Os lançamentos já categorizados continuam como estão.'
    );

  /** O menu da regra, UMA lista para o toque longo e o arrasto. */
  const destinoDaRegra = (rule: CategorizationRule) =>
    tipoDaRegra(rule) === 'nota' ? `pasta ${rule.note_folders?.name ?? ''}`.trim() : (rule.category ?? 'sem categoria');
  const tituloDaRegra = (rule: CategorizationRule) => `${rule.pattern} → ${destinoDaRegra(rule)}`;
  const acoesDaRegra = (rule: CategorizationRule): ItemAction[] => [
    { label: 'Editar', icon: 'pencil', arrasto: 'direita', onPress: () => abrir(rule) },
    { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => apagar(rule) },
  ];
  const acoes = (rule: CategorizationRule) => showItemActions(tituloDaRegra(rule), acoesDaRegra(rule));

  const legenda = (rule: CategorizationRule) => {
    const conta = nomeConta(rule.account_id);
    return [
      rule.subcategory_id && rule.subcategories?.name ? rule.subcategories.name : null,
      rule.hits > 0 ? `aplicada ${rule.hits}x` : 'ainda não pegou nada',
      conta ? `só em ${conta}` : null,
      rule.source === 'learned' ? 'aprendida' : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const faixa = lista.length > 0 ? (
    <View style={styles.faixa}>
      <ThemedText type="small" themeColor="textSecondary">
        Sua regra ganha da IA.
      </ThemedText>
    </View>
  ) : null;

  const erro = isError ? <ErrorCard onRetry={refetch} /> : null;
  const loading = isLoading && !isError ? (
    <>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : null;
  const destaque = totalHits > 0 ? (
    <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
      <Card style={styles.hero}>
        <HeroLabel>O que suas regras já pouparam</HeroLabel>
        <ThemedText style={[Type.title, tabular]}>{totalHits}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {totalHits === 1 ? 'categorizado' : 'categorizados'} · {ativas}{' '}
          {ativas === 1 ? 'regra' : 'regras'}
        </ThemedText>
      </Card>
    </Animated.View>
  ) : null;
  // Aos poucos (24/09/2026): o agente cria regra sozinho, e a lista cresce.
  const { lancamentos, notas } = separaRegras(lista);
  const regrasDeLancamento = useAosPoucos(lancamentos);
  const regrasDeNota = useAosPoucos(notas);
  const secao = (
    titulo: string,
    tipo: TipoDeRegra,
    janela: ReturnType<typeof useAosPoucos<CategorizationRule>>,
    total: number,
    vazioTitulo: string,
    vazioDica: string,
  ) => (
    <View style={styles.lista}>
      <Section title={titulo}>
        {janela.visiveis.map((rule, index) => (
          <Animated.View
            key={rule.id}
            layout={transicaoDeLayout}
            entering={FadeInDown.duration(Motion.duration.slow).delay(
              Math.min(index * Motion.stagger.step, Motion.stagger.cap)
            )}
          >
            <Deslizavel titulo={tituloDaRegra(rule)} acoes={acoesDaRegra(rule)}>
              <Row
                title={`${rule.pattern}  →  ${destinoDaRegra(rule)}`}
                subtitle={legenda(rule)}
                icon={tipo === 'nota' ? 'folder' : 'text.badge.checkmark'}
                chevron={false}
                accessibilityLabel={tipo === 'nota'
                  ? `Quando a nota citar ${rule.pattern}, guardar na ${destinoDaRegra(rule)}, ${legenda(rule)}`
                  : `Quando contiver ${rule.pattern}, categorizar como ${destinoDaRegra(rule)}, ${legenda(rule)}`}
                onPress={() => abrir(rule)}
                onLongPress={() => acoes(rule)}
              />
            </Deslizavel>
          </Animated.View>
        ))}
      </Section>
      {total === 0 ? (
        <EmptyState
          compacto
          icon={tipo === 'nota' ? 'folder' : 'text.badge.checkmark'}
          title={vazioTitulo}
          hint={vazioDica}
          action={{ label: 'Nova regra', onPress: () => abrir(undefined, tipo) }}
        />
      ) : null}
      <VerMais restantes={janela.restantes} onPress={janela.verMais} />
    </View>
  );
  const mostraSecoes = !isLoading && !isError;
  const regraRows = mostraSecoes ? (
    <>
      {secao('Lançamentos', 'lancamento', regrasDeLancamento, lancamentos.length,
        'Nenhuma regra de lançamento', 'Ex.: *posto* sempre vira transporte.')}
      {secao('Notas', 'nota', regrasDeNota, notas.length,
        'Nenhuma regra de nota', 'Ex.: nota que cita *academia* vai para a pasta saúde.')}
    </>
  ) : null;
  const ruleList = <View style={styles.paneBody}>{erro}{loading}{regraRows}</View>;
  const ruleContext = <View style={styles.paneBody}>{faixa}{destaque}</View>;
  const compactBody = <>{faixa}{erro}{loading}{destaque}{regraRows}</>;
  const tabletBody = (
    <AdaptivePanes
      main={ruleList}
      support={faixa || destaque ? ruleContext : undefined}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="rules-tablet-workspace"
    />
  );

  return (
    <Screen grouped wide={tablet} onRefresh={refetch}>
      <Stack.Screen
        options={{
          title: 'Regras',
        }}
      />

      <HeaderActions actions={[{ label: 'Nova regra', icon: 'plus', onPress: () => abrir() }]} />

      {tablet ? tabletBody : compactBody}

      {/* Form sheet: o formulário deixa de empurrar a lista para baixo quando abre. */}
      <Sheet visible={rascunho !== null} onClose={fechar}>

          <TaskHeader
            title={rascunho?.id ? 'Editar regra' : 'Nova regra'}
            onClose={fechar}
            action={
              <Button
                label="Salvar"
                size="sm"
                loading={save.isPending}
                disabled={!podeSalvar || (!ehNota && !detailWorkspace)}
                onPress={salvar}
              />
            }
          />

          <SheetScroll
            contentContainerStyle={[styles.sheetBody, { paddingBottom: Space.xxl }]}
            keyboardShouldPersistTaps="handled"
          >
            <Segmented
              options={[
                { value: 'lancamento', label: 'Lançamento' },
                { value: 'nota', label: 'Nota' },
              ]}
              value={rascunho?.tipo ?? 'lancamento'}
              onChange={(tipo) => setRascunho((atual) => (atual ? { ...atual, tipo } : atual))}
            />
            <Field
              label={ehNota ? 'Quando a nota citar' : 'Quando o lançamento contiver'} obrigatorio
              error={erroSalvar ?? undefined}
            >
              <TextField
                value={rascunho?.pattern ?? ''}
                onChangeText={(pattern) =>
                  setRascunho((atual) => (atual ? { ...atual, pattern } : atual))
                }
                placeholder="Ex.: padaria"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                invalid={Boolean(erroSalvar)}
              />
            </Field>

            {ehNota ? (
              <Field label="Guardar na pasta" obrigatorio>
                <SelectField
                  options={(pastas ?? []).map((f) => ({ id: f.id, label: f.name, icon: 'folder' as const }))}
                  value={rascunho?.folderId ?? null}
                  onChange={(folderId) => setRascunho((atual) => (atual ? { ...atual, folderId } : atual))}
                  placeholder="Escolher pasta"
                />
              </Field>
            ) : (
            <>
            <Field label="Categorizar como" obrigatorio error={!detailWorkspace && rascunho?.id
              ? 'Não consegui conferir o espaço desta regra. Reabra a lista para tentar novamente.'
              : !rascunho?.id && defaultDetails.isError ? 'Não consegui consultar os detalhes. Tente novamente.' : undefined}>
              <CategoryPicker
                value={rascunho?.category ?? null}
                onChange={(category) => {
                  if (!visitaAtual(detailVisit) || gravando.current || save.isPending) return;
                  const current = atual.current;
                  if (!current) return;
                  const next = { ...current, category,
                    ...(Object.hasOwn(current, 'subcategory_id') ? { subcategory_id: subcategoryAfterParentChange(
                      current.subcategory_id ?? null, current.category, category) } : {}) };
                  atual.current = next;
                  setRascunho(next);
                }}
              />
            </Field>
            {!rascunho?.id && defaultDetails.isError ? <Button label="Tentar novamente" variant="secondary" size="sm"
              onPress={() => { void defaultDetails.refetch(); }} /> : null}
            <SubcategoryField parent={rascunho?.category ?? null} value={rascunho?.subcategory_id ?? null}
              workspaceId={detailWorkspace} sessionKey={detailOwner} enabled={podeEditarDetalhe}
              onChange={(subcategory_id) => {
                if (!visitaAtual(detailVisit) || gravando.current || !podeEditarDetalhe
                  || workspaceAtual.current !== detailWorkspace
                  || foldCategory(atual.current?.category ?? '') !== foldCategory(rascunho?.category ?? '')) return;
                const current = atual.current;
                if (!current) return;
                const next = { ...current, subcategory_id };
                atual.current = next;
                setRascunho(next);
              }} />

            {(accounts ?? []).length > 0 ? (
              <Field label="Só nesta conta">
                <AccountPicker
                  accounts={accounts ?? []}
                  value={rascunho?.accountId ?? null}
                  onChange={(accountId: string | null) =>
                    setRascunho((atual) => (atual ? { ...atual, accountId } : atual))
                  }
                  emptyLabel="Em todas as contas"
                />
              </Field>
            ) : null}
            </>
            )}
          </SheetScroll>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lista: { gap: Space.md },
  paneBody: {
    gap: Space.xl,
    minWidth: 0,
  },
  faixa: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
  },
  hero: {
    gap: Space.xs,
  },
  sheet: {
    flex: 1,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
});
