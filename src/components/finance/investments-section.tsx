import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBRL, useConceal } from '@/components/ui/conceal';
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
import {
  useInvestmentCommand, useInvestmentLinkCandidates, useInvestmentMovements, useInvestmentPositions, useInvestmentValueCommand,
} from '@/hooks/use-investments';
import { brToISO, formatNumberBR, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import {
  contasParaInvestir, efeitoDoInvestimento, entradaDoInvestimento, entradaDoValor, frasesDaPosicao, mensagemDoInvestimento,
  naturezaDoMovimento, percentualDoResultado, validarInvestimento, validarValor,
  type InvestmentDraft, type InvestmentMovement, type InvestmentPosition, type ValueDraft, type ValueMode,
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
  /**
   * F13 — a MESMA folha serve a Atualizar valor, Rendimento recebido e Informar aplicado (sem segundo
   * formulário). `editando` é a atualização/abertura que está sendo corrigida.
   */
  valor: { draft: ValueDraft; editando: InvestmentMovement | null } | null;
}

const MODOS_DE_VALOR: Record<ValueMode, { titulo: string; campo: string }> = {
  valor: { titulo: 'Atualizar valor', campo: 'Valor da posição' },
  rendimento: { titulo: 'Rendimento recebido', campo: 'Valor recebido' },
  aplicado: { titulo: 'Informar aplicado', campo: 'Total aplicado' },
};

const vazio = (direcao: 'aplicar' | 'resgatar', posicaoId: string | null): InvestmentDraft => ({
  direcao, posicaoId, contaId: null, vincularId: null, cents: 0, data: localISODate(), nota: '',
});

export function InvestmentsSection() {
  const brl = useBRL();
  // Oculto, o sinal e o percentual do resultado também saem: "−••••" e "+92%" contavam o que a máscara esconde.
  const { concealed } = useConceal();
  const toast = useToast();
  const posicoes = useInvestmentPositions();
  const contasQuery = useAccounts();
  const saldos = useAccountBalances();
  const comando = useInvestmentCommand();
  const comandoValor = useInvestmentValueCommand();
  const [folha, setFolha] = useState<Folha | null>(null);
  const [historicoId, setHistoricoId] = useState<string | null>(null);

  const lista = posicoes.isError ? [] : (posicoes.data ?? []);
  const posicaoAberta = lista.find((p) => p.account_id === historicoId) ?? null;
  const historico = useInvestmentMovements(posicaoAberta?.account_id);
  const draft = folha?.draft ?? null;
  const candidatas = useInvestmentLinkCandidates(folha !== null && folha.movimento === null && folha.valor === null);

  // Saldo REALIZADO de cada conta, o mesmo critério do saldo da posição.
  const realizado = (id: string) => (saldos.data ?? []).find((b) => b.account_id === id)?.cleared_cents ?? null;
  const contas = contasParaInvestir(contasQuery.data ?? []).map((c) => ({ ...c, balance_cents: realizado(c.id) }));
  const ctx = {
    contas, posicoes: lista, hoje: localISODate(),
    edicao: folha?.movimento ? { kind: folha.movimento.kind as 'contribution' | 'redemption', amount_cents: folha.movimento.amount_cents ?? 0, occurred_on: folha.movimento.occurred_on } : undefined,
  };
  const validacao = draft ? validarInvestimento(draft, ctx, brl) : { pronto: false, motivo: null };
  const efeito = draft ? efeitoDoInvestimento(draft, ctx) : [];
  const ficaNegativa = efeito.find((l) => l.depois < 0);
  const vinculada = draft !== null && draft.vincularId !== null;
  const editando = folha?.movimento ?? null;

  const abrir = (direcao: 'aplicar' | 'resgatar', posicaoId?: string) => {
    setHistoricoId(null);
    setFolha({ movimento: null, valor: null, draft: vazio(direcao, posicaoId ?? (lista.length === 1 ? lista[0].account_id : null)) });
  };
  const abrirEdicao = (m: InvestmentMovement) => {
    if (!posicaoAberta || m.amount_cents === null) return;
    setFolha({
      movimento: m,
      valor: null,
      draft: {
        direcao: m.kind === 'contribution' ? 'aplicar' : 'resgatar', posicaoId: posicaoAberta.account_id,
        contaId: m.counterparty_account_id, vincularId: null, cents: m.amount_cents, data: m.occurred_on, nota: '',
      },
    });
  };
  const mudar = (parte: Partial<InvestmentDraft>) => folha && setFolha({ ...folha, draft: { ...folha.draft, ...parte } });
  const mudarDirecao = (direcao: 'aplicar' | 'resgatar') => mudar({ direcao, contaId: null, vincularId: null });

  // ── F13: valor, rendimento e aplicado ────────────────────────────────────────────────────────────
  const valor = folha?.valor ?? null;
  const vd = valor?.draft ?? null;
  const editandoValor = valor?.editando ?? null;
  // rendimento cai na posição ou numa conta comum; cartão e outras posições não aparecem
  const destinos = (contasQuery.data ?? [])
    .filter((c) => !c.archived && c.type !== 'credit_card' && (c.type !== 'investment' || c.id === vd?.posicaoId))
    .map((c) => ({ ...c, balance_cents: realizado(c.id) }));
  const validacaoValor = vd ? validarValor(vd, { contas, posicoes: lista, hoje: ctx.hoje }) : { pronto: false, motivo: null };
  const abrirValor = (modo: ValueMode, posicaoId?: string) => {
    setHistoricoId(null);
    setFolha({
      movimento: null, draft: vazio('aplicar', null),
      valor: { editando: null, draft: { modo, posicaoId: posicaoId ?? (lista.length === 1 ? lista[0].account_id : null), contaId: null, cents: 0, data: localISODate(), nota: '' } },
    });
  };
  const abrirEdicaoDeValor = (m: InvestmentMovement) => {
    if (!posicaoAberta || m.amount_cents === null) return;
    setFolha({
      movimento: null, draft: vazio('aplicar', null),
      valor: { editando: m, draft: { modo: m.kind === 'opening' ? 'aplicado' : 'valor', posicaoId: posicaoAberta.account_id, contaId: null, cents: m.amount_cents, data: m.occurred_on, nota: '' } },
    });
  };
  const mudarValor = (parte: Partial<ValueDraft>) => folha?.valor && setFolha({ ...folha, valor: { ...folha.valor, draft: { ...folha.valor.draft, ...parte } } });
  const mudarModo = (modo: ValueMode) => mudarValor({ modo, contaId: null });

  const salvarValor = () => {
    if (!folha?.valor || !validacaoValor.pronto) return;
    const { draft: d, editando } = folha.valor;
    const gravar = () => comandoValor.mutate(entradaDoValor(d, editando ? { id: editando.id, revision: editando.revision } : undefined), {
      onSuccess: () => {
        toast({
          message: editando ? 'Corrigido.' : d.modo === 'rendimento' ? 'Rendimento registrado.' : d.modo === 'aplicado' ? 'Aplicado informado.' : 'Valor atualizado.',
          tone: 'success',
        });
        setFolha(null);
      },
      // a folha FICA aberta com o valor: fechar num erro faz a pessoa achar que gravou
      onError: (error) => toast({ message: mensagemDoInvestimento(error, 'Não deu para salvar.', brl), tone: 'error' }),
    });
    const aberta = lista.find((p) => p.account_id === d.posicaoId);
    // a abertura é única por posição: a nova substitui a que já existe, e a pessoa confirma antes
    if (d.modo === 'aplicado' && !editando && aberta?.opening_on) {
      confirmDestructive('Substituir o aplicado informado?', 'Substituir', gravar, `O valor informado em ${isoToBR(aberta.opening_on)} será trocado por este.`);
      return;
    }
    gravar();
  };

  const apagarMarcacao = (m: InvestmentMovement) =>
    confirmDestructive(
      'Apagar este valor informado?',
      'Apagar',
      () => comandoValor.mutate({ op: 'delete', valuation_id: m.id, expected_revision: m.revision }, {
        onSuccess: () => toast({ message: 'Apagado.', tone: 'success' }),
        onError: (error) => toast({ message: mensagemDoInvestimento(error, 'Não deu para apagar.', brl), tone: 'error' }),
      }),
      `${naturezaDoMovimento(m)} em ${isoToBR(m.occurred_on)}. O valor atual é recalculado.`,
    );

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
      `${naturezaDoMovimento(m)}. ${m.deleted ? 'Só o registro do movimento é removido.' : m.created_transfer ? (m.kind === 'income' ? 'A receita criada por ele também é apagada.' : 'A transferência criada por ele também é apagada.') : 'Nenhum lançamento é apagado.'}`,
    );

  const acoesDaPosicao = (p: InvestmentPosition): ItemAction[] => [
    { label: 'Aplicar', icon: 'plus', arrasto: 'direita', onPress: () => abrir('aplicar', p.account_id) },
    { label: 'Resgatar', icon: 'arrow.down.circle', onPress: () => abrir('resgatar', p.account_id) },
    { label: 'Atualizar valor', icon: 'chart.line.uptrend.xyaxis', onPress: () => abrirValor('valor', p.account_id) },
  ];
  // "Aplicado R$ x · Resultado +R$ y" — sem atualização de valor não há número de resultado, só as palavras
  const subtituloDaPosicao = (p: InvestmentPosition) => {
    const f = frasesDaPosicao(p);
    if (f.resultado === null) return `Aplicado ${brl(p.principal_cents)} · sem atualização de valor`;
    return `Aplicado ${brl(p.principal_cents)} · Resultado ${concealed ? '' : f.resultado < 0 ? '−' : '+'}${brl(Math.abs(f.resultado))}`;
  };
  // Valor atual, aplicado, resultado (qualidade em palavras, sem número quando indisponível) e recebido.
  const resumoDaPosicao = (p: InvestmentPosition) => {
    const f = frasesDaPosicao(p);
    const pct = percentualDoResultado(p);
    return (
      <Section title="Posição">
        <Row
          title="Valor atual"
          subtitle={f.atualizado ?? 'Ainda sem atualização de valor'}
          chevron={false}
          accessibilityLabel={`Valor atual ${brl(p.value_cents)}${f.atualizado ? `, ${f.atualizado}` : ''}`}
          trailing={<Money cents={p.value_cents} variant="ticker" encolhe={false} tone="text" />}
        />
        <Row
          title="Aplicado"
          chevron={false}
          accessibilityLabel={`Aplicado ${brl(p.principal_cents)}`}
          trailing={<Money cents={p.principal_cents} variant="ticker" encolhe={false} tone="text" />}
        />
        <Row
          title="Resultado"
          subtitle={f.resultado === null || concealed || pct === null ? f.qualidade : `${f.qualidade} ${pct > 0 ? '+' : ''}${formatNumberBR(pct)}%.`}
          chevron={false}
          accessibilityLabel={f.resultado === null ? `Resultado indisponível. ${f.qualidade}` : `Resultado ${brl(f.resultado)}. ${f.qualidade}`}
          trailing={f.resultado === null ? undefined : <Money cents={f.resultado} variant="ticker" encolhe={false} tone="auto" signed />}
        />
        {p.received_cents > 0 ? (
          <Row
            title="Recebido"
            chevron={false}
            accessibilityLabel={`Recebido em rendimentos ${brl(p.received_cents)}`}
            trailing={<Money cents={p.received_cents} variant="ticker" encolhe={false} tone="text" />}
          />
        ) : null}
      </Section>
    );
  };
  const acoesDoMovimento = (m: InvestmentMovement): ItemAction[] => m.nature === 'valuation' || m.nature === 'opening' ? [
    { label: 'Editar', icon: 'pencil', arrasto: 'direita', onPress: () => abrirEdicaoDeValor(m) },
    { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => apagarMarcacao(m) },
  ] : [
    ...(m.created_transfer && !m.deleted && m.kind !== 'income' ? [{ label: 'Editar', icon: 'pencil' as const, arrasto: 'direita' as const, onPress: () => abrirEdicao(m) }] : []),
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
                subtitle={subtituloDaPosicao(p)}
                icon="chart.line.uptrend.xyaxis"
                onPress={() => setHistoricoId(p.account_id)}
                onLongPress={() => showItemActions(p.name, acoesDaPosicao(p))}
                accessibilityLabel={`${p.name}, valor atual ${brl(p.value_cents)}, ${subtituloDaPosicao(p)}. Toque para ver o histórico.`}
                trailing={<Money cents={p.value_cents} variant="ticker" encolhe={false} tone="text" />}
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
            {resumoDaPosicao(posicaoAberta)}
            <View style={styles.acoes}>
              <Button label="Atualizar valor" variant="secondary" size="sm" onPress={() => abrirValor('valor', posicaoAberta.account_id)} />
              <Button label="Rendimento recebido" variant="secondary" size="sm" onPress={() => abrirValor('rendimento', posicaoAberta.account_id)} />
              <Button label="Informar aplicado" variant="secondary" size="sm" onPress={() => abrirValor('aplicado', posicaoAberta.account_id)} />
            </View>
            {movimentos.length > 0 ? (
              <Section>
                {movimentos.map((m) => (
                  <Deslizavel key={m.id} titulo={isoToBR(m.occurred_on)} acoes={acoesDoMovimento(m)}>
                    <Row
                      title={isoToBR(m.occurred_on)}
                      subtitle={[naturezaDoMovimento(m), m.status === 'pending' ? 'agendado' : null].filter(Boolean).join(' · ')}
                      chevron={false}
                      onLongPress={() => showItemActions(isoToBR(m.occurred_on), acoesDoMovimento(m))}
                      accessibilityLabel={`${isoToBR(m.occurred_on)}, ${m.deleted ? 'lançamento apagado' : `${naturezaDoMovimento(m)}, ${brl(m.amount_cents ?? 0)}`}`}
                      trailing={m.amount_cents === null ? undefined : m.kind === 'valuation' || m.kind === 'opening'
                        ? <Money cents={m.amount_cents} variant="ticker" encolhe={false} tone="text" />
                        : <Money cents={m.kind === 'redemption' ? -m.amount_cents : m.amount_cents} variant="ticker" encolhe={false} tone="auto" signed />}
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
              <EmptyState compacto icon="tray" title="Nenhum movimento ainda" hint="Aplique, resgate ou atualize o valor para começar o histórico." />
            ) : null}
          </SheetScroll>
        ) : null}
      </Sheet>

      {/* Aplicar | Resgatar | editar — a mesma folha. */}
      <Sheet visible={folha !== null} onClose={() => setFolha(null)}>
        <TaskHeader
          title={vd ? (editandoValor ? (vd.modo === 'aplicado' ? 'Editar aplicado' : 'Editar valor') : MODOS_DE_VALOR[vd.modo].titulo)
            : editando ? 'Editar movimento' : draft?.direcao === 'resgatar' ? 'Resgatar' : 'Aplicar'}
          onClose={() => setFolha(null)}
        />
        {folha && vd ? (
          <SheetScroll contentContainerStyle={styles.corpo}>
            {editandoValor ? null : (
              <Segmented
                options={[{ value: 'valor', label: 'Valor' }, { value: 'rendimento', label: 'Rendimento' }, { value: 'aplicado', label: 'Aplicado' }]}
                value={vd.modo}
                onChange={mudarModo}
              />
            )}
            <Field label={MODOS_DE_VALOR[vd.modo].campo}>
              <MoneyField valueCents={vd.cents} onChangeCents={(cents) => mudarValor({ cents })} autoFocus />
            </Field>
            {editandoValor || lista.length < 2 ? null : (
              <Field label="Investimento">
                <SelectField
                  value={vd.posicaoId}
                  onChange={(id) => mudarValor({ posicaoId: id, contaId: null })}
                  placeholder="Escolher a posição"
                  options={lista.map((p) => ({ id: p.account_id, label: p.name, icon: 'chart.line.uptrend.xyaxis' as const }))}
                />
              </Field>
            )}
            {vd.modo === 'rendimento' ? (
              <Field label="Em que conta caiu">
                <AccountPicker accounts={destinos} value={vd.contaId} onChange={(id) => mudarValor({ contaId: id })} placeholder="Escolher a conta" />
              </Field>
            ) : null}
            <Field label="Quando">
              <DatePickerField
                value={isoToBR(vd.data)}
                onChange={(br) => mudarValor({ data: isValidBRDate(br) ? brToISO(br) : '' })}
                max={ctx.hoje}
                accessibilityLabel="Data"
              />
            </Field>
            {vd.modo === 'aplicado' || editandoValor ? null : (
              <Field label="Nota">
                <TextField value={vd.nota} onChangeText={(nota) => mudarValor({ nota })} placeholder="Ex.: extrato da corretora" returnKeyType="done" />
              </Field>
            )}
            {validacaoValor.motivo ? (
              <ThemedText type="small" themeColor="danger" accessibilityRole="alert">{validacaoValor.motivo}</ThemedText>
            ) : null}
            <Button
              label={editandoValor ? 'Salvar' : MODOS_DE_VALOR[vd.modo].titulo}
              block
              loading={comandoValor.isPending}
              disabled={!validacaoValor.pronto}
              onPress={salvarValor}
            />
          </SheetScroll>
        ) : null}
        {folha && draft && !vd ? (
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
  acoes: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md, padding: Space.lg },
  erro: { alignItems: 'center', gap: Space.md },
  centro: { textAlign: 'center' },
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  efeito: { gap: Space.xs, alignItems: 'stretch' },
});
