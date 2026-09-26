/**
 * Os campos da SÉRIE recorrente, e as regras deles, num lugar só (26/09/2026, *"uma tela só de
 * editar componentizada… ter todos os campos de quando eu crio ao editar"*).
 *
 * Duas telas desenham isto: a folha de Recorrentes (criar e editar a série) e o formulário do
 * lançamento, quando uma ocorrência é editada em "Esta e as próximas". Duas cópias dos campos
 * divergiriam — foi assim que a edição ficou sem Repete, sem vencimento e sem Tipo.
 */
import { CategoryPicker } from '@/components/finance/category-picker';
import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Segmented } from '@/components/ui/segmented';
import { SwitchRow } from '@/components/ui/switch-row';
import type { RecurringTransaction } from '@/hooks/use-finance';
import { brToISO, dataLocalDe, ehUltimoDiaDoMes, fimQueSegueOInicio, isValidBRDate, isoToBR, localDateTime, localISODate } from '@/lib/dates';
import { validRecurringRange } from '@/lib/finance-form';

export interface SerieForm {
  /**
   * Presente = está EDITANDO uma série que já existe. Todos os campos da criação continuam na tela:
   * mudar a repetição ou o vencimento refaz as ocorrências futuras em aberto.
   */
  id?: string;
  /**
   * A pessoa mexeu em "Repete", "A cada quantos meses" ou no vencimento. Só então a regra vai no
   * salvar: comparar a regra montada com a gravada mudaria o calendário de uma série vinda do
   * WhatsApp que a pessoa nem tocou (a regra de lá nem sempre tem a forma que o app monta).
   */
  agendaMudou?: boolean;
  kind: 'expense' | 'income';
  amountCents: number;
  description: string;
  /** Opcional, como no lançamento: nem toda conta fixa tem um estabelecimento. */
  merchant: string;
  category: string | null;
  accountId: string | null;
  preset: 'monthly' | 'weekly' | 'yearly';
  /** Só no preset mensal: `A cada N meses`. */
  intervalo: string;
  /** dd/mm/aaaa — criando, vira `dtstart` e o `next_run_at`; editando, é o próximo vencimento. */
  inicio: string;
  /** dd/mm/aaaa, opcional: é como se encerra uma assinatura sem apagar o histórico. */
  fim: string;
  autoConfirm: boolean;
}

const DIAS_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * A RRULE sai do preset + da data — nunca de um campo de texto livre, que seria um gerador de
 * série quebrada. A frase de volta vem do mesmo `describeRRule` das séries da IA.
 */
export function montaRRule(preset: SerieForm['preset'], inicio: Date, intervalo: number): string {
  if (preset === 'weekly') return `FREQ=WEEKLY;BYDAY=${DIAS_RRULE[inicio.getDay()]}`;
  if (preset === 'yearly') return `FREQ=YEARLY;BYMONTH=${inicio.getMonth() + 1};BYMONTHDAY=${inicio.getDate()}`;
  const passo = intervalo > 1 ? `;INTERVAL=${intervalo}` : '';
  /*
    ⚠️ **A data DIZ se é "todo dia N" ou "todo último dia do mês".** Havia um campo só para
    perguntar isso ("Vence quando: Dia do mês | Último dia"), e ele era um controle que a própria
    data já respondia — quem escolhe 31/10 quer o fim do mês, quem escolhe 05/10 quer o dia 5.

    `-1` não é cosmético ao lado de 31: `BYMONTHDAY=31` PULA fevereiro e os meses de 30 dias.
  */
  return `FREQ=MONTHLY${passo};BYMONTHDAY=${ehUltimoDiaDoMes(inicio) ? -1 : inicio.getDate()}`;
}

/**
 * Uma série existente no formulário: a repetição sai da regra gravada e a data é o PRÓXIMO
 * vencimento, no dia LOCAL (`next_run_at` é timestamp: 05/10 00:00 UTC é 04/10 em Brasília).
 */
export function serieDoRegistro(r: RecurringTransaction): SerieForm {
  return {
    id: r.id,
    kind: r.kind === 'income' ? 'income' : 'expense',
    amountCents: Number(r.amount_cents),
    description: r.description ?? '',
    merchant: r.merchant ?? '',
    category: r.category,
    accountId: r.account_id,
    preset: r.rrule.includes('FREQ=WEEKLY') ? 'weekly' : r.rrule.includes('FREQ=YEARLY') ? 'yearly' : 'monthly',
    intervalo: /INTERVAL=(\d+)/.exec(r.rrule)?.[1] ?? '1',
    inicio: isoToBR(dataLocalDe(r.next_run_at)),
    fim: r.end_date ? isoToBR(r.end_date) : '',
    autoConfirm: r.auto_confirm,
  };
}

export const SERIE_VAZIA: SerieForm = {
  kind: 'expense',
  amountCents: 0,
  description: '',
  merchant: '',
  category: null,
  accountId: null,
  preset: 'monthly',
  intervalo: '1',
  inicio: isoToBR(localISODate()),
  fim: '',
  autoConfirm: true,
};

