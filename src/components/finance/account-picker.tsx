import { useMemo } from 'react';

import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { ACCOUNT_TYPES, accountTypeLabel } from '@/lib/accounts';
import type { IconName } from '@/components/ui/icon';

/** O mínimo que o seletor precisa saber. Aceita `Account` inteiro sem conversão. */
export type PickableAccount = {
  id: string;
  name: string;
  type?: string | null;
  closing_day?: number | null;
};

/**
 * Cada tipo tem a sua forma — é o que separa cartão de conta antes de qualquer
 * texto, e a razão de este componente existir.
 *
 * A fonte é `ACCOUNT_TYPES`: este mapa era uma cópia privada que discordava da
 * cópia da tela de contas em `cash`.
 */
const GLIFO: Record<string, IconName> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.value, t.icon])
);

/** A segunda linha: o tipo, e no cartão o dia que muda a decisão de onde lançar. */
function detalhe(conta: PickableAccount): string {
  const tipo = accountTypeLabel(conta);
  if (conta.type === 'credit_card' && conta.closing_day) {
    return `${tipo} · fecha dia ${conta.closing_day}`;
  }
  return tipo;
}

/**
 * Escolher a conta de um lançamento. **O único caminho** — nenhuma tela monta
 * lista de conta à mão.
 *
 * ## Por que ele existe
 *
 * O mesmo campo tinha OITO implementações: `<Row title={a.name}/>` em quatro
 * telas e `<Chip label={a.name}/>` em outras quatro. Em todas elas um cartão de
 * crédito e uma conta corrente têm exatamente a mesma cara. Foi assim que um
 * salário de R$ 4.000 foi parar dentro da fatura do cartão em 09/09/2026: a
 * pessoa procurou a conta do Nubank e tocou no cartão do Nubank — *"aparece só
 * nubank e eu achei que era a conta corrente nubank e nao cartao nubank"*.
 *
 * ## Como ele separa cartão de conta
 *
 * Por três caminhos ao mesmo tempo, porque o custo de errar aqui é um número
 * errado meses depois, sem erro nenhum na tela:
 *
 * 1. **Agrupamento** — "Contas" e "Cartões" são seções distintas. É o sinal mais
 *    forte e o mais barato de ler. Só aparece quando existem os dois grupos:
 *    com uma conta e nenhum cartão, o cabeçalho seria cerimônia.
 * 2. **Forma** — cada tipo tem o próprio glifo num ladrilho, então a coluna da
 *    esquerda é escaneável sem ler palavra nenhuma.
 * 3. **Palavra** — o tipo escrito embaixo do nome, e no cartão o dia de
 *    fechamento, que é o dado que decide em qual fatura a compra cai.
 *
 * ⚠️ **Sem cor de emissor.** A regra do projeto libera a cor da marca só DENTRO
 * da forma de um cartão de crédito (`card-brands.ts`); numa linha de lista ela
 * volta a ser cor de terceiro competindo com o único accent do app. A separação
 * aqui é forma e estrutura, não tinta.
 *
 * ⚠️ **O nome vem CRU aqui**, não por `accountLabel`. Aquele emenda "· Cartão"
 * para caber numa linha só; neste campo o tipo tem lugar próprio embaixo, e
 * repetir o sufixo ensina a pessoa a não ler o sufixo.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  emptyLabel,
  placeholder = 'Escolher conta',
}: {
  accounts: readonly PickableAccount[];
  value: string | null;
  onChange: (id: string | null) => void;
  /**
   * Rótulo da opção "sem conta". Omitido, a opção não existe — é o caso da
   * transferência, que precisa dos dois lados para significar alguma coisa.
   */
  emptyLabel?: string;
  placeholder?: string;
}) {
  const opcoes = useMemo<SelectOption[]>(() => {
    const contas = accounts.filter((a) => a.type !== 'credit_card');
    const cartoes = accounts.filter((a) => a.type === 'credit_card');
    // Cabeçalho só vale quando há o que separar.
    const agrupado = contas.length > 0 && cartoes.length > 0;

    return [
      ...(emptyLabel
        ? [{ id: null, label: emptyLabel, icon: 'minus' as IconName, neutral: true }]
        : []),
      ...contas.map((a) => ({
        id: a.id,
        label: a.name,
        meta: detalhe(a),
        icon: GLIFO[a.type ?? ''] ?? 'building.columns',
        group: agrupado ? 'CONTAS' : undefined,
      })),
      ...cartoes.map((a) => ({
        id: a.id,
        label: a.name,
        meta: detalhe(a),
        icon: 'creditcard' as IconName,
        group: agrupado ? 'CARTÕES' : undefined,
      })),
    ];
  }, [accounts, emptyLabel]);

  return (
    <SelectField
      options={opcoes}
      value={value}
      onChange={onChange}
      placeholder={emptyLabel ?? placeholder}
    />
  );
}
