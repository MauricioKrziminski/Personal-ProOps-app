import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { GradeDeCores } from '@/components/notes/color-picker';
import { useCoresSuaves } from '@/components/motion/cores-suaves';
import { Presenca, TrocaSuave } from '@/components/motion/presenca';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { ExpenseClassificationControls } from '@/components/finance/expense-classification-controls';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Forte } from '@/components/ui/forte';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row } from '@/components/ui/row';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import type { NoteColorName } from '@/constants/theme';
import { noteInk } from '@/design/note-colors';
import { HitTarget, IconSize, Radius, Space } from '@/design/tokens';
import { useCategoriesUsed, useSalvarCategoria } from '@/hooks/use-finance';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { foldCategory } from '@/lib/categories-merge';
import { aparenciaDaCategoria, ICONES_DE_CATEGORIA, nomeDaCategoria, ROTULO_DO_ICONE, type Categoria } from '@/lib/categorias';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive } from '@/lib/item-actions';
import { newClientMessageId } from '@/lib/agent-chat';
import {
  categoryBackfillPeriod, categoryConfigurationAttempt, categoryConfigurationKey, categoryDefaults,
  type CategoryConfigurationAttempt, type CategoryConfigurationInput, type CategoryConfigurationResult,
} from '@/lib/category-configuration';
import {
  EXPENSE_PATTERN_LABELS, EXPENSE_NECESSITY_LABELS,
} from '@/lib/expense-classification';

const SCOPE_OPTIONS: readonly SelectOption[] = [
  { id: 'new', label: 'Só novos cadastros', meta: 'Conserva contratos e histórico' },
  { id: 'period', label: 'Aplicar ao histórico', meta: 'Escolher um período' },
];
type ConfigurationCommand = Omit<CategoryConfigurationInput, 'requestId'>;

/**
 * Criar ou editar uma categoria: aparência e padrões independentes de gastos (F06). Usada pela tela
 * Categorias e pelo "+ Nova" do seletor de categoria.
 *
 * A cor entra INLINE (`GradeDeCores`): esta folha já é um `Modal`, e abrir o `ColorPicker` aqui
 * seria folha dentro de folha — no Android ela abre no lugar errado.
 *
 * Renomear para um nome que já é outra categoria (sem acento e sem caixa) é JUNTAR as duas, e a
 * folha pergunta antes: o banco recusa com `CATEGORIA_EXISTE` e só junta com a resposta.
 */