/** O que o formulário vale agora: o que falta, o que está errado e a regra que ele monta. */
export function validaSerie(form: SerieForm | null) {
  const inicioDate = form ? localDateTime(form.inicio, '09:00') : null;
  const inicioOk = Boolean(form && isValidBRDate(form.inicio) && inicioDate);
  const fimOk = form
    ? form.fim === '' || (isValidBRDate(form.fim) && inicioOk && brToISO(form.fim) >= brToISO(form.inicio))
    : false;
  /*
    ⚠️ O título ficava de FORA da guarda e a lista caía em "sem descrição" — a série nascia anônima
    e se materializava em uma linha por mês, todas sem nome (15/09/2026).
  */
  const tituloOk = (form?.description.trim().length ?? 0) > 0;
  // Mudando o calendário de uma série, o próximo vencimento é daqui para a frente: o passado fica.
  const agendaNoPassado = Boolean(form?.id && form.agendaMudou && inicioOk && brToISO(form.inicio) < localISODate());
  const calendarioOk = Boolean(
    form && inicioOk && validRecurringRange(brToISO(form.inicio), form.fim ? brToISO(form.fim) : '', form.preset === 'monthly' ? form.intervalo : '1'),
  );
  const basico = Boolean(form && tituloOk && form.amountCents > 0 && fimOk);
  // Editando, o calendário só pesa quando a pessoa mexeu nele (`agendaMudou`).
  const podeSalvar = form?.id
    ? basico && (!form.agendaMudou || (calendarioOk && !agendaNoPassado))
    : basico && calendarioOk;
  const rrulePrevia = form && inicioDate ? montaRRule(form.preset, inicioDate, Number(form.intervalo) || 1) : null;
  return { inicioDate, inicioOk, fimOk, tituloOk, agendaNoPassado, podeSalvar, rrulePrevia };
}

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
  const { inicioOk, fimOk, tituloOk, agendaNoPassado } = validaSerie(form);
  const editando = Boolean(form.id);
  const mudaAgenda = (parte: Partial<SerieForm>) => onChange({ ...form, ...parte, agendaMudou: editando || form.agendaMudou });
  const periodo = form.preset === 'weekly' ? 'da semana' : form.preset === 'yearly' ? 'do ano' : 'do mês';

  return (
    <>
      <Field label="Tipo">
        {/* A série grava `kind` e as futuras em aberto vão junto. O padrão do "entra como pago"
            só acompanha numa série nova. */}
        <Segmented
          options={[
            { value: 'expense', label: 'Despesa' },
            { value: 'income', label: 'Receita' },
          ]}
          value={form.kind}
          onChange={(kind) => onChange(editando ? { ...form, kind } : { ...form, kind, autoConfirm: kind !== 'income' })}
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

      <Field label="Conta">
        <AccountPicker
          accounts={contas}
          value={form.accountId}
          onChange={(accountId: string | null) => onChange({ ...form, accountId })}
          emptyLabel="Não informar"
        />
      </Field>

      <Field label="Repete">
        <Segmented
          // Rótulos de UMA palavra: a 384dp × 1,3 "Toda semana" quebrava em duas linhas dentro da
          // célula e as três ficavam de alturas diferentes (§1 do design).
          options={[
            { value: 'monthly', label: 'Mensal' },
            { value: 'weekly', label: 'Semanal' },
            { value: 'yearly', label: 'Anual' },
          ]}
          value={form.preset}
          onChange={(preset) => mudaAgenda({ preset })}
        />
      </Field>

      {form.preset === 'monthly' ? (
        <Field label="A cada quantos meses">
          {/* Campo de quantidade (`QuantityField`): "0" não existe, então não há erro a mostrar. */}
          <QuantityField
            value={Number(form.intervalo) || 1}
            max={99}
            accessibilityLabel="A cada quantos meses"
            onChange={(n) => mudaAgenda({ intervalo: String(n) })}
          />
        </Field>
      ) : null}

      <Field
        // Editando, a data é o próximo vencimento: o último dia do mês vira "todo último dia".
        label={editando ? rotuloDaData : 'Começa em'}
        hint={
          editando
            ? form.agendaMudou ? `Refaz as em aberto ${periodo} desta data em diante` : undefined
            : inicioOk && brToISO(form.inicio) < localISODate() ? 'Já lança as passadas' : undefined
        }
        error={form.inicio && !inicioOk ? 'Data inválida (dd/mm/aaaa)' : agendaNoPassado ? 'Escolha hoje ou uma data depois' : undefined}>
        <DatePickerField
          value={form.inicio}
          // O "Termina em" anda junto quando o início passaria dele (`fimQueSegueOInicio`).
          onChange={(inicio) =>
            mudaAgenda({
              inicio,
              fim:
                isValidBRDate(inicio) && isValidBRDate(form.inicio) && isValidBRDate(form.fim)
                  ? isoToBR(fimQueSegueOInicio(brToISO(form.inicio), brToISO(inicio), brToISO(form.fim)))
                  : form.fim,
            })
          }
          placeholder="Escolher o início"
          accessibilityLabel={editando ? 'Próximo vencimento da série' : 'Data de início da série'}
          min={editando ? localISODate() : undefined}
          invalid={(Boolean(form.inicio) && !inicioOk) || agendaNoPassado}
        />
      </Field>

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
