import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

import { monthTitle } from './month-picker';

/** O mínimo que o pager precisa saber de uma fatura. */
export interface PagerInvoice {
  id: string;
  reference_month: string;
}

interface InvoicePagerProps {
  /** Faturas do cartão, da mais nova para a mais antiga (ordem de `useCardInvoices`). */
  invoices: PagerInvoice[];
  currentId: string;
  onChange: (invoiceId: string) => void;
}

/** `2026-06-01` → `Junho de 2026`. */
function tituloDaFatura(referenceMonth: string): string {
  return monthTitle(referenceMonth.slice(0, 7));
}

/**
 * Navegador entre faturas de um cartão.
 *
 * Não é o `MonthPicker`: aquele anda em `YYYY-MM` somando ±1, e fatura é uma
 * lista **esparsa** — pode não existir fatura em todo mês (cartão sem compra não
 * gera uma), e existir fatura futura de parcelamento. Somar um mês cairia num
 * vazio. Aqui a navegação é sobre a LISTA que existe, não sobre o calendário.
 *
 * Ponta da lista faz a seta **sumir**, não ficar desabilitada: botão que não faz
 * nada é pior que botão ausente — ele convida ao toque e não responde.
 */
export function InvoicePager({ invoices, currentId, onChange }: InvoicePagerProps) {
  const theme = useTheme();
  const indice = invoices.findIndex((i) => i.id === currentId);
  if (indice < 0) return null;

  // A lista vem da mais nova para a mais antiga: "anterior" (mais velha) é +1.
  const anterior = invoices[indice + 1];
  const proxima = invoices[indice - 1];
  const atual = invoices[indice];

  const seta = (destino: PagerInvoice | undefined, direcao: 'anterior' | 'proxima') => {
    if (!destino) return <View style={styles.espaco} />;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          direcao === 'anterior'
            ? `Fatura anterior, ${tituloDaFatura(destino.reference_month)}`
            : `Próxima fatura, ${tituloDaFatura(destino.reference_month)}`
        }
        hitSlop={8}
        onPress={() => {
          Haptics.selectionAsync();
          onChange(destino.id);
        }}
        style={({ pressed }) => [
          styles.seta,
          { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        <Icon name={direcao === 'anterior' ? 'chevron.left' : 'chevron.right'} size="sm" color="tint" />
      </Pressable>
    );
  };

  return (
    <View style={styles.linha}>
      {seta(anterior, 'anterior')}
      <ThemedText
        type="smallBold"
        accessibilityRole="header"
        accessibilityLabel={`Fatura de ${tituloDaFatura(atual.reference_month)}`}
        style={styles.rotulo}>
        {tituloDaFatura(atual.reference_month)}
      </ThemedText>
      {seta(proxima, 'proxima')}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  seta: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // segura a largura da seta ausente para o título não pular de posição ao andar
  espaco: {
    width: HitTarget,
    height: HitTarget,
  },
  rotulo: {
    flex: 1,
    textAlign: 'center',
  },
});
