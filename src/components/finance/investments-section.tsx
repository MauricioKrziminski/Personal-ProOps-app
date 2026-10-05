import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBRL } from '@/components/ui/conceal';
import { Deslizavel, fecharDeslizavelAberto } from '@/components/ui/deslizavel';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Segmented } from '@/components/ui/segmented';
import { SelectField } from '@/components/ui/select-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { SkeletonRow } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { VerMais } from '@/components/ui/ver-mais';
import { Space } from '@/design/tokens';
import { useAccountBalances, useAccounts } from '@/hooks/use-finance';
import { useInvestmentCommand, useInvestmentLinkCandidates, useInvestmentMovements, useInvestmentPositions } from '@/hooks/use-investments';
import { brToISO, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import {
  contasParaInvestir, efeitoDoInvestimento, entradaDoInvestimento, mensagemDoInvestimento, naturezaDoMovimento,
  validarInvestimento, type InvestmentDraft, type InvestmentMovement, type InvestmentPosition,
} from '@/lib/investment';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';

/**
 * F12 — Investimentos em Patrimônio. A posição é uma conta de investimento; Aplicar e Resgatar
 * movem dinheiro por UMA transferência real e não são consumo nem renda. Uma folha só serve aos
 * dois (e à edição); o histórico da posição abre ao tocar nela. Só uma folha fica aberta por vez
 * (`Modal` dentro de `Modal` no Android): editar fecha o histórico e, ao sair, ele volta.
 */
interface Folha {
  /** Em edição: o movimento. A direção e a posição não mudam depois de criado. */
  movimento: InvestmentMovement | null;
  draft: InvestmentDraft;
}

const vazio = (direcao: 'aplicar' | 'resgatar', posicaoId: string | null): InvestmentDraft => ({
  direcao, posicaoId, contaId: null, vincularId: null, cents: 0, data: localISODate(), nota: '',
});

export function InvestmentsSection() {
  const brl = useBRL();
  const toast = useToast();
  const posicoes = useInvestmentPositions();
  const contasQuery = useAccounts();
  const saldos = useAccountBalances();
  const comando = useInvestmentCommand();
  const [folha, setFolha] = useState<Folha | null>(null);
  const [historicoId, setHistoricoId] = useState<string | null>(null);

  const lista = posicoes.isError ? [] : (posicoes.data ?? []);
  const posicaoAberta = lista.find((p) => p.account_id === historicoId) ?? null;
  const historico = useInvestmentMovements(posicaoAberta?.account_id);
  const draft = folha?.draft ?? null;
  const candidatas = useInvestmentLinkCandidates(folha !== null && folha.movimento === null);

  // Saldo REALIZADO de cada conta, o mesmo critério do saldo da posição.
  const realizado = (id: string) => (saldos.data ?? []).find((b) => b.account_id === id)?.cleared_cents ?? null;
  const contas = contasParaInvestir(contasQuery.data ?? []).map((c) => ({ ...c, balance_cents: realizado(c.id) }));
  const ctx = {
    contas, posicoes: lista, hoje: localISODate(),
    edicao: folha?.movimento ? { kind: folha.movimento.kind, amount_cents: folha.movimento.amount_cents ?? 0, occurred_on: folha.movimento.occurred_on } : undefined,
  };
  const validacao = draft ? validarInvestimento(draft, ctx, brl) : { pronto: false, motivo: null };
  const efeito = draft ? efeitoDoInvestimento(draft, ctx) : [];
  const ficaNegativa = efeito.find((l) => l.depois < 0);
  const vinculada = draft !== null && draft.vincularId !== null;
  const editando = folha?.movimento ?? null;

  const abrir = (direcao: 'aplicar' | 'resgatar', posicaoId?: string) => {
    setHistoricoId(null);
    setFolha({ movimento: null, draft: vazio(direcao, posicaoId ?? (lista.length === 1 ? lista[0].account_id : null)) });
  };
  const abrirEdicao = (m: InvestmentMovement) => {
    if (!posicaoAberta || m.amount_cents === null) return;
    setFolha({
      movimento: m,
      draft: {
        direcao: m.kind === 'contribution' ? 'aplicar' : 'resgatar', posicaoId: posicaoAberta.account_id,
        contaId: m.counterparty_account_id, vincularId: null, cents: m.amount_cents, data: m.occurred_on, nota: '',
      },
    });
  };
  const mudar = (parte: Partial<InvestmentDraft>) => folha && setFolha({ ...folha, draft: { ...folha.draft, ...parte } });
  const mudarDirecao = (direcao: 'aplicar' | 'resgatar') => mudar({ direcao, contaId: null, vincularId: null });

  const salvar = () => {
    if (!folha || !validacao.pronto) return;
    const { draft: d, movimento } = folha;
    comando.mutate(entradaDoInvestimento(d, movimento ? { id: movimento.id, revision: movimento.revision } : undefined), {
      onSuccess: () => {
        toast({
          message: movimento ? 'Movimento corrigido.' : d.vincularId ? 'Transferência vinculada.' : d.direcao === 'aplicar' ? 'Aplicado.' : 'Resgatado.',
          tone: 'success',
        });
        setFolha(null);
        if (!movimento) setHistoricoId(null);
      },
      // a folha FICA aberta com o valor: fechar num erro faz a pessoa achar que gravou
      onError: (error) => toast({
        message: mensagemDoInvestimento(error, d.direcao === 'aplicar' ? 'Não deu para aplicar.' : 'Não deu para resgatar.', brl), tone: 'error',
      }),
    });
  };

  const desfazer = (m: InvestmentMovement) =>
    confirmDestructive(
      'Desfazer este movimento?',
      'Desfazer',
      () => comando.mutate({ op: 'undo', movement_id: m.id, expected_revision: m.revision }, {
        onSuccess: () => toast({ message: 'Movimento desfeito.', tone: 'success' }),
        onError: (error) => toast({ message: mensagemDoInvestimento(error, 'Não deu para desfazer.', brl), tone: 'error' }),
      }),
      `${naturezaDoMovimento(m)}. ${m.deleted ? 'Só o registro do movimento é removido.' : m.created_transfer ? 'A transferência criada por ele também é apagada.' : 'Nenhum lançamento é apagado.'}`,
    );

  const acoesDaPosicao = (p: InvestmentPosition): ItemAction[] => [
    { label: 'Aplicar', icon: 'plus', arrasto: 'direita', onPress: () => abrir('aplicar', p.account_id) },
    { label: 'Resgatar', icon: 'arrow.down.circle', onPress: () => abrir('resgatar', p.account_id) },
  ];
  const acoesDoMovimento = (m: InvestmentMovement): ItemAction[] => [
    ...(m.created_transfer && !m.deleted ? [{ label: 'Editar', icon: 'pencil' as const, arrasto: 'direita' as const, onPress: () => abrirEdicao(m) }] : []),
    { label: 'Desfazer o movimento', curto: 'Desfazer', icon: 'arrow.uturn.backward', destructive: true, arrasto: 'esquerda', onPress: () => desfazer(m) },
  ];

  const movimentos = (historico.data?.pages ?? []).flatMap((p) => p.movements);
  const candidatasDaFolha = (candidatas.data ?? []).filter((t) =>
    draft !== null && t.position_account_id === draft.posicaoId && t.kind === (draft.direcao === 'aplicar' ? 'contribution' : 'redemption'));
  const rotuloOutra = draft?.direcao === 'aplicar' ? 'Da conta' : 'Para a conta';

  return (
    <>
      {posicoes.isLoading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}
      {posicoes.isError ? (
        <Card style={styles.erro}>
          <ThemedText type="small" style={styles.centro}>Não deu para carregar seus investimentos.</ThemedText>
          <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => posicoes.refetch()} />
        </Card>
      ) : null}
      {lista.length > 0 ? (
        <Section title="Investimentos">
          {lista.map((p) => (
            <Deslizavel key={p.account_id} titulo={p.name} acoes={acoesDaPosicao(p)}>
              <Row
                title={p.name}
                subtitle={`Aportado líquido ${brl(p.net_contributed_cents)}`}
                icon="chart.line.uptrend.xyaxis"
                onPress={() => setHistoricoId(p.account_id)}
                onLongPress={() => showItemActions(p.name, acoesDaPosicao(p))}
                accessibilityLabel={`${p.name}, saldo ${brl(p.balance_cents)}, aportado líquido ${brl(p.net_contributed_cents)}. Toque para ver o histórico.`}
                trailing={<Money cents={p.balance_cents} variant="ticker" tone="text" />}
              />
            </Deslizavel>
          ))}
          <View style={styles.acoes}>
            <Button label="Aplicar" variant="secondary" size="sm" onPress={() => abrir('aplicar')} />
            <Button label="Resgatar" variant="secondary" size="sm" onPress={() => abrir('resgatar')} />
          </View>
        </Section>
      ) : null}
      {!posicoes.isLoading && !posicoes.isError && lista.length === 0 ? (
        <EmptyState
          compacto
          icon="chart.line.uptrend.xyaxis"
          title="Nenhuma conta de investimento"
          hint="Cadastre uma para aplicar e resgatar com origem e destino."
          action={{ label: 'Cadastrar conta de investimento', onPress: () => router.push('/finance/accounts?create=1') }}
        />
      ) : null}

      {/* Histórico da posição — do mais recente ao mais antigo, aos poucos. */}
      <Sheet visible={posicaoAberta !== null && folha === null} onClose={() => setHistoricoId(null)}>
        <TaskHeader title={posicaoAberta?.name ?? 'Investimento'} onClose={() => setHistoricoId(null)} />
        {posicaoAberta && folha === null ? (
          <SheetScroll contentContainerStyle={styles.corpo} onScrollBeginDrag={fecharDeslizavelAberto}>
            {historico.isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : null}
            {historico.isError ? (
              <Card style={styles.erro}>
                <ThemedText type="small" style={styles.centro}>Não deu para carregar o histórico.</ThemedText>
                <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => historico.refetch()} />
              </Card>
            ) : null}
            {movimentos.length > 0 ? (
              <Section>
                {movimentos.map((m) => (
                  <Deslizavel key={m.id} titulo={isoToBR(m.occurred_on)} acoes={acoesDoMovimento(m)}>
                    <Row
                      title={isoToBR(m.occurred_on)}
                      subtitle={[naturezaDoMovimento(m), m.status === 'pending' ? 'agendado' : null].filter(Boolean).join(' · ')}
                      chevron={false}
                      onLongPress={() => showItemActions(isoToBR(m.occurred_on), acoesDoMovimento(m))}
                      accessibilityLabel={`${isoToBR(m.occurred_on)}, ${m.deleted ? 'lançamento apagado' : `${m.kind === 'contribution' ? 'aplicação' : 'resgate'} de ${brl(m.amount_cents ?? 0)}`}`}
                      trailing={m.amount_cents === null ? undefined : <Money cents={m.kind === 'contribution' ? m.amount_cents : -m.amount_cents} variant="ticker" tone="auto" signed />}
                    />
                  </Deslizavel>
                ))}
              </Section>
            ) : null}
            <VerMais
              restantes={historico.hasNextPage ? null : 0}
              carregando={historico.isFetchingNextPage}
              onPress={() => historico.fetchNextPage()}
            />
            {!historico.isLoading && !historico.isError && movimentos.length === 0 ? (
              <EmptyState compacto icon="tray" title="Nenhum movimento ainda" hint="Aplique ou resgate para começar o histórico." />
            ) : null}
          </SheetScroll>
        ) : null}
      </Sheet>

      {/* Aplicar | Resgatar | editar — a mesma folha. */}
      <Sheet visible={folha !== null} onClose={() => setFolha(null)}>
        <TaskHeader
          title={editando ? 'Editar movimento' : draft?.direcao === 'resgatar' ? 'Resgatar' : 'Aplicar'}
          onClose={() => setFolha(null)}
        />
        {folha && draft ? (
          <SheetScroll contentContainerStyle={styles.corpo}>
            {editando ? null : (
              <Segmented
                options={[{ value: 'aplicar', label: 'Aplicar' }, { value: 'resgatar', label: 'Resgatar' }]}
                value={draft.direcao}
                onChange={mudarDirecao}
              />
            )}

            {vinculada ? null : (
              <Field label="Valor">
                <MoneyField valueCents={draft.cents} onChangeCents={(cents) => mudar({ cents })} autoFocus />
              </Field>
            )}

            {editando || lista.length < 2 ? null : (
              <Field label="Investimento">
                <SelectField
                  value={draft.posicaoId}
                  onChange={(id) => mudar({ posicaoId: id, vincularId: null })}
                  placeholder="Escolher a posição"
                  options={lista.map((p) => ({ id: p.account_id, label: p.name, icon: 'chart.line.uptrend.xyaxis' as const }))}
                />
              </Field>
            )}

            {editando || candidatasDaFolha.length === 0 ? null : (
              <Field label="Transferência já lançada">
                <SelectField
                  value={draft.vincularId}
                  onChange={(id) => mudar({ vincularId: id })}
                  placeholder="Escolher uma transferência"
                  options={[
                    { id: null, label: 'Criar uma nova', icon: 'plus' as const },
                    ...candidatasDaFolha.map((t) => ({
                      id: t.id,
                      label: `${brl(t.amount_cents)} · ${t.from_name ?? 'conta removida'} para ${t.to_name ?? 'conta removida'}`,
                      meta: isoToBR(t.occurred_on),
                    })),
                  ]}
                />
              </Field>
            )}

            {vinculada ? null : (
              <>
                <Field label={rotuloOutra}>
                  <AccountPicker
                    accounts={contas}
                    value={draft.contaId}
                    onChange={(id) => mudar({ contaId: id })}
                    placeholder={draft.direcao === 'aplicar' ? 'Escolher a origem' : 'Escolher o destino'}
                    disabled={editando !== null}
                  />
                </Field>
                <Field label="Quando">
                  <DatePickerField
                    value={isoToBR(draft.data)}
                    onChange={(br) => mudar({ data: isValidBRDate(br) ? brToISO(br) : '' })}
                    accessibilityLabel="Data do movimento"
                  />
                </Field>
                {editando ? null : (
                  <Field label="Nota">
                    <TextField value={draft.nota} onChangeText={(nota) => mudar({ nota })} placeholder="Ex.: sobra do salário" returnKeyType="done" />
                  </Field>
                )}
              </>
            )}

            {validacao.motivo ? (
              <ThemedText type="small" themeColor="danger" accessibilityRole="alert">{validacao.motivo}</ThemedText>
            ) : null}

            {efeito.length > 0 ? (
              <Card style={styles.efeito}>
                {efeito.map((linha) => (
                  <ThemedText key={`${linha.contaId}-${linha.rotulo}`} type="small" themeColor="textSecondary">
                    {`${linha.conta} · ${linha.rotulo}: ${brl(linha.antes)} → ${brl(linha.depois)}`}
                  </ThemedText>
                ))}
                {ficaNegativa ? (
                  <ThemedText type="small" themeColor="danger">{`${ficaNegativa.conta} fica com saldo negativo.`}</ThemedText>
                ) : null}
              </Card>
            ) : null}

            <Button
              label={editando ? 'Salvar' : vinculada ? 'Vincular' : draft.direcao === 'aplicar' ? 'Aplicar' : 'Resgatar'}
              block
              loading={comando.isPending}
              disabled={!validacao.pronto}
              onPress={salvar}
            />
          </SheetScroll>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  acoes: { flexDirection: 'row', gap: Space.md, padding: Space.lg },
  erro: { alignItems: 'center', gap: Space.md },
  centro: { textAlign: 'center' },
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  efeito: { gap: Space.xs, alignItems: 'stretch' },
});
