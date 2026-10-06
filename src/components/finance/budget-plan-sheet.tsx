import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryPicker } from '@/components/finance/category-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBRL } from '@/components/ui/conceal';
import { Explica } from '@/components/ui/explica';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { SkeletonRow } from '@/components/ui/skeleton';
import { SwitchRow } from '@/components/ui/switch-row';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Radius, Space, tabular } from '@/design/tokens';
import type { CycleView } from '@/hooks/use-finance';
import { useBudgetPlanCommand, useBudgetPlanPreview, useBudgetPlanState } from '@/hooks/use-budget-plan';
import { useTheme } from '@/hooks/use-theme';
import {
  MAX_LINHAS, applyRows, draftFromPlan, formatBp, motivoDoPlano, novaLinha, novoGrupo, parseBp, planoInicial, realizedBp, toInput,
  type ApplyScope, type PlanDraft, type PlanGroupDraft, type PlanLineDraft,
} from '@/lib/budget-plan';
import { explicaPlano } from '@/lib/explicacoes';
import { financeErrorMessage } from '@/lib/finance-form';

/**
 * F14 — "Planejar por percentual": a renda-base vira percentuais por grupo e categoria, e o plano
 * pode ser aplicado aos limites de Orçamentos. Uma folha, dois passos (plano → aplicar). Os reais
 * de cada linha vêm do SERVIDOR (`budget_plan_preview`), o mesmo cálculo do salvar. Mudar a renda
 * depois não reescreve limite já aplicado: só uma nova aplicação muda.
 */
