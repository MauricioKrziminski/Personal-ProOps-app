import { Forte } from '@/components/ui/forte';
import { useToast } from '@/components/ui/toast';
import { useDefaultAccount, useDefaultCard, useSetDefaultAccount, useSetDefaultCard } from '@/hooks/use-finance';
import type { ItemAction } from '@/lib/item-actions';

/**
 * "Definir como padrão" no menu de quem mostra UMA conta ou cartão (extrato, fatura, faturas,
 * linhas de Contas e Cartões). Cartão vira o cartão padrão; o resto, a conta padrão. Sendo já o
 * padrão, a ação desfaz.
 */
export function useAcaoDePadrao() {
  const toast = useToast();
  const conta = useDefaultAccount();
  const cartao = useDefaultCard();
  const definirConta = useSetDefaultAccount();
  const definirCartao = useSetDefaultCard();
  return (a: { id: string; name: string; type?: string | null }): ItemAction => {
    const ehCartao = a.type === 'credit_card';
    const ja = (ehCartao ? cartao.data : conta.data) === a.id;
    const nome = ehCartao ? 'cartão padrão' : 'conta padrão';
    const artigo = ehCartao ? 'o' : 'a';
    return {
      label: ja ? 'Deixar de ser padrão' : 'Definir como padrão',
      icon: 'star',
      selected: ja,
      onPress: () =>
        (ehCartao ? definirCartao : definirConta).mutate(ja ? null : a.id, {
          onSuccess: () =>
            toast({ message: ja ? <>Sem {nome} agora.</> : <><Forte>{a.name}</Forte> é {artigo} {nome}.</>, tone: 'success' }),
          onError: () => toast({ message: 'Não deu para mudar o padrão.', tone: 'error' }),
        }),
    };
  };
}
