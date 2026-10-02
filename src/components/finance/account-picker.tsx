import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { SelectField, type SelectAction, type SelectOption } from '@/components/ui/select-field';
import { Button } from '@/components/ui/button';
import { useBRL, useConceal } from '@/components/ui/conceal';
import { usePresencaAtiva } from '@/components/motion/presenca';
import { Space } from '@/design/tokens';
import { useAccountBalances, useCardLimitContext } from '@/hooks/use-finance';
import { accountSelectOptions, type AccountOptionAccount, type AccountPickerContext } from '@/lib/accounts';

/** O mínimo que o seletor precisa saber. Aceita `Account` inteiro sem conversão. */
export type PickableAccount = AccountOptionAccount;

type AccountPickerProps = {
  accounts: readonly PickableAccount[];
  value: string | null;
  selectedAccount?: PickableAccount | null;
  onChange: (id: string | null) => void;
  actions?: readonly SelectAction[];
  disabled?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  /** Operações mostram dinheiro; filtros continuam escolhendo só a identidade. */
  financialContext?: boolean;
};

export function AccountPicker(props: AccountPickerProps) {
  return props.financialContext ? <FinancialAccountPicker {...props} /> : <AccountPickerField {...props} />;
}

function FinancialAccountPicker(props: AccountPickerProps) {
  const active = usePresencaAtiva();
  const visible = props.selectedAccount ? [...props.accounts, props.selectedAccount] : props.accounts;
  const hasBanks = visible.some(account => !account.archived && account.type !== 'credit_card');
  const hasCards = visible.some(account => !account.archived && account.type === 'credit_card');
  const balances = useAccountBalances(active && hasBanks);
  const cards = useCardLimitContext(active && hasCards);
  const { concealed, ready } = useConceal();
  const format = useBRL();
  const context: AccountPickerContext = { balances, cards, format, concealed: concealed || !ready };
  const options = accountSelectOptions(visible, undefined, null, context);
  const retryBanks = hasBanks && (balances.isError || options.some(option => option.icon !== 'creditcard' && 'detailUnavailable' in option && option.detailUnavailable));
  const retryCards = hasCards && (cards.isError || options.some(option => option.icon === 'creditcard' && 'detailUnavailable' in option && option.detailUnavailable));
  const retry = () => Promise.allSettled([
    ...(retryBanks ? [balances.refetch({ cancelRefetch: false })] : []), ...(retryCards ? [cards.refetch({ cancelRefetch: false })] : []),
  ]);
  return <View style={styles.context}>
    <AccountPickerField {...props} context={context} />
    {retryBanks || retryCards ? <Button label="Atualizar saldos e limites" variant="secondary" size="sm"
      disabled={props.disabled || !active || retryBanks && balances.isFetching || retryCards && cards.isFetching}
      onPress={() => { void retry(); }} /> : null}
  </View>;
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
function AccountPickerField({
  accounts,
  value,
  selectedAccount,
  onChange,
  actions,
  disabled,
  emptyLabel,
  placeholder = 'Escolher conta',
  context,
}: AccountPickerProps & { context?: AccountPickerContext }) {
  const opcoes = useMemo<SelectOption[]>(() => accountSelectOptions(accounts, emptyLabel, null, context), [accounts, emptyLabel, context]);

  return (
    <SelectField
      options={opcoes}
      value={value}
      selectedOption={selectedAccount ? accountSelectOptions([selectedAccount], undefined, null, context)[0] : null}
      onChange={onChange}
      actions={actions}
      disabled={disabled}
      placeholder={emptyLabel ?? placeholder}
    />
  );
}

const styles = StyleSheet.create({ context: { gap: Space.sm } });