export function BudgetPlanSheet({ visible, onClose, month, monthLabel, view }: {
  visible: boolean; onClose: () => void; month: string; monthLabel: string; view?: CycleView;
}) {
  const brl = useBRL();
  const toast = useToast();
  const theme = useTheme();
  const estado = useBudgetPlanState(month, view, visible);
  const comando = useBudgetPlanCommand();
  const [rascunho, setRascunho] = useState<PlanDraft | null>(null);
  const [modo, setModo] = useState<'plano' | 'aplicar'>('plano');
  const [escolhidas, setEscolhidas] = useState<string[] | null>(null);
  const [alcance, setAlcance] = useState<ApplyScope>('default');

  const dados = estado.data;
  const plano = dados?.plan ?? null;
  const draft = rascunho ?? (plano ? draftFromPlan(plano) : planoInicial());
  const motivo = motivoDoPlano(draft);
  const previa = useBudgetPlanPreview(draft.baseCents > 0 && draft.groups.length > 0 ? toInput(draft) : null);
  const salvoComoEsta = plano !== null && motivo === null
    && JSON.stringify(toInput(draft)) === JSON.stringify(toInput(draftFromPlan(plano)));

  const fechar = () => { setRascunho(null); setModo('plano'); setEscolhidas(null); onClose(); };
  const mudar = (fn: (d: PlanDraft) => PlanDraft) => setRascunho(fn(draft));
  const mudarGrupo = (key: string, fn: (g: PlanGroupDraft) => PlanGroupDraft) =>
    mudar((d) => ({ ...d, groups: d.groups.map((g) => (g.key === key ? fn(g) : g)) }));
  const mudarLinha = (gk: string, lk: string, patch: Partial<PlanLineDraft>) =>
    mudarGrupo(gk, (g) => ({ ...g, lines: g.lines.map((l) => (l.key === lk ? { ...l, ...patch } : l)) }));
  const tirarLinha = (gk: string, lk: string) =>
    mudar((d) => ({
      ...d,
      groups: d.groups.map((g) => (g.key === gk ? { ...g, lines: g.lines.filter((l) => l.key !== lk) } : g)).filter((g) => g.lines.length > 0),
    }));

  const erroDoComando = (erro: unknown) => {
    const codigo = erro && typeof erro === 'object' && 'code' in erro ? (erro as { code?: string }).code : undefined;
    if (codigo === 'PT409') {
      void estado.refetch();
      return toast({ message: 'O plano mudou em outro lugar. Confira a versão atual e tente de novo.', tone: 'error' });
    }
    toast({ message: financeErrorMessage(erro, 'Não deu para concluir. Tente de novo.'), tone: 'error' });
  };

  const salvar = () => {
    if (!dados || motivo) return;
    comando.mutate({ op: 'save', ...toInput(draft), expected_revision: dados.revision }, {
      onSuccess: (r) => toast({ message: `Plano salvo (versão ${r.version}).`, tone: 'success' }),
      onError: erroDoComando,
    });
  };

  // O que a prévia do servidor diz de cada linha, na ordem do rascunho.
  const reais = (i: number) => previa.data?.lines[i]?.amount_cents ?? null;

  const renda = dados?.income_cents ?? 0;
  const previsto = dados?.income_unsettled_cents ?? 0;
  const totalDeLinhas = draft.groups.reduce((n, g) => n + g.lines.length, 0);
  const categoriasDoPlano = plano?.lines.filter((l) => l.category && l.amount_cents > 0).map((l) => l.category!) ?? [];
  const marcadas = escolhidas ?? categoriasDoPlano;
  const linhasAplicar = plano ? applyRows(plano, marcadas, alcance) : [];
  const aplicar = () => {
    if (!plano || marcadas.length === 0) return;
    comando.mutate({ op: 'apply', version: plano.version, categories: marcadas, scope: alcance, month: alcance === 'month' ? `${month}-01` : null }, {
      onSuccess: (r) => {
        toast({ message: `Limites aplicados em ${r.applied?.length ?? marcadas.length} categoria(s).`, tone: 'success' });
        fechar();
      },
      onError: erroDoComando,
    });
  };

  const total = previa.data;
  const barra = [
    ...draft.groups.map((g, gi) => ({
      key: g.key,
      bp: g.lines.reduce((s, l) => s + (parseBp(l.pct) ?? 0), 0),
      cor: [theme.text, theme.textSecondary, theme.backgroundSelected][gi % 3],
    })),
  ];
  const somaBp = total?.total_bp ?? 0;

  return (
    <Sheet visible={visible} onClose={fechar}>
      <TaskHeader
        title={modo === 'plano' ? 'Planejar por percentual' : 'Aplicar aos orçamentos'}
        onClose={modo === 'plano' ? fechar : () => setModo('plano')}
        action={modo === 'plano' ? (
          <Button label="Salvar plano" size="sm" loading={comando.isPending} disabled={!dados || motivo !== null || salvoComoEsta} onPress={salvar} />
        ) : (
          <Button label="Aplicar" size="sm" loading={comando.isPending} disabled={marcadas.length === 0} onPress={aplicar} />
        )}
      />

      {estado.isPending && !estado.isError ? (
        // sem o plano carregado o editor não abre: digitar antes salvaria por cima da versão atual
        <SheetScroll keyboardShouldPersistTaps="handled" contentContainerStyle={styles.corpo}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </SheetScroll>
      ) : estado.isError ? (
        <SheetScroll keyboardShouldPersistTaps="handled" contentContainerStyle={styles.corpo}>
          <Card style={styles.faixa}>
            <ThemedText type="small" style={styles.centro}>Não deu para carregar o plano.</ThemedText>
            <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => { void estado.refetch(); }} />
          </Card>
        </SheetScroll>
      ) : modo === 'plano' ? (
        <SheetScroll keyboardShouldPersistTaps="handled" contentContainerStyle={styles.corpo}>
          <Field label="Renda-base" obrigatorio>
            <MoneyField valueCents={draft.baseCents} onChangeCents={(baseCents) => mudar((d) => ({ ...d, baseCents }))} autoFocus={!plano} />
          </Field>
          {renda > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Usar ${brl(renda)} como renda-base`}
              onPress={() => mudar((d) => ({ ...d, baseCents: renda }))}>
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                {`Entrou ${brl(renda)} em ${monthLabel} (lançado${previsto > 0 ? `, ${brl(previsto)} ainda previsto` : ', inclui previsto'}). Toque para usar.`}
              </ThemedText>
            </Pressable>
          ) : null}

          {draft.groups.map((g, gi) => (
            <Card key={g.key} style={styles.grupo}>
              <Field label="Grupo" obrigatorio>
                <TextField value={g.name} onChangeText={(name) => mudarGrupo(g.key, (x) => ({ ...x, name }))} placeholder="Ex.: Essenciais" returnKeyType="done" />
              </Field>
              {g.lines.map((l, li) => {
                const valor = reais(draft.groups.slice(0, gi).reduce((n, x) => n + x.lines.length, 0) + li);
                return (
                  <View key={l.key} style={styles.linha}>
                    <Field label="Categoria">
                      <CategoryPicker value={l.category} onChange={(category) => mudarLinha(g.key, l.key, { category })} />
                    </Field>
                    {l.category === null ? (
                      <ThemedText type="footnote" themeColor="textSecondary">Sem categoria: aparece no plano e não vira orçamento.</ThemedText>
                    ) : null}
                    <Field label="Percentual da renda (%)" obrigatorio>
                      <TextField
                        value={l.pct}
                        onChangeText={(pct) => mudarLinha(g.key, l.key, { pct })}
                        placeholder="0"
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        accessibilityLabel={`Percentual de ${l.category ?? 'linha sem categoria'}`}
                      />
                    </Field>
                    {valor !== null ? (
                      <ThemedText type="small" themeColor="textSecondary" style={tabular}>{`= ${brl(valor)} por mês`}</ThemedText>
                    ) : null}
                    <Button label="Remover linha" variant="secondary" tone="danger" size="sm" onPress={() => tirarLinha(g.key, l.key)} />
                  </View>
                );
              })}
              <Button label="Adicionar linha" variant="secondary" size="sm" disabled={totalDeLinhas >= MAX_LINHAS} onPress={() => mudarGrupo(g.key, (x) => ({ ...x, lines: [...x.lines, novaLinha()] }))} />
            </Card>
          ))}
          <Button label="Adicionar grupo" variant="secondary" onPress={() => mudar((d) => ({ ...d, groups: [...d.groups, novoGrupo()] }))} />

          {motivo ? (
            <ThemedText type="small" themeColor="danger" accessibilityRole="alert">{motivo}</ThemedText>
          ) : null}

          {/* Texto antes do gráfico: a barra é só o desenho do que a frase já diz. */}
          {total ? (
            <Card style={styles.grupo}>
              <ThemedText type="default" style={tabular}>
                {`Distribuído ${formatBp(total.total_bp)}% da renda-base: ${brl(total.total_cents)}.`}
              </ThemedText>
              <ThemedText type="small" themeColor={total.undistributed_bp < 0 ? 'danger' : 'textSecondary'} style={tabular}>
                {total.undistributed_bp < 0
                  ? `Passa de 100% em ${formatBp(-total.undistributed_bp)}%.`
                  : `Não distribuído: ${formatBp(total.undistributed_bp)}% (${brl(total.undistributed_cents)}).`}
              </ThemedText>
              <View style={[styles.barra, { backgroundColor: theme.backgroundElement }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {barra.filter((b) => b.bp > 0).map((b) => (
                  <View key={b.key} style={{ flex: b.bp, backgroundColor: b.cor }} />
                ))}
                {somaBp < 10000 ? <View style={{ flex: Math.max(0, 10000 - somaBp) }} /> : null}
              </View>
            </Card>
          ) : null}

          {plano ? (
            <Card style={styles.grupo}>
              <View style={styles.tituloComExplica}>
                <ThemedText type="headline">{`Planejado × realizado · ${monthLabel}`}</ThemedText>
                <Explica indicador="Planejado × realizado" explicacao={explicaPlano(dados)} />
              </View>
              {plano.lines.reduce<string[]>((gs, l) => (gs.includes(l.group) ? gs : [...gs, l.group]), []).map((nome) => {
                const doGrupo = plano.lines.filter((l) => l.group === nome);
                const bp = doGrupo.reduce((s, l) => s + l.share_bp, 0);
                const planejado = doGrupo.reduce((s, l) => s + l.amount_cents, 0);
                const gasto = doGrupo.reduce((s, l) => s + (l.spent_cents ?? 0), 0);
                const real = realizedBp(gasto, renda);
                return (
                  <View key={nome} style={styles.linha}>
                    <ThemedText type="default">{nome}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                      {`Planejado: ${formatBp(bp)}% da renda-base de ${brl(plano.base_income_cents)} (${brl(planejado)})`}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                      {real === null
                        ? 'Realizado: sem renda lançada neste período.'
                        : `Realizado: ${formatBp(real)}% da renda que entrou, ${brl(renda)} (${brl(gasto)} gastos)`}
                    </ThemedText>
                  </View>
                );
              })}
            </Card>
          ) : null}

          <Button
            label="Aplicar aos orçamentos"
            variant="secondary"
            disabled={!salvoComoEsta || categoriasDoPlano.length === 0}
            onPress={() => { setEscolhidas(null); setModo('aplicar'); }}
          />
          {plano && !salvoComoEsta ? (
            <ThemedText type="footnote" themeColor="textSecondary">Salve o plano para poder aplicar.</ThemedText>
          ) : null}
        </SheetScroll>
      ) : (
        <SheetScroll keyboardShouldPersistTaps="handled" contentContainerStyle={styles.corpo}>
          <Field label="Vale para">
            <Segmented
              options={[{ value: 'default', label: 'Todo mês' }, { value: 'month', label: `Só ${monthLabel}` }]}
              value={alcance}
              onChange={setAlcance}
            />
          </Field>
          <Field label="Categorias" obrigatorio>
            <View style={styles.linha}>
              {categoriasDoPlano.map((c) => (
                <SwitchRow
                  key={c}
                  label={c}
                  value={marcadas.includes(c)}
                  onValueChange={(on) => setEscolhidas(on ? [...marcadas, c] : marcadas.filter((x) => x !== c))}
                />
              ))}
            </View>
          </Field>
          {linhasAplicar.length > 0 ? (
            <Card style={styles.grupo}>
              {linhasAplicar.map((r) => (
                <View key={r.category} style={styles.linha}>
                  <ThemedText type="default" style={tabular}>
                    {`${r.category}: ${r.before === null ? 'sem limite' : brl(r.before)} → ${brl(r.after)}`}
                  </ThemedText>
                  {r.conflict ? (
                    <ThemedText type="footnote" themeColor="warning" style={tabular}>
                      {r.doPadrao
                        ? `Vale o limite padrão de ${brl(r.before ?? 0)}; só em ${monthLabel} passa a ${brl(r.after)}.`
                        : `Já tem limite de ${brl(r.before ?? 0)} ${alcance === 'month' ? `em ${monthLabel}` : 'para todo mês'}.`}
                    </ThemedText>
                  ) : null}
                </View>
              ))}
            </Card>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">Marque ao menos uma categoria.</ThemedText>
          )}
        </SheetScroll>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tituloComExplica: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  grupo: { gap: Space.md },
  linha: { gap: Space.sm },
  faixa: { alignItems: 'center', gap: Space.sm },
  centro: { textAlign: 'center' },
  barra: { flexDirection: 'row', height: 8, borderRadius: Radius.pill, overflow: 'hidden' },
});