export function CategoriaSheet({
  visible,
  categoria,
  onClose,
  onSalva,
}: {
  visible: boolean;
  /** `null` = nova. */
  categoria: Categoria | null;
  onClose: () => void;
  /** O nome que ficou (o da que recebe, se juntou) — o seletor o escolhe. */
  onSalva: (nome: string) => void;
}) {
  const toast = useToast();
  const consulta = useCategoriesUsed();
  const usadas = consulta.data ?? [];
  const salvarCategoria = useSalvarCategoria();
  const inicial = (c: Categoria | null) => ({
    nome: c?.category ?? '',
    icon: (c?.icon ?? (c ? aparenciaDaCategoria(c.category, usadas).icon : 'tag')) as IconName,
    cor: c?.color ?? null,
    ...categoryDefaults(c),
    configuracao: c,
    alvo: c ? c.configuration_id ?? c.category : null,
    expandido: false,
    alcance: 'new' as 'new' | 'period',
    de: '',
    ate: '',
    tentada: false,
  });
  const [campos, setCampos] = useState(() => inicial(categoria));
  // Reaberta (para outra categoria, ou nova), a folha começa do que ELA é, não do que foi digitado
  // da última vez. Estado ajustado no render, o padrão do React para "resetar quando a prop muda".
  const [abertaPara, setAbertaPara] = useState<string | null>(visible ? (categoria?.category ?? '') : null);
  const [visita, setVisita] = useState(0);
  const tentativa = useRef<{ visita: number; attempt: CategoryConfigurationAttempt } | null>(null);
  const mergeRetry = useRef<{ visita: number; baseKey: string; input: ConfigurationCommand } | null>(null);
  const ativa = useRef({ visible, visita });
  useLayoutEffect(() => { ativa.current = { visible, visita }; }, [visible, visita]);
  const chave = visible ? (categoria?.category ?? '') : null;
  const limpo = nomeDaCategoria(campos.nome);
  const jaExiste = !categoria && limpo
    ? usadas.find((c) => foldCategory(c.category) === foldCategory(limpo))
    : undefined;
  const alvo = jaExiste ? jaExiste.configuration_id ?? jaExiste.category : null;
  if (chave !== abertaPara) {
    setAbertaPara(chave);
    if (chave !== null) { setCampos(inicial(categoria)); setVisita((v) => v + 1); }
  } else if (!categoria && !campos.tentada && campos.alvo !== alvo) {
    // Naming an existing category edits its own configuration. Adopt its defaults once,
    // rather than silently replacing them with the new form's nulls; manual changes then stay.
    setCampos({ ...campos, ...(jaExiste ? { ...categoryDefaults(jaExiste),
      icon: jaExiste.icon ?? aparenciaDaCategoria(jaExiste.category, usadas).icon, cor: jaExiste.color ?? null } : {}),
      alvo, configuracao: jaExiste ?? null, alcance: 'new' });
  }
  const { nome, icon, cor, default_expense_pattern: pattern, default_expense_necessity: necessity } = campos;
  const originais = categoryDefaults(campos.configuracao);
  const padroesMudaram = pattern !== originais.default_expense_pattern || necessity !== originais.default_expense_necessity;
  const podeAplicarHistorico = Boolean(campos.configuracao?.configuration_id && padroesMudaram);
  const periodo = categoryBackfillPeriod(campos.de, campos.ate);
  const aplicaHistorico = podeAplicarHistorico && campos.alcance === 'period';
  const podeSalvar = limpo.length > 0 && limpo.length <= 40 && !salvarCategoria.isPending
    && !consulta.isPending && !consulta.isError && (!aplicaHistorico || Boolean(periodo));
  const resumo = [pattern && EXPENSE_PATTERN_LABELS[pattern], necessity && EXPENSE_NECESSITY_LABELS[necessity]]
    .filter(Boolean).join(' · ') || 'Sem padrões';

  const terminou = (result: CategoryConfigurationResult, historico: boolean) => {
    if (!ativa.current.visible || ativa.current.visita !== visita) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (historico) toast({ message: `${result.backfill_updated} ${result.backfill_updated === 1 ? 'gasto atualizado' : 'gastos atualizados'}.`, tone: 'success' });
    onSalva(result.category);
    onClose();
  };

  const executar = (input: ConfigurationCommand) => {
    if (!ativa.current.visible || ativa.current.visita !== visita || salvarCategoria.isPending) return;
    // A realtime read after a committed/lost response must not change CREATE into EDIT on
    // retry. Freeze the configuration snapshot after sending; a new name starts a new draft.
    setCampos((c) => ({ ...c, tentada: true }));
    const attempt = categoryConfigurationAttempt(tentativa.current?.visita === visita ? tentativa.current.attempt : null, input, newClientMessageId);
    tentativa.current = { visita, attempt };
    return salvarCategoria
      .mutateAsync({ ...input, requestId: attempt.requestId })
      .then(
        (result) => terminou(result, Boolean(input.backfill)),
        (e: unknown) => {
          if (!ativa.current.visible || ativa.current.visita !== visita) return;
          const erro = e as { code?: string; existente?: string };
          if (erro?.code === 'CATEGORIA_EXISTE' && erro.existente) {
            const destino = erro.existente;
            const de = input.renomearDe ?? categoria?.category ?? input.name;
            const temOrcamento = (campos.configuracao?.budgets ?? 0) > 0
              && (usadas.find((c) => c.category === destino)?.budgets ?? 0) > 0;
            confirmDestructive(`Juntar a categoria ${de} com ${destino}?`, 'Juntar', () => {
              const merged = { ...input, name: destino, renomearDe: de, juntar: true, backfill: null };
              mergeRetry.current = { visita, baseKey: categoryConfigurationKey(input), input: merged };
              void executar(merged);
            }, `Tudo que está em ${de} passa para ${destino}. Os padrões de ${destino} prevalecem; as classificações dos gastos ficam como estão.${temOrcamento ? ` No mês em que as duas têm orçamento, fica o de ${destino}.` : ''}${input.backfill ? ' O período escolhido não será aplicado.' : ''}`);
            return;
          }
          if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
            && e.message.startsWith('CATEGORIA_CONFIGURACAO_DESATUALIZADA')) {
            toast({ message: 'Essa categoria mudou enquanto você editava. Reabra para conferir as mudanças.', tone: 'error' });
            return;
          }
          toast({ message: financeErrorMessage(e, input.juntar ? 'Não deu para juntar as categorias.' : 'Não deu para salvar a categoria. Tente de novo.'), tone: 'error' });
        }
      );
  };

  const salvar = () => {
    if (!podeSalvar) return;
    const input: ConfigurationCommand = {
      name: jaExiste?.category ?? limpo, icon, color: cor, renomearDe: categoria?.category ?? null,
      default_expense_pattern: pattern, default_expense_necessity: necessity,
      configurationId: campos.configuracao?.configuration_id ?? null,
      expectedRevision: campos.configuracao?.edit_revision ?? null,
      backfill: aplicaHistorico ? periodo : null,
    };
    const retry = mergeRetry.current;
    if (retry?.visita === visita && retry.baseKey === categoryConfigurationKey(input)) {
      void executar(retry.input); return;
    }
    if (input.backfill) {
      confirmDestructive(`Aplicar padrões ao histórico de ${input.name}?`, 'Aplicar e salvar',
        () => void executar(input),
        `Os gastos de ${campos.de} a ${campos.ate} recebem os padrões escolhidos. Ajustes manuais, inclusive Não classificar, ficam. Recorrências, compras e dívidas conservam seus padrões.`);
      return;
    }
    void executar(input);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader
        title={categoria ? 'Editar categoria' : 'Nova categoria'}
        onClose={onClose}
        action={
          <Button
            label="Salvar"
            size="sm"
            loading={salvarCategoria.isPending}
            disabled={!podeSalvar}
            onPress={() => void salvar()}
          />
        }
      />
      <SheetScroll contentContainerStyle={styles.corpo} keyboardShouldPersistTaps="handled">
        <View style={styles.fields} pointerEvents={salvarCategoria.isPending ? 'none' : 'auto'}>
        <Field
          label="Nome"
          hint={
            jaExiste
              ? <>Essa categoria já existe: você está editando <Forte>{jaExiste.category}</Forte>.</>
              : undefined
          }>
          <TextField
            value={nome}
            onChangeText={(n) => setCampos((c) => ({ ...c, nome: n,
              tentada: foldCategory(nomeDaCategoria(n)) === foldCategory(nomeDaCategoria(c.nome)) && c.tentada }))}
            placeholder="Ex.: viagem"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={!categoria}
            maxLength={40}
            editable={!salvarCategoria.isPending}
          />
        </Field>
        <Field label="Ícone">
          <GradeDeIcones valor={icon} cor={cor} onPick={(i) => setCampos((c) => ({ ...c, icon: i }))} />
        </Field>
        <Field label="Cor">
          <GradeDeCores value={cor} onPick={(k) => setCampos((c) => ({ ...c, cor: k }))} />
        </Field>
        <View>
          <View style={styles.row}>
            <Row title="Padrões de gastos" subtitle={resumo} chevron={false}
              trailing={<Icon name={campos.expandido ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
              accessibilityLabel={`Padrões de gastos. Previsibilidade: ${pattern ? EXPENSE_PATTERN_LABELS[pattern] : 'Não classificar'}. Necessidade: ${necessity ? EXPENSE_NECESSITY_LABELS[necessity] : 'Não classificar'}.`}
              accessibilityState={{ expanded: campos.expandido }}
              onPress={() => setCampos((c) => ({ ...c, expandido: !c.expandido }))} />
          </View>
          <Presenca visivel={campos.expandido} imediata style={styles.defaults}>
            <ExpenseClassificationControls
              pattern={pattern}
              necessity={necessity}
              onPatternChange={(pattern) => setCampos((c) => ({ ...c, default_expense_pattern: pattern }))}
              onNecessityChange={(necessity) => setCampos((c) => ({ ...c, default_expense_necessity: necessity }))}
            />
            <Presenca visivel={podeAplicarHistorico} imediata style={styles.fields}>
              <Field label="Aplicar padrões">
                <SelectField options={SCOPE_OPTIONS} value={campos.alcance} onChange={(id) => {
                  if (id === 'new' || id === 'period') setCampos((c) => ({ ...c, alcance: id }));
                }} />
              </Field>
              <Presenca visivel={aplicaHistorico} imediata style={styles.fields}>
                <Field label="De" error={!campos.de ? 'Escolha o início do período.' : !periodo && campos.ate ? 'Confira as datas do período.' : undefined}>
                  <DatePickerField value={campos.de || null} onChange={(de) => setCampos((c) => ({ ...c, de }))}
                    accessibilityLabel="Início do período histórico" invalid={!campos.de} />
                </Field>
                <Field label="Até" error={!campos.ate ? 'Escolha o fim do período.' : !periodo && campos.de ? 'O fim não pode ser antes do início.' : undefined}>
                  <DatePickerField value={campos.ate || null} onChange={(ate) => setCampos((c) => ({ ...c, ate }))}
                    accessibilityLabel="Fim do período histórico" invalid={!campos.ate || Boolean(campos.de && !periodo)} />
                </Field>
              </Presenca>
            </Presenca>
          </Presenca>
        </View>
        </View>
        {consulta.isError ? <Button label="Tentar carregar categorias de novo" variant="secondary" onPress={() => void consulta.refetch()} /> : null}
      </SheetScroll>
    </Sheet>
  );
}

function GradeDeIcones({
  valor,
  cor,
  onPick,
}: {
  valor: IconName;
  cor: NoteColorName | null;
  onPick: (icon: IconName) => void;
}) {
  return (
    <View style={styles.grade}>
      {ICONES_DE_CATEGORIA.map((i) => (
        <AmostraDoIcone key={String(i)} icon={i} selecionado={i === valor} cor={cor} onPick={onPick} />
      ))}
    </View>
  );
}

function AmostraDoIcone({ icon, selecionado, cor, onPick }: {
  icon: IconName; selecionado: boolean; cor: NoteColorName | null; onPick: (icon: IconName) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const tinta = selecionado && cor ? noteInk(cor, scheme) ?? undefined : undefined;
  const superficie = useCoresSuaves({
    backgroundColor: theme.backgroundElement,
    borderColor: selecionado ? theme.text : 'transparent',
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ROTULO_DO_ICONE[String(icon)] ?? String(icon)}
      accessibilityState={{ selected: selecionado }}
      onPress={() => { Haptics.selectionAsync(); onPick(icon); }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Animated.View style={[styles.icone, superficie]}>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glifo}>
          <TrocaSuave estado={`${String(icon)}:${tinta ?? theme.text}`} style={styles.glifo}>
            <Icon name={icon} size="md" color="text" tint={tinta} />
          </TrocaSuave>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxl },
  fields: { gap: Space.xl },
  defaults: { gap: Space.xl, paddingTop: Space.md },
  row: { marginHorizontal: -Space.lg },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  glifo: { width: IconSize.md, height: IconSize.md, alignItems: 'center', justifyContent: 'center' },
  icone: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
