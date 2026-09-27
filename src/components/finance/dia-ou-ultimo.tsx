import { Field } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';

/**
 * "Todo dia 30 | Último dia do mês" — só aparece quando a data escolhida é o último dia de um
 * mês de menos de 31 dias (`diaAmbiguo`): 30/09 não diz se a pessoa quer o dia 30 ou o fim do mês,
 * e a diferença aparece nos meses de 31 (27/09/2026, pergunta do dono do produto). Série
 * recorrente e financiamento perguntam do mesmo jeito.
 */
export function DiaOuUltimo({ dia, ultimo, onChange }: { dia: number; ultimo: boolean; onChange: (ultimo: boolean) => void }) {
  return (
    <Field label="Nos outros meses">
      <Segmented
        options={[
          { value: 'dia', label: `Todo dia ${dia}` },
          { value: 'ultimo', label: 'Último dia do mês' },
        ]}
        value={ultimo ? 'ultimo' : 'dia'}
        onChange={(v) => onChange(v === 'ultimo')}
      />
    </Field>
  );
}
