import { PaymentMethodField } from '@/components/finance/payment-method-field';
import { paymentMethodAccounts, paymentMethodError } from '@/lib/payment-method';
/**
 * Os campos de "Editar a compra" num lugar só (26/09/2026, *"uma tela só de editar
 * componentizada… ter todos os campos de quando eu crio ao editar"*). As regras, puras e com
 * teste, moram em `lib/compra.ts`.
 *
 * Duas telas desenham isto: a folha de Parceladas e o formulário do lançamento de uma parcela, em
 * "A compra toda". A ordem é a do formulário de EVENTO (`frontend.md`): o nome, o dinheiro, como
 * ele se divide, quando. O que não muda continua VISÍVEL, com o motivo.
 */
import { OriginAccountPicker } from '@/components/finance/origin-creation-host';
import { CategoryPicker } from '@/components/finance/category-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { PurchaseDownPayment } from '@/components/finance/purchase-down-payment';
import { Presenca } from '@/components/motion/presenca';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Segmented } from '@/components/ui/segmented';
import {
  digitarNaCompra,
  motivoDaTrava,
  mudarParcelas,
  validaCompra,
  valorDoCampo,
  type CompraForm,
} from '@/lib/compra';
import { formatBRL, isValidBRDate } from '@/lib/dates';
import { UNIDADES_DO_VALOR, recusaDoValor } from '@/lib/finance-form';

export function CamposDaCompra({
  form,
  onChange,
  contas,
}: {
  form: CompraForm;
  onChange: (form: CompraForm) => void;
  contas: Parameters<typeof OriginAccountPicker>[0]['accounts'];
}) {
  const { travado, tituloOk, totalOk, contaOk, faixa, dataLivre } = validaCompra(form);
  const origem = contas.find((c) => c.id === form.accountId) ?? null;
  const erroMetodo = paymentMethodError(form.paymentMethod, origem);
  const motivo = motivoDaTrava(form);
  const nomeDaConta = form.accountId ? (contas.find((c) => c.id === form.accountId)?.name ?? 'Conta') : 'Sem conta';
  const cartao = contas.find((c) => c.id === form.accountId)?.type === 'credit_card';

  return (
    <>
      <PurchaseDownPayment type="parcelada" parentId={form.id} installmentsCents={form.totalCents} />
      <Field label="Título" error={tituloOk ? undefined : 'Escreva um título para esta compra'}>
        <TextField
          value={form.description}
          onChangeText={(description) => onChange({ ...form, description })}
          placeholder="Ex.: Fone de ouvido"
          accessibilityLabel="Título da compra"
          invalid={!tituloOk}
        />
      </Field>

      <Field label="Estabelecimento">
        <TextField
          value={form.merchant}
          onChangeText={(merchant) => onChange({ ...form, merchant })}
          placeholder="Ex.: Padaria do Zé"
          accessibilityLabel="Estabelecimento"
        />
      </Field>

      <Field
        label="Valor"
        error={totalOk ? undefined : recusaDoValor()}
        hint={
          form.unidade === 'parcela'
            ? `${form.installments}x · o alcance define quais parcelas recebem este valor`
            : travado
              ? `${formatBRL(form.travadoCents)} já pago · o alcance define o novo total`
              : 'Total das parcelas; a entrada aparece separadamente acima'
        }>
        {/* Sempre na tela: sumir no "À vista" subiria o formulário embaixo do "−". */}
        <Segmented options={UNIDADES_DO_VALOR} value={form.unidade} onChange={(unidade) => onChange({ ...form, unidade })} />
        <MoneyField
          valueCents={valorDoCampo(form)}
          onChangeCents={(v) => onChange({ ...form, ...digitarNaCompra(form, v) })}
          invalid={!totalOk}
          accessibilityLabel={form.unidade === 'parcela' ? 'Valor de cada parcela' : 'Valor total da compra'}
        />
      </Field>

      <Field label="Categoria">
        <CategoryPicker value={form.category} onChange={(category) => onChange({ ...form, category })} />
      </Field>

      <PaymentMethodField value={form.paymentMethod} onChange={(paymentMethod) => onChange({ ...form, paymentMethod })} error={!origem ? erroMetodo ?? undefined : undefined} />

      <Field label="Conta" error={origem && erroMetodo ? erroMetodo : contaOk ? undefined : 'Escolha a conta desta compra'} hint={origem && erroMetodo ? `Origem selecionada: ${origem.name}${motivo ? `. ${motivo}` : ''}` : dataLivre ? undefined : motivo}>
        {dataLivre ? (
          <OriginAccountPicker
            paymentMethod={form.paymentMethod}
            accounts={paymentMethodAccounts(form.paymentMethod, contas)}
            value={form.accountId}
            selectedAccount={origem}
            onChange={(accountId: string | null) => onChange({ ...form, accountId })}
            placeholder="Escolher a conta da compra"
          />
        ) : (
          <TextField editable={false} value={nomeDaConta} accessibilityLabel="Conta da compra" />
        )}
      </Field>

      <Field
        label="Parcelas"
        hint={
          form.installments === 1
            ? undefined
            : travado
              ? `Ao salvar, escolha se o novo total inclui as ${form.travadas} já pagas`
              : `${form.installments}x de ${formatBRL(Math.floor(form.totalCents / form.installments))}`
        }>
        <QuantityField
          value={form.installments}
          min={faixa.min}
          max={faixa.max}
          accessibilityLabel="Número de parcelas"
          onChange={(n) => onChange({ ...form, ...mudarParcelas(form, n) })}
        />
      </Field>

      {/* O motivo inteiro já está na Conta, logo acima: aqui só o efeito (menos texto). */}
      <Field label="Data da primeira parcela" hint={dataLivre ? undefined : 'Não muda, pelo mesmo motivo da conta'}>
        {dataLivre ? (
          <DatePickerField
            value={form.inicio}
            onChange={(inicio) => onChange({ ...form, inicio, ultimoDia: false })}
            // No cartão a parcela segue a data da compra: o último dia não vale ali.
            onSelectLastDay={cartao ? undefined : (inicio) => onChange({ ...form, inicio, ultimoDia: true })}
            lastDaySelected={Boolean(form.ultimoDia)}
            accessibilityLabel="Data da primeira parcela"
            invalid={!isValidBRDate(form.inicio)}
          />
        ) : (
          <TextField editable={false} value={form.inicio} accessibilityLabel="Data da primeira parcela" />
        )}
      </Field>

      {/* Como na criação (26/09/2026): as primeiras N ficam pagas. A paga junto com uma fatura de
          verdade é o piso — para reabri-la, desfaz-se o pagamento da fatura. */}
      <Presenca visivel={form.installments > 1}>
        <Field
          label="Parcelas já pagas"
          hint={form.pisoPagas > 0 ? `${form.pisoPagas} paga${form.pisoPagas === 1 ? '' : 's'} com a fatura do cartão` : undefined}>
          <QuantityField
            value={form.pagas}
            min={form.pisoPagas}
            max={form.installments}
            accessibilityLabel="Parcelas já pagas"
            onChange={(pagas) => onChange({ ...form, pagas })}
          />
        </Field>
      </Presenca>
    </>
  );
}
