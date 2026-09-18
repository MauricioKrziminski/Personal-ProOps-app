import type { QueryClient } from '@tanstack/react-query';
import type { Cycle, CycleRow } from '../hooks/use-finance';

interface PreviewPeriod {
  month: string;
  previousMonth: string;
  lastDate: string;
  previousLastDate: string;
  daysLeft: number;
}

/** The visual QA route seeds the exact period keys requested by the Finance root. */
export function seedFinancePeriodPreview(client: QueryClient, period: PreviewPeriod) {
  const { month, previousMonth, lastDate, previousLastDate, daysLeft } = period;
  const currentStart = `${month}-01`;
  const previousStart = `${previousMonth}-01`;
  const cycle: Cycle = {
    closeDay: null,
    view: 'civil',
    mes: month,
    de: currentStart,
    ate: lastDate,
    diasAteOFim: daysLeft,
  };
  client.setQueryData(['cycle', ''], cycle);
  client.setQueryData(['cycle', 'cycle'], cycle);
  client.setQueryData(['cycle-range', month, 'cycle'], { de: currentStart, ate: lastDate });
  client.setQueryData(['cycle-range', previousMonth, 'cycle'], {
    de: previousStart,
    ate: previousLastDate,
  });

  const series: CycleRow[] = [
    {
      mes: previousStart, ini: previousStart, fim: previousLastDate,
      estado: 'fechado', comecei_com: 200000, entrou: 800000, saiu: 609000,
      entrou_realizado: 800000, saiu_realizado: 609000, resultado: 391000,
      caixa_no_fim: 391000, faltou_pagar: 0, confere: true,
    },
    {
      mes: currentStart, ini: currentStart, fim: lastDate,
      estado: 'aberto', comecei_com: 391000, entrou: 900000, saiu: 1046000,
      entrou_realizado: 480000, saiu_realizado: 520000, resultado: 245000,
      caixa_no_fim: 245000, faltou_pagar: 0, confere: true,
    },
  ];
  client.setQueryData(['cycle-series', previousMonth, month, 'cycle'], series);
  client.setQueryData(['cycle-series', month, month, 'cycle'], [series[1]]);
  client.setQueryData(['cycle-lines', month, 'cycle'], [
    {
      origin: 'invoice', ref_id: 'prev-i1', title: 'Nubank Ultravioleta',
      day: `${month}-10`, method_label: 'Nubank Ultravioleta', atrasada: true,
      in_cents: 0, out_cents: 208000,
    },
    {
      origin: 'transaction', ref_id: 'prev-aluguel', title: 'Casa e compromissos',
      day: `${month}-15`, method_label: 'Conta corrente', atrasada: false,
      in_cents: 0, out_cents: 838000,
    },
    {
      origin: 'transaction', ref_id: 'prev-salario', title: 'Salário',
      day: `${month}-01`, method_label: 'Conta corrente', atrasada: false,
      in_cents: 900000, out_cents: 0,
    },
  ]);
}
