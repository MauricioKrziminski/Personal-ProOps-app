import type { UseQueryResult } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/finance/chip';
import { MonthPicker, currentMonth } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useBRL } from '@/components/ui/conceal';
import { Field, MoneyField } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { Segmented } from '@/components/ui/segmented';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { Space } from '@/design/tokens';
import type { Adiantavel, ParcelaAdiantavel, Quais } from '@/lib/anticipation';
import { isoToBR } from '@/lib/dates';

/** Atalhos de quantas adiantar; "Todas" entra à parte, com o número de verdade. */
const QUANTAS = [1, 2, 3, 6, 12];

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
    const unidade = i.source === 'recurring' ? (n === 1 ? 'mês' : 'meses') : n === 1 ? 'parcela' : 'parcelas';
    return {
      id: i.ref_id,
      label: i.title,
      meta: [`${n} ${unidade} a vencer · ${brl(i.events[0].cents)}`, i.account_name]
        .filter(Boolean)
        .join(' · '),
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
        <Field label={recorrente ? 'Quantos meses' : 'Quantas parcelas'}>
          <View style={styles.chips}>
            {QUANTAS.filter((n) => n < total).map((n) => (
              <Chip key={n} label={String(n)} selected={p.quantas === n} onPress={() => p.onQuantas(n)} />
            ))}
            <Chip
              label={`Todas (${total})`}
              selected={p.quantas >= total}
              onPress={() => p.onQuantas(total)}
            />
          </View>
        </Field>
      ) : null}

      <Field label="Pagar em">
        <MonthPicker month={p.mes ?? currentMonth()} onChange={p.onMes} />
      </Field>

      {p.item && p.parcelas.length > 0 ? (
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

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  erro: { gap: Space.md, alignItems: 'flex-start' },
});
