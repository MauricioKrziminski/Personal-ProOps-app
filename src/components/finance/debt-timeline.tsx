import { LinhaDoTempo } from '@/components/finance/linha-do-tempo';
import { useBRL } from '@/components/ui/conceal';
import { isoToBR, localISODate } from '@/lib/dates';
import type { ItemDaLinha } from '@/lib/debt-history';
import { diferencaDoPrevisto, parcelaDoContratoPaga } from '@/lib/previsto';

/**
 * O contrato inteiro numa linha do tempo, agrupado por ano (23/09/2026).
 *
 * Substituiu uma tabela de seis colunas em letra `footnote`, que rolava na horizontal — a queixa
 * foi *"os textos estão muito pequenos e a tabela não é bonita"*. Uma parcela é uma linha só: o
 * número dela, quando vence e o valor. O desenho mora em `LinhaDoTempo`, o mesmo das outras listas
 * que se abrem (compras parceladas, compras da fatura); aqui só se diz o que cada parcela é.
 */
export function DebtTimeline({
  anos,
  onItemPress,
  comJuros = false,
}: {
  anos: { ano: string; itens: ItemDaLinha[] }[];
  /**
   * O contrato tem juros (não é de parcela fixa). Na parcela fixa, a paga com outro valor diz a
   * DIFERENÇA ("pagou R$ 10,00 a menos", 08/10/2026); com juros, quanto daquele pagamento foi juros.
   */
  comJuros?: boolean;
  /** Toda parcela abre (25/09/2026): a paga com lançamento, o lançamento; a outra, a tela dela. */
  onItemPress?: (item: ItemDaLinha) => void;
}) {
  // Dinheiro dentro de frase obedece ao "esconder saldo" — `Money` é bloco e não cabe aqui.
  const brl = useBRL();
  const hoje = localISODate();

  return (
    <LinhaDoTempo
      grupos={anos.map(({ ano, itens }) => ({
        titulo: ano,
        itens: itens.map((item) => {
          const proxima = item.estado === 'proxima';
          const quando =
            item.estado === 'paga'
              ? `paga em ${isoToBR(item.iso)}`
              : item.estado === 'estimada'
                ? `paga · por volta de ${isoToBR(item.iso)}`
                : item.iso < hoje
                  // Vencida e não paga: a data fica a do contrato, e a linha diz que atrasou (05/10/2026).
                  ? `atrasada · venceu ${isoToBR(item.iso)}`
                  : proxima
                    ? `a próxima · vence ${isoToBR(item.iso)}`
                    : `vence ${isoToBR(item.iso)}`;
          const contrato = item.estado === 'paga'
            ? parcelaDoContratoPaga({ amount_cents: item.cents, debt_principal_cents: item.principalCents }, comJuros)
            : null;
          const jurosPagos = item.estado === 'paga' && comJuros && (item.jurosPagosCents ?? 0) > 0 ? item.jurosPagosCents! : null;
          const apoio = [
            quando,
            diferencaDoPrevisto(item.cents, contrato, brl),
            jurosPagos === null ? null : `juros ${brl(jurosPagos)}`,
            item.jurosCents ? `juros ${brl(item.jurosCents)}` : null,
          ].filter(Boolean).join(' · ');
          return {
            chave: String(item.n),
            titulo: `${item.n}ª parcela`,
            apoio,
            cents: item.cents,
            estado: item.estado,
            accessibilityLabel: `${item.n}ª parcela, ${apoio}, ${item.estado === 'paga' ? 'pago ' : ''}${brl(item.cents)}`,
            onPress: onItemPress ? () => onItemPress(item) : undefined,
          };
        }),
      }))}
    />
  );
}
