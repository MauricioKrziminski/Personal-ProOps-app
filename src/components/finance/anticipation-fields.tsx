import type { UseQueryResult } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { MonthPicker, currentMonth } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useBRL } from '@/components/ui/conceal';
import { Field, MoneyField } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Note } from '@/components/ui/note';
import { Segmented } from '@/components/ui/segmented';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { Space } from '@/design/tokens';
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
            placeholder="Escolher"
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
          hint={recorrente ? undefined : `De ${total} ${total === 1 ? 'parcela' : 'parcelas'} a vencer.`}>
          <QuantityField value={p.quantas} max={total} onChange={p.onQuantas} />
        </Field>
      ) : null}

      <Field label="Pagar em">
        <MonthPicker month={p.mes ?? currentMonth()} onChange={p.onMes} />
      </Field>

      {p.item && p.parcelas.length > 0 ? (
        <>
          <Field
            label="Valor para pagar"
            hint={desconto ? 'Com desconto de juros estimado' : undefined}>
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

const styles = StyleSheet.create({
  erro: { gap: Space.md, alignItems: 'flex-start' },
});
