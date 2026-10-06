import { useMemo } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';

import { Chip } from '@/components/finance/chip';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBRL } from '@/components/ui/conceal';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { MeasuredSparkline } from '@/components/ui/measured-sparkline';
import { Money } from '@/components/ui/money';
import { Note } from '@/components/ui/note';
import { QuantityField } from '@/components/ui/quantity-field';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Space, tabular } from '@/design/tokens';
import { useNetWorth } from '@/hooks/use-finance';
import { umDe, usePreferencia } from '@/hooks/use-preferencia';
import {
  CENARIO_PADRAO,
  lerCenarios,
  paraPremissas,
  quandoAtinge,
  simular,
  taxaMensal,
  validar,
  type Cenario,
} from '@/lib/accumulation';
import { formatNumberBR } from '@/lib/dates';

const MODOS = ['acumular', 'renda'] as const;
const aceitaTexto = (v: string | number): v is string => typeof v === 'string';
const aceitaNumero = (v: string | number): v is number => typeof v === 'number';
const padraoJson = JSON.stringify([CENARIO_PADRAO]);

/** Só dígitos, vírgula, ponto e sinal: a validação do domínio explica o resto. */
const soPercentual = (t: string) => t.replace(/[^\d,.-]/g, '').slice(0, 7);

export default function Acumulacao() {
  const brl = useBRL();
  const investimentos = useNetWorth().data?.investments_cents ?? 0;
  const [modo, setModo] = usePreferencia<(typeof MODOS)[number]>('acumulacao:modo', 'acumular', umDe(MODOS));
  const [json, setJson] = usePreferencia('acumulacao:cenarios', padraoJson, aceitaTexto);
  const [selBruto, setSel] = usePreferencia('acumulacao:sel', 0, aceitaNumero);
  const cenarios = useMemo(() => lerCenarios(json), [json]);
  const sel = Math.min(selBruto, cenarios.length - 1);
  const atual = cenarios[sel];

  const grava = (lista: Cenario[]) => setJson(JSON.stringify(lista));
  const muda = (parte: Partial<Cenario>) =>
    grava(cenarios.map((c, i) => (i === sel ? { ...c, ...parte } : c)));
  const adiciona = () => {
    grava([...cenarios, atual]);
    setSel(cenarios.length);
  };
  const remove = () => {
    grava(cenarios.filter((_, i) => i !== sel));
    setSel(Math.max(0, sel - 1));
  };

  // Um resultado por cenário: a tabela compara todos, a curva mostra o escolhido.
  const resultados = useMemo(
    () =>
      cenarios.map((c) => {
        const p = paraPremissas(c);
        const erro = validar(p);
        return { erro, r: erro ? null : simular(p) };
      }),
    [cenarios],
  );
  const { erro, r } = resultados[sel];
  const pct = (nome: 'taxa' | 'inflacao' | 'retirada', rotulo: string, dica?: string) => (
    <Field label={rotulo} hint={dica}>
      <TextField
        value={atual[nome]}
        onChangeText={(t) => muda({ [nome]: soPercentual(t) })}
        keyboardType="numbers-and-punctuation"
        accessibilityLabel={rotulo}
      />
    </Field>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Quanto vou acumular' }} />
      <Segmented
        options={[
          { value: 'acumular', label: 'Acumular' },
          { value: 'renda', label: 'Renda desejada' },
        ]}
        value={modo}
        onChange={setModo}
      />
      {/* Rotulado: sem o rótulo, a fileira de cenários colava no seletor acima como um segundo
          par de abas (06/10/2026). */}
      <Field label="Cenário">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
          {cenarios.map((_, i) => (
            <Chip key={i} label={`Cenário ${i + 1}`} selected={i === sel} onPress={() => setSel(i)} />
          ))}
        </View>
      </Field>

      <View style={{ gap: Space.md }}>
        {modo === 'acumular' ? (
          <>
            <Field label="Patrimônio inicial">
              <MoneyField valueCents={atual.inicialCents} onChangeCents={(c) => muda({ inicialCents: c })} accessibilityLabel="Patrimônio inicial" />
            </Field>
            {investimentos > 0 && atual.inicialCents !== investimentos ? (
              <Button
                label={`Usar meus investimentos (${brl(investimentos)})`}
                variant="secondary"
                size="sm"
                onPress={() => muda({ inicialCents: investimentos })}
              />
            ) : null}
            <Field label="Aporte por mês">
              <MoneyField valueCents={atual.aporteCents} onChangeCents={(c) => muda({ aporteCents: c })} accessibilityLabel="Aporte por mês" />
            </Field>
            <Field label="Aporte no">
              <Segmented
                options={[
                  { value: 'fim', label: 'Fim do mês' },
                  { value: 'inicio', label: 'Início do mês' },
                ]}
                value={atual.inicio ? 'inicio' : 'fim'}
                onChange={(v) => muda({ inicio: v === 'inicio' })}
              />
            </Field>
          </>
        ) : (
          <Field label="Renda mensal desejada" hint="Em dinheiro de hoje.">
            <MoneyField valueCents={atual.rendaCents} onChangeCents={(c) => muda({ rendaCents: c })} accessibilityLabel="Renda mensal desejada" />
          </Field>
        )}
        <Field label="Anos">
          <QuantityField value={atual.anos} min={0} max={100} onChange={(anos) => muda({ anos })} accessibilityLabel="Anos" />
        </Field>
        <Field label="Meses">
          <QuantityField value={atual.meses} min={0} max={11} onChange={(meses) => muda({ meses })} accessibilityLabel="Meses" />
        </Field>
        <Field label="Taxa">
          <Segmented
            options={[
              { value: 'ano', label: '% ao ano' },
              { value: 'mes', label: '% ao mês' },
            ]}
            value={atual.porMes ? 'mes' : 'ano'}
            onChange={(v) => muda({ porMes: v === 'mes' })}
          />
        </Field>
        {pct('taxa', atual.porMes ? 'Taxa hipotética (% ao mês)' : 'Taxa hipotética (% ao ano)')}
        {pct('inflacao', 'Inflação (% ao ano)', '0 ignora a inflação.')}
        {modo === 'renda' ? pct('retirada', 'Taxa de retirada (% ao ano)', 'Ex.: 4.') : null}
      </View>

      {erro ? (
        <Note tone="danger" icon="exclamationmark.circle">{erro}</Note>
      ) : r ? (
        <Card>
          <ThemedText type="footnote" themeColor="textSecondary">
            {modo === 'acumular' ? 'Valor no fim' : 'Capital necessário'}
          </ThemedText>
          <Money cents={modo === 'acumular' ? r.fimCents : r.capitalCents} variant="largeTitle" />
          {modo === 'acumular' ? (
            <>
              {atual.inflacao.trim() !== '' && paraPremissas(atual).inflacao > 0 ? (
                <ThemedText type="small" style={tabular}>
                  Em dinheiro de hoje: {brl(r.fimRealCents)}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                Aportado {brl(r.aportadoCents)} · rendimento {brl(r.rendimentoCents)}
              </ThemedText>
              {r.perdeParaInflacao ? (
                <Note tone="warning" icon="exclamationmark.triangle">Perde para a inflação.</Note>
              ) : null}
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Com as premissas de Acumular, {quandoAtinge(r.atingeMes)}.
            </ThemedText>
          )}
          <MeasuredSparkline values={r.curva} height={120} showZero />
          <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
            Taxa mensal equivalente: {formatNumberBR(Number((taxaMensal(paraPremissas(atual)) * 100).toFixed(4)))}% ao mês
          </ThemedText>
        </Card>
      ) : null}

      {cenarios.length > 1 ? (
        <Section title="Comparar">
          {resultados.map(({ erro: e, r: res }, i) => (
            <Row
              key={i}
              title={`Cenário ${i + 1}`}
              subtitle={
                e ? e : modo === 'acumular' ? 'Valor no fim' : `Capital necessário · ${quandoAtinge(res!.atingeMes)}`
              }
              trailing={res ? <Money cents={modo === 'acumular' ? res.fimCents : res.capitalCents} /> : undefined}
              onPress={() => setSel(i)}
              chevron={false}
            />
          ))}
        </Section>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
        {cenarios.length < 3 ? <Button label="Comparar" variant="secondary" size="sm" onPress={adiciona} /> : null}
        {cenarios.length > 1 ? <Button label="Remover cenário" variant="secondary" size="sm" onPress={remove} /> : null}
      </View>

      <Note>Simulação com as taxas que você escolheu. Não é recomendação nem promessa de retorno.</Note>
    </Screen>
  );
}
