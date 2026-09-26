/**
 * Os campos de "Editar a compra" num lugar só (26/09/2026, *"uma tela só de editar
 * componentizada… ter todos os campos de quando eu crio ao editar"*). As regras, puras e com
 * teste, moram em `lib/compra.ts`.
 *
 * Duas telas desenham isto: a folha de Parceladas e o formulário do lançamento de uma parcela, em
 * "A compra toda". A ordem é a do formulário de EVENTO (`frontend.md`): o nome, o dinheiro, como
 * ele se divide, quando. O que não muda continua VISÍVEL, com o motivo.
 */
import { AccountPicker } from '@/components/finance/account-picker';
import { CategoryPicker } from '@/components/finance/category-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
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
  contas: Parameters<typeof AccountPicker>[0]['accounts'];
}) {
  const { travado, tituloOk, totalOk, contaOk, emAberto, faixa, dataLivre } = validaCompra(form);
  const motivo = motivoDaTrava(form);
  const nomeDaConta = form.accountId ? (contas.find((c) => c.id === form.accountId)?.name ?? 'Conta') : 'Sem conta';

  return (
    <>
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
        error={totalOk ? undefined : recusaDoValor(form.travadas)}
        hint={
          form.unidade === 'parcela'
            ? `${travado ? `Vale para as ${emAberto} em aberto` : `${form.installments}x`} · total ${formatBRL(form.totalCents)}`
            : travado
              ? `${formatBRL(form.travadoCents)} já pago`
              : undefined
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

      <Field label="Conta" error={contaOk ? undefined : 'Escolha a conta desta compra'} hint={dataLivre ? undefined : motivo}>
        {dataLivre ? (
          <AccountPicker
            accounts={contas}
            value={form.accountId}
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
              ? `As ${emAberto} em aberto dividem ${formatBRL(Math.max(0, form.totalCents - form.travadoCents))}`
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

      <Field label="Data da primeira parcela" hint={dataLivre ? undefined : motivo}>
        {dataLivre ? (
          <DatePickerField
            value={form.inicio}
            onChange={(inicio) => onChange({ ...form, inicio })}
            accessibilityLabel="Data da primeira parcela"
            invalid={!isValidBRDate(form.inicio)}
          />
        ) : (
          <TextField editable={false} value={form.inicio} accessibilityLabel="Data da primeira parcela" />
        )}
      </Field>

      {/* Como na criação (26/09/2026): as primeiras N ficam pagas. A paga junto com uma fatura de
          verdade é o piso — para reabri-la, desfaz-se o pagamento da fatura. */}
      {form.installments > 1 ? (
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
      ) : null}
    </>
  );
}
