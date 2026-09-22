import type { UseQueryResult } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MonthPicker, currentMonth } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useBRL } from '@/components/ui/conceal';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Note } from '@/components/ui/note';
import { Segmented } from '@/components/ui/segmented';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { Adiantavel, ParcelaAdiantavel, Quais } from '@/lib/anticipation';
import { isoToBR } from '@/lib/dates';

/** `ordem`: o `SelectField` junta só cabeçalhos CONSECUTIVOS — a lista vem do banco por data. */
const FONTE: Record<Adiantavel['source'], { grupo: string; icone: SelectOption['icon']; ordem: number }> = {
  plan: { grupo: 'Compras parceladas', icone: 'creditcard', ordem: 0 },
  debt: { grupo: 'Financiamentos', icone: 'building.columns', ordem: 1 },
  recurring: { grupo: 'Contas fixas', icone: 'arrow.triangle.2.circlepath', ordem: 2 },
};

interface Props {
  consulta: UseQueryResult<Adiantavel[]>;
  item: Adiantavel | null;
  itemId: string | null;
  onItem: (id: string | null) => void;
  quantas: number;
  onQuantas: (n: number) => void;
  quais: Quais;
  onQuais: (q: Quais) => void;
  mes: string | null;
  onMes: (mes: string) => void;
  parcelas: ParcelaAdiantavel[];
  /** A quantidade não cabe no que resta a vencer (`erroDeQuantidade`). Trava a hipótese. */
  erroQuantidade: string | null;
  valor: number;
  onValor: (cents: number) => void;
}

/**
 * Os campos do "E se… adiantar" (spec 2026-09-21). A ordem segue `frontend.md`: o que muda QUAIS
 * campos existem vem antes — o item decide se há "as últimas/as próximas" (recorrente não tem
 * fim) e quantas parcelas cabem; o mês do pagamento decide o que ainda dá para adiantar e o
 * valor presente; o valor, por último, nasce na sugestão e é editável.
 */
export function AdiantarCampos(p: Props) {
  const brl = useBRL();
  const lista = p.consulta.data ?? [];

  const ordenada = [...lista].sort((a, b) => FONTE[a.source].ordem - FONTE[b.source].ordem);
  const opcoes: SelectOption[] = ordenada.map((i) => {
    const n = i.events.length;
    // Conta fixa não tem fim: "120 meses a vencer" seria o tamanho da JANELA, não um fato dela.
    const quanto = i.source === 'recurring'
      ? `todo mês · ${brl(i.events[0].cents)}`
      : `${n} ${n === 1 ? 'parcela' : 'parcelas'} a vencer · ${brl(i.events[0].cents)}`;
    return {
      id: i.ref_id,
      label: i.title,
      meta: [quanto, i.account_name].filter(Boolean).join(' · '),
      icon: FONTE[i.source].icone,
      group: FONTE[i.source].grupo,
    };
  });

  const recorrente = p.item?.source === 'recurring';
  const total = p.item?.events.length ?? 0;
  const tirado = p.parcelas.reduce((s, x) => s + x.cents, 0);
  const primeira = p.parcelas[0]?.day;
  const ultima = p.parcelas[p.parcelas.length - 1]?.day;
  const desconto = p.item?.source === 'debt' && (p.item.taxa ?? 0) > 0;

  return (
    <>
      <Field label="O que adiantar">
        {p.consulta.isPending ? (
          <Skeleton height={56} />
        ) : p.consulta.isError ? (
          <View style={styles.erro}>
            <ThemedText type="small" themeColor="textSecondary">
              Não consegui carregar o que dá para adiantar.
            </ThemedText>
            <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => void p.consulta.refetch()} />
          </View>
        ) : lista.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nada a vencer depois desse mês: nenhuma parcela, financiamento ou conta fixa.
          </ThemedText>
        ) : (
          <SelectField
            options={opcoes}
            value={p.item ? p.itemId : null}
            onChange={p.onItem}
            placeholder="Escolha uma compra, financiamento ou conta"
          />
        )}
      </Field>

      {p.item && !recorrente ? (
        <Field label="Quais parcelas">
          <Segmented
            options={[
              { value: 'ultimas', label: 'As últimas' },
              { value: 'proximas', label: 'As próximas' },
            ]}
            value={p.quais}
            onChange={p.onQuais}
          />
        </Field>
      ) : null}

      {p.item ? (
        <Field
          label={recorrente ? 'Quantos meses' : 'Quantas parcelas'}
          error={p.erroQuantidade ?? undefined}
          hint={recorrente || p.erroQuantidade ? undefined : `De ${total} ${total === 1 ? 'parcela' : 'parcelas'} a vencer.`}>
          <Quantidade valor={p.quantas} maximo={total} invalido={Boolean(p.erroQuantidade)} onChange={p.onQuantas} />
        </Field>
      ) : null}

      <Field label="Pagar em">
        <MonthPicker month={p.mes ?? currentMonth()} onChange={p.onMes} />
      </Field>

      {/* Com a quantidade inválida, valor e resumo seriam do que SOBROU, não do que foi pedido. */}
      {p.item && p.parcelas.length > 0 && !p.erroQuantidade ? (
        <>
          <Field
            label="Valor para pagar"
            hint={desconto ? 'Sugestão com o desconto dos juros; use o valor que o banco informar.' : undefined}>
            <MoneyField valueCents={p.valor} onChangeCents={p.onValor} />
          </Field>
          <Note icon="arrow.uturn.backward">
            {p.parcelas.length === 1
              ? `Deixa de sair ${brl(tirado)} em ${isoToBR(primeira!)}.`
              : `Deixam de sair ${brl(tirado)}, de ${isoToBR(primeira!)} a ${isoToBR(ultima!)}.`}
          </Note>
        </>
      ) : null}
    </>
  );
}

