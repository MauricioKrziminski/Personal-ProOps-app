import { PaymentMethodField } from '@/components/finance/payment-method-field';
import { paymentMethodAccounts, paymentMethodError } from '@/lib/payment-method';
/**
 * Os campos da SÉRIE recorrente num lugar só (26/09/2026, *"uma tela só de editar
 * componentizada… ter todos os campos de quando eu crio ao editar"*). As regras, puras e com
 * teste, moram em `lib/serie.ts`.
 *
 * Dois corpos do formulário único desenham isto: o Recorrente (criar e editar a série) e o do
 * lançamento, quando uma ocorrência é editada em "Esta e as próximas". Duas cópias dos campos
 * divergiriam — foi assim que a edição ficou sem Repete, sem vencimento e sem Tipo.
 */
import { CategoryPicker } from '@/components/finance/category-picker';
import { MudancaSuave, Presenca } from '@/components/motion/presenca';
import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { SelectField } from '@/components/ui/select-field';
import { SwitchRow } from '@/components/ui/switch-row';
import { brToISO, localISODate } from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';
import { describeRRule } from '@/lib/rrule-text';
import { mudaInicioDaSerie, validaSerie, type SerieForm } from '@/lib/serie';

export function CamposDaSerie({
  form,
  onChange,
  contas,
  rotuloDaData = 'Próximo vencimento',
}: {
  form: SerieForm;
  onChange: (form: SerieForm) => void;
  contas: Parameters<typeof AccountPicker>[0]['accounts'];
  /** Editando, o nome da data: "Próximo vencimento" na série; "Vence em" na ocorrência. */
  rotuloDaData?: string;
}) {
  const { inicioOk, fimOk, tituloOk, agendaNoPassado, inicioDate } = validaSerie(form);
  const origem = contas.find((c) => c.id === form.accountId) ?? null;
  const erroMetodo = paymentMethodError(form.paymentMethod, origem);
  const editando = Boolean(form.id);
  const mudaAgenda = (parte: Partial<SerieForm>) => onChange({ ...form, ...parte, agendaMudou: editando || form.agendaMudou });
  const periodo = form.preset === 'weekly' ? 'da semana' : form.preset === 'yearly' ? 'do ano' : 'do mês';

  return (
    <>
      <Field label="Tipo">
        {/* A série grava `kind` e as futuras em aberto vão junto. O padrão do "entra como pago"
            só acompanha numa série nova. */}
        <SelectField
          options={[
            { id: 'expense', label: 'Gasto', icon: 'arrow.up.right' },
            { id: 'income', label: 'Receita', icon: 'arrow.down.left' },
          ]}
          value={form.kind}
          placeholder="Escolher o tipo"
          onChange={(id) => {
            if (id === form.kind) return;
            if (id !== 'expense' && id !== 'income') return;
            const kind = id;
            onChange(editando ? { ...form, kind } : { ...form, kind, autoConfirm: kind !== 'income' });
          }}
        />
      </Field>

      <Field label="Título" error={form.description.length > 0 && !tituloOk ? 'Escreva um título' : undefined}>
        <TextField
          value={form.description}
          onChangeText={(description) => onChange({ ...form, description })}
          placeholder="Ex.: Aluguel"
          invalid={form.description.length > 0 && !tituloOk}
        />
      </Field>

      {/* A ordem do formulário de evento: título → estabelecimento → valor (frontend.md). */}
      <Field label="Estabelecimento">
        <TextField
          value={form.merchant}
          onChangeText={(merchant) => onChange({ ...form, merchant })}
          placeholder="Ex.: Imobiliária Centro"
          accessibilityLabel="Estabelecimento"
        />
      </Field>

      <Field label="Valor">
        <MoneyField valueCents={form.amountCents} onChangeCents={(amountCents) => onChange({ ...form, amountCents })} />
      </Field>

      <Field label="Categoria">
        <CategoryPicker value={form.category} onChange={(category) => onChange({ ...form, category })} />
      </Field>

      <PaymentMethodField value={form.paymentMethod} onChange={(paymentMethod) => onChange({ ...form, paymentMethod })} error={!origem ? erroMetodo ?? undefined : undefined} />

      <Field label="Conta" error={origem ? erroMetodo ?? undefined : undefined} hint={origem && erroMetodo ? `Origem selecionada: ${origem.name}` : undefined}>
        <AccountPicker
          accounts={paymentMethodAccounts(form.paymentMethod, contas)}
          value={form.accountId}
          selectedAccount={origem}
          onChange={(accountId: string | null) => onChange({ ...form, accountId })}
          emptyLabel="Não informar"
        />
      </Field>

      <Presenca visivel={Boolean(form.regraPropria)}>
        {/* Regra que o app não sabe desenhar: por extenso, e trocar é um toque consciente — a
            regra da IA não volta. O vencimento só muda junto com ela. */}
        <Field label="Repete" hint={`Próximo vencimento ${form.inicio}`}>
          <ThemedText type="small" themeColor="textSecondary">
            {describeRRule(form.regraPropria ?? null)}
          </ThemedText>
          <Button
            label="Substituir"
            variant="secondary"
            size="sm"
            onPress={() =>
              confirmDestructive(
                'Substituir esta repetição?',
                'Substituir',
                () => onChange({ ...form, regraPropria: undefined, agendaMudou: true }),
                `A repetição ${describeRRule(form.regraPropria ?? null)} não volta.`,
              )
            }
          />
        </Field>
      </Presenca>

      <Presenca visivel={!form.regraPropria}>
      <Field label="Repete">
        <SelectField
          options={[
            { id: 'monthly', label: 'Mensal', icon: 'calendar' },
            { id: 'weekly', label: 'Semanal', icon: 'calendar' },
            { id: 'yearly', label: 'Anual', icon: 'calendar' },
          ]}
          value={form.preset}
          placeholder="Escolher a repetição"
          onChange={(preset) => {
            if (preset === form.preset) return;
            if (preset === 'monthly' || preset === 'weekly' || preset === 'yearly') mudaAgenda({ preset });
          }}
        />
      </Field>
      </Presenca>

      <Presenca visivel={form.preset === 'monthly' && !form.regraPropria}>
        <Field label="A cada quantos meses">
          {/* Campo de quantidade (`QuantityField`): "0" não existe, então não há erro a mostrar. */}
          <QuantityField
            value={Number(form.intervalo) || 1}
            max={99}
            accessibilityLabel="A cada quantos meses"
            onChange={(n) => mudaAgenda({ intervalo: String(n) })}
          />
        </Field>
      </Presenca>

      <Presenca visivel={!form.regraPropria}>
      <Field
        // Editando, a data é o próximo vencimento; o calendário tem uma ação própria de fim do mês.
        label={editando ? rotuloDaData : 'Começa em'}
        hint={
          editando
            ? form.agendaMudou ? `Refaz as em aberto ${periodo} desta data em diante` : undefined
            : inicioOk && brToISO(form.inicio) < localISODate() ? 'Já lança as passadas' : undefined
        }
        error={form.inicio && !inicioOk ? 'Data inválida (dd/mm/aaaa)' : agendaNoPassado ? 'Escolha hoje ou uma data depois' : undefined}>
        <DatePickerField
          value={form.inicio}
          onChange={(inicio) => onChange(mudaInicioDaSerie(form, inicio, false))}
          onSelectLastDay={form.preset === 'monthly' ? (inicio) => onChange(mudaInicioDaSerie(form, inicio, true)) : undefined}
          lastDaySelected={form.preset === 'monthly' && Boolean(form.ultimoDia)}
          placeholder="Escolher o início"
          accessibilityLabel={editando ? 'Próximo vencimento da série' : 'Data de início da série'}
          min={editando ? localISODate() : undefined}
          invalid={(Boolean(form.inicio) && !inicioOk) || agendaNoPassado}
        />
        <Presenca visivel={form.preset === 'monthly' && Boolean(inicioDate)}>
          <MudancaSuave valor={form.ultimoDia ? 'ultimo' : form.inicio}>
          <ThemedText type="small" themeColor="textSecondary">
            {form.ultimoDia
              ? 'Repete no último dia de todo mês.'
              : inicioDate ? `Repete todo dia ${inicioDate.getDate()}${inicioDate.getDate() > 28 ? '; nos meses curtos, no último dia disponível.' : '.'}` : ''}
          </ThemedText>
          </MudancaSuave>
        </Presenca>
      </Field>
      </Presenca>

      {/*
        ⚠️ O placeholder era uma DATA PLAUSÍVEL (`31/12/2026`) e o campo lia como preenchido — *"como
        assim 'Termina em'? Se é recorrente não termina"* (09/09/2026). Ele diz o que o vazio
        SIGNIFICA: a série sem fim é o caso normal.
      */}
      <Field label="Termina em" error={form.fim && !fimOk ? 'Informe data válida igual ou posterior ao início' : undefined}>
        <DatePickerField
          value={form.fim}
          onChange={(fim) => onChange({ ...form, fim })}
          placeholder="Sem fim"
          accessibilityLabel="Data em que a série termina"
          min={inicioOk ? brToISO(form.inicio) : undefined}
          invalid={Boolean(form.fim) && !fimOk}
        />
      </Field>

      {/* Receita e despesa não falam a mesma língua: ninguém "paga" um salário que vai receber. E o
          padrão inverte — receita nova nasce DESLIGADA (`SERIE_VAZIA` e o `20260909110000`). */}
      <SwitchRow
        label={form.kind === 'income' ? 'Entra como recebido na data' : 'Entra como pago na data'}
        value={form.autoConfirm}
        onValueChange={(autoConfirm) => onChange({ ...form, autoConfirm })}
      />
    </>
  );
}
