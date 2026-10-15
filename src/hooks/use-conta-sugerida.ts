import { useEffect, useRef } from 'react';
import { useDefaultAccount, useDefaultCard } from '@/hooks/use-finance';
import { contaNoConflito, contaSugerida } from '@/lib/conta-sugerida';
import type { PaymentMethod } from '@/lib/payment-method';

type Conta = { id: string; type?: string | null; archived?: boolean | null };

/**
 * Pré-seleciona a conta (ou cartão) padrão ao CRIAR do zero (`ativo`). Aplica quando contas e
 * padrões já chegaram, só enquanto o campo está vazio ou ainda é o que ela mesma pôs; a forma de
 * pagamento recalcula. Depois que a pessoa escolhe (`escolheu()`), não mexe mais — exceto quando a
 * forma muda e a conta deixa de servir para ela (`resolver`, `contaNoConflito`): aí entra o padrão
 * da forma nova em vez do erro.
 */
export function useContaSugerida(a: {
  ativo: boolean;
  resolver: boolean;
  contas: readonly Conta[] | undefined;
  forma: PaymentMethod | null | undefined;
  valor: string | null;
  aplicar: (id: string | null) => void;
}) {
  const padrao = useDefaultAccount();
  const cartao = useDefaultCard();
  const auto = useRef<string | null>(null);
  const pessoa = useRef(false);
  const { ativo, resolver, contas, forma, valor, aplicar } = a;
  const formaAntes = useRef(forma);
  const carregado = Boolean(contas) && !padrao.isPending && !cartao.isPending;
  useEffect(() => {
    if (!carregado || !contas) return;
    const mudouForma = formaAntes.current !== forma;
    formaAntes.current = forma;
    const base = { forma, contaPadrao: padrao.data, cartaoPadrao: cartao.data, contas };
    const troca = resolver && mudouForma ? contaNoConflito({ ...base, valor }) : null;
    if (troca) {
      pessoa.current = false;
      auto.current = troca;
      aplicar(troca);
      return;
    }
    if (!ativo || pessoa.current || (valor !== null && valor !== auto.current)) return;
    const sug = contaSugerida(base);
    if (sug === valor) return;
    auto.current = sug;
    aplicar(sug);
  }, [carregado, ativo, resolver, contas, forma, valor, padrao.data, cartao.data, aplicar]);
  return { escolheu: () => { pessoa.current = true; } };
}
