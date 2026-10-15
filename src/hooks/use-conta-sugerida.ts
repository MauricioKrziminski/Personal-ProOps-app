import { useEffect, useRef } from 'react';
import { useDefaultAccount, useDefaultCard } from '@/hooks/use-finance';
import { contaSugerida } from '@/lib/conta-sugerida';
import type { PaymentMethod } from '@/lib/payment-method';

type Conta = { id: string; type?: string | null; archived?: boolean | null };

/**
 * Pré-seleciona a conta (ou cartão) padrão ao CRIAR do zero. Aplica quando contas e padrões já
 * chegaram, só enquanto o campo está vazio ou ainda é o que ela mesma pôs; a forma de pagamento
 * recalcula. Depois que a pessoa escolhe (`escolheu()`), nunca mais mexe.
 */
export function useContaSugerida(a: {
  ativo: boolean;
  contas: readonly Conta[] | undefined;
  forma: PaymentMethod | null | undefined;
  valor: string | null;
  aplicar: (id: string | null) => void;
}) {
  const padrao = useDefaultAccount();
  const cartao = useDefaultCard();
  const auto = useRef<string | null>(null);
  const pessoa = useRef(false);
  const { ativo, contas, forma, valor, aplicar } = a;
  const pronto = ativo && Boolean(contas) && !padrao.isPending && !cartao.isPending;
  useEffect(() => {
    if (!pronto || !contas || pessoa.current || (valor !== null && valor !== auto.current)) return;
    const sug = contaSugerida({ forma, contaPadrao: padrao.data, cartaoPadrao: cartao.data, contas });
    if (sug === valor) return;
    auto.current = sug;
    aplicar(sug);
  }, [pronto, contas, forma, valor, padrao.data, cartao.data, aplicar]);
  return { escolheu: () => { pessoa.current = true; } };
}
