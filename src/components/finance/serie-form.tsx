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
import { SubcategoryField } from '@/components/finance/subcategory-field';
import { subcategoryAfterParentChange } from '@/lib/subcategories';
import { MudancaSuave, Presenca } from '@/components/motion/presenca';
import { OriginAccountPicker } from '@/components/finance/origin-creation-host';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Segmented } from '@/components/ui/segmented';
import { SelectField } from '@/components/ui/select-field';
import { SwitchRow } from '@/components/ui/switch-row';
import { brToISO, isValidBRDate, localISODate } from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';
import { describeRRule } from '@/lib/rrule-text';
import { mudaInicioDaSerie, validaSerie, type SerieForm } from '@/lib/serie';
import { ExpenseClassificationField } from '@/components/finance/expense-classification-field';
import { normalizeExpenseClassification, type ExpenseClassificationDefaults } from '@/lib/expense-classification';

const TIPOS_EDITANDO = [{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Receita' }] as const;
const TIPOS_CRIANDO = [...TIPOS_EDITANDO, { value: 'transfer', label: 'Transferência' }] as const;

export function CamposDaSerie({
  form,
  onChange,
  contas,
  rotuloDaData = 'Próximo vencimento',
  classificationDefaults,
  onUseCategoryDefaults,
  workspaceId,
}: {
  form: SerieForm;
  onChange: (form: SerieForm) => void;
  contas: Parameters<typeof OriginAccountPicker>[0]['accounts'];
  /** Editando, o nome da data: "Próximo vencimento" na série; "Vence em" na ocorrência. */
  rotuloDaData?: string;
  classificationDefaults?: ExpenseClassificationDefaults;
  onUseCategoryDefaults?: () => void;
  workspaceId?: string;
}) {
  const { inicioOk, fimOk, fimEncerra, tituloOk, agendaNoPassado, inicioDate } = validaSerie(form);
  const origem = contas.find((c) => c.id === form.accountId) ?? null;
  const transferencia = form.kind === 'transfer';
  // A transferência não tem forma de pagamento: ela só move dinheiro entre contas próprias.
  const erroMetodo = transferencia ? null : paymentMethodError(form.paymentMethod, origem);
  const mesmaConta = transferencia && Boolean(form.accountId) && form.accountId === form.counterpartyId;
  // Piso do "Termina em": criando, o início; editando, o INÍCIO ORIGINAL (F18) — o fim antes do
  // próximo vencimento é encerrar a série, não um erro.
  const pisoDoFim = form.id && form.inicioOriginal && isValidBRDate(form.inicioOriginal)
    ? brToISO(form.inicioOriginal) : inicioOk ? brToISO(form.inicio) : undefined;
  const editando = Boolean(form.id);
  const mudaAgenda = (parte: Partial<SerieForm>) => onChange({ ...form, ...parte, agendaMudou: editando || form.agendaMudou });
  const periodo = form.preset === 'weekly' ? 'da semana' : form.preset === 'yearly' ? 'do ano' : 'do mês';

  return (
    <>
      <Field label="Tipo">
        {/* A série grava `kind` e as futuras em aberto vão junto. O padrão do "entra como pago"
            só acompanha numa série nova. */}
        {/* Trocar de/para transferência é conversão (`converter_registro`), nunca troca silenciosa:
            editando, a transferência fica transferência e gasto/receita não a ganham. */}
        {/* Abas à vista (06/10/2026), como no lançamento; a transferência editada não troca. */}
        {editando && transferencia ? (
          <SelectField
            options={[{ id: 'transfer', label: 'Transferência', icon: 'arrow.left.arrow.right' as const }]}
            value={form.kind}
            disabled
            placeholder="Escolher o tipo"
            onChange={() => {}}
          />
        ) : (
          <Segmented
            options={editando ? TIPOS_EDITANDO : TIPOS_CRIANDO}
            value={form.kind}
            onChange={(kind) => {
              if (kind === form.kind) return;
              onChange(editando ? { ...form, kind } : { ...form, kind, autoConfirm: kind !== 'income' });
            }}
          />
        )}
      </Field>

      <Field label="Título" obrigatorio error={form.description.length > 0 && !tituloOk ? 'Escreva um título' : undefined}>
        <TextField
          value={form.description}
          onChangeText={(description) => onChange({ ...form, description })}
          placeholder="Ex.: Aluguel"
          invalid={form.description.length > 0 && !tituloOk}
        />
      </Field>

      {/* A ordem do formulário de evento: título → estabelecimento → valor (frontend.md). */}
      <Presenca visivel={!transferencia}>
      <Field label="Estabelecimento">
        <TextField
          value={form.merchant}
          onChangeText={(merchant) => onChange({ ...form, merchant })}
          placeholder="Ex.: Imobiliária Centro"
          accessibilityLabel="Estabelecimento"
        />
      </Field>
      </Presenca>

      <Field label="Valor" obrigatorio>
        <MoneyField valueCents={form.amountCents} onChangeCents={(amountCents) => onChange({ ...form, amountCents })}
          sinal={form.kind === 'income' ? 'entra' : form.kind === 'expense' ? 'sai' : undefined} />
      </Field>

      <Presenca visivel={!transferencia}>
      <Field label="Categoria">
        <CategoryPicker value={form.category} onChange={(category) => onChange({ ...form, category,
          ...(form.subcategory_id !== undefined ? { subcategory_id: subcategoryAfterParentChange(form.subcategory_id, form.category, category) } : {}),
        })} />
      </Field>
      <SubcategoryField parent={form.category} value={form.subcategory_id ?? null} workspaceId={workspaceId} sessionKey={form.id ?? 'new'}
        onChange={subcategory_id => onChange({ ...form, subcategory_id })} />
      </Presenca>

      <Presenca visivel={form.kind === 'expense'}>
        <ExpenseClassificationField value={normalizeExpenseClassification(form.expenseClassification)}
          defaults={classificationDefaults} onUseCategoryDefaults={onUseCategoryDefaults}
          onChange={(expenseClassification) => onChange({ ...form, expenseClassification })} />
      </Presenca>

      <Presenca visivel={!transferencia}>
        <PaymentMethodField value={form.paymentMethod} onChange={(paymentMethod) => onChange({ ...form, paymentMethod })} error={!origem ? erroMetodo ?? undefined : undefined} />
      </Presenca>

      <Field label={transferencia ? 'Da conta' : 'Conta'} obrigatorio={transferencia || form.paymentMethod === 'credit'} error={origem ? erroMetodo ?? undefined : undefined} hint={origem && erroMetodo ? `Origem selecionada: ${origem.name}` : undefined}>
        <OriginAccountPicker
          paymentMethod={transferencia ? undefined : form.paymentMethod}
          accounts={transferencia ? contas : paymentMethodAccounts(form.paymentMethod, contas)}
          value={form.accountId}
          selectedAccount={origem}
          onChange={(accountId: string | null) => onChange({ ...form, accountId })}
          emptyLabel={transferencia ? undefined : 'Não informar'}
          placeholder={transferencia ? 'Escolher a conta de origem' : undefined}
        />
      </Field>

      {/* Logo depois da origem. O destino nunca é cartão, e a origem não se repete nele. */}
      <Presenca visivel={transferencia}>
        <Field label="Para a conta" obrigatorio error={mesmaConta ? 'Origem e destino precisam ser diferentes' : undefined}>
          <OriginAccountPicker
            accounts={contas.filter((c) => c.type !== 'credit_card' && c.id !== form.accountId)}
            value={form.counterpartyId ?? null}
            onChange={(counterpartyId: string | null) => onChange({ ...form, counterpartyId })}
            placeholder="Escolher a conta de destino"
          />
        </Field>
      </Presenca>

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
        obrigatorio={!editando}
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
      <Field
        label="Termina em"
        hint={fimEncerra ? 'Antes do próximo vencimento: encerra a série e tira as cobranças futuras.' : undefined}
        error={form.fim && !fimOk ? 'Informe data válida igual ou posterior ao início' : undefined}>
        <DatePickerField
          value={form.fim}
          onChange={(fim) => onChange({ ...form, fim })}
          placeholder="Sem fim"
          accessibilityLabel="Data em que a série termina"
          min={pisoDoFim}
          invalid={Boolean(form.fim) && !fimOk}
        />
      </Field>

      {/* Receita e despesa não falam a mesma língua: ninguém "paga" um salário que vai receber. E o
          padrão inverte — receita nova nasce DESLIGADA (`SERIE_VAZIA` e o `20260909110000`). */}
      <SwitchRow
        label={form.kind === 'income' ? 'Entra como recebido na data' : transferencia ? 'Entra como feita na data' : 'Entra como pago na data'}
        value={form.autoConfirm}
        onValueChange={(autoConfirm) => onChange({ ...form, autoConfirm })}
      />
    </>
  );
}