/**
 * Quantidade ABERTA: digita qualquer número, e − / + para o ajuste fino. Sem atalhos fixos
 * (pedido do dono do produto: *"essas coisas nunca devem ser fixadas"*). O teto é o que existe
 * (as parcelas a vencer; na conta fixa, a janela da Projeção) — passar dele assenta no teto ao
 * sair do campo, e o campo mostra o número que valeu.
 */
function Quantidade({ valor, maximo, invalido, onChange }: {
  valor: number; maximo: number; invalido: boolean; onChange: (n: number) => void;
}) {
  const theme = useTheme();
  // Só DURANTE a digitação o campo mostra o texto cru: apagar para digitar outro número não pode
  // virar "0" no meio do caminho. Fora dela, mostra o número que valeu.
  const [digitando, setDigitando] = useState<string | null>(null);
  const muda = (n: number) => {
    const certo = Math.max(1, Math.min(n, maximo));
    if (certo !== valor) Haptics.selectionAsync();
    // − / + com o campo ainda em foco: sem largar o texto digitado, o campo continuava mostrando
    // o número antigo enquanto o valor já era outro (visto no simulador, 22/09/2026)
    setDigitando(null);
    onChange(certo);
  };
  const botao = (icone: 'minus' | 'plus', rotulo: string, alvo: number, desligado: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: desligado }}
      disabled={desligado}
      onPress={() => muda(alvo)}
      style={({ pressed }) => [
        styles.passo,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, opacity: desligado ? 0.4 : 1 },
      ]}>
      <Icon name={icone} size="sm" color="text" />
    </Pressable>
  );
  return (
    <View style={styles.quantidade}>
      {/* acima do teto, "−" leva direto ao teto: é a correção que o aviso pede */}
      {botao('minus', 'Uma a menos', valor > maximo ? maximo : valor - 1, valor <= 1)}
      <TextField
        value={digitando ?? String(valor)}
        onChangeText={(t) => {
          const digitos = t.replace(/\D/g, '').slice(0, 3);
          setDigitando(digitos);
          const n = Number(digitos);
          if (n >= 1) onChange(Math.min(n, maximo));
        }}
        onBlur={() => setDigitando(null)}
        keyboardType="number-pad"
        selectTextOnFocus
        accessibilityLabel="Quantidade"
        invalid={invalido}
        style={[styles.numero, tabular]}
      />
      {botao('plus', 'Uma a mais', valor + 1, valor >= maximo)}
    </View>
  );
}

const styles = StyleSheet.create({
  quantidade: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  passo: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numero: { flex: 1, textAlign: 'center' },
  erro: { gap: Space.md, alignItems: 'flex-start' },
});
