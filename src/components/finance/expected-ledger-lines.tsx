import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Deslizavel } from '@/components/ui/deslizavel';
import { Money } from '@/components/ui/money';
import { Row } from '@/components/ui/row';
import { useToast } from '@/components/ui/toast';
import { useAparencia, useDebts, useMaterializeOccurrence, useSkipOccurrence } from '@/hooks/use-finance';
import { formatBRL } from '@/hooks/use-items';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { estadoDaPrevista, type ExpectedLedgerLine } from '@/lib/ledger-expected';
import { settleLabel } from '@/lib/settle-labels';
import { aoVoltarParaDivida } from '@/lib/volta-da-parcela';
import { hrefDoLancar } from '@/lib/lancar';

function origemDaPrevista(line: ExpectedLedgerLine): string {
  if (line.origin === 'debt_estimate') return 'informada como paga';
  const parcela = line.installment_no
    ? `parcela ${line.installment_no}${line.installments_total ? `/${line.installments_total}` : ''}`
    : null;
  return line.origin === 'debt_schedule' ? (parcela ?? 'parcela do contrato') : 'recorrente';
}

/**
 * O que a prevista faz no toque — a MESMA coisa que um lançamento faz.
 *
 * Recorrente: vira o lançamento que o agendador criaria (`useMaterializeOccurrence`) e então
 * abre o detalhe, dá baixa, edita ou apaga como qualquer outro. Parcela de dívida não é
 * lançamento até ser paga: abre a parcela, e "Paguei" (só na próxima — pagar é em ordem) leva
 * à ficha já no pagamento.
 */
export function useAcoesDaPrevista({ month, pagar }: { month: string; pagar: (txId: string) => void }) {
  const materializar = useMaterializeOccurrence();
  const pular = useSkipOccurrence();
  const debts = useDebts();
  const toast = useToast();
  const queryClient = useQueryClient();
  // As tocadas que ainda não chegaram gravadas na lista (`previstasNaTela`).
  const [emTransito, setEmTransito] = useState<ExpectedLedgerLine[]>([]);
  const sai = (line: ExpectedLedgerLine) =>
    setEmTransito((lista) => lista.filter((p) => p !== line));

  const lancamento = async (line: ExpectedLedgerLine): Promise<string | null> => {
    setEmTransito((lista) => [...lista, line]);
    try {
      const id = await materializar.mutateAsync({ recurringId: line.ref_id, date: line.due_date });
      // sai quando a lista de lançamentos já a trouxe gravada
      void queryClient.refetchQueries({ queryKey: ['transactions'], type: 'active' }).finally(() => sai(line));
      return id;
    } catch (error) {
      sai(line);
      toast({ message: financeErrorMessage(error, 'Não deu para abrir essa ocorrência. Tenta de novo.'), tone: 'error' });
      return null;
    }
  };

  const abrir = async (line: ExpectedLedgerLine) => {
    if (line.origin !== 'recurring') {
      router.push({
        pathname: '/finance/debt-installment',
        params: { debt: line.ref_id, n: String(line.installment_no ?? ''), origem: 'lista' },
      });
      return;
    }
    const id = await lancamento(line);
    if (id) router.push({ pathname: '/finance/[txId]', params: { txId: id, month } });
  };

  const acoes = (line: ExpectedLedgerLine): ItemAction[] => {
    const detalhe: ItemAction = {
      label: 'Ver detalhe', icon: 'doc.text.magnifyingglass', arrasto: 'fora', onPress: () => { void abrir(line); },
    };
    if (line.origin === 'recurring') {
      return [
        // a que nasce paga ("entra como pago", já passou) não tem o que baixar
        ...(line.status === 'pending' ? [{
          label: settleLabel(line.kind), icon: 'checkmark.circle', arrasto: 'direita',
          onPress: () => { void lancamento(line).then((id) => { if (id) pagar(id); }); },
        } satisfies ItemAction] : []),
        detalhe,
        {
          label: 'Editar', icon: 'pencil',
          onPress: () => {
            void lancamento(line).then((id) => {
              if (id) router.push(hrefDoLancar('uma', { id, origem: 'transacao', papel: 'ocorrencia', month }));
            });
          },
        },
        {
          label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda',
          onPress: () => confirmDestructive(
            'Apagar esta ocorrência?',
            'Apagar',
            () => pular.mutate({ recurringId: line.ref_id, date: line.due_date }, {
              onSuccess: () => toast({ message: `Apaguei ${formatBRL(line.amount_cents)} de ${line.description}.`, tone: 'success' }),
              onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para apagar. Tenta de novo.'), tone: 'error' }),
            }),
            'Só esta. As outras da recorrente continuam.',
          ),
        },
      ];
    }
    const divida = debts.data?.find((d) => d.id === line.ref_id);
    const proxima = line.origin === 'debt_schedule' && divida != null &&
      line.installment_no === Number(divida.installments_paid ?? 0) + 1;
    return [
      ...(proxima
        ? [{
            label: settleLabel('expense'), icon: 'checkmark.circle', arrasto: 'direita',
            onPress: () => {
              aoVoltarParaDivida({ divida: line.ref_id, acao: 'pagar', cents: line.amount_cents });
              router.push({ pathname: '/finance/debts', params: { id: line.ref_id } });
            },
          } satisfies ItemAction]
        : []),
      detalhe,
    ];
  };

  return { abrir, acoes, emTransito };
}

/**
 * A ocorrência que só existe na regra, no MESMO desenho da linha de lançamento — no dia dela,
 * com a pílula que a data pede (28/09/2026: era um bloco à parte no topo, que não abria nem
 * aceitava "Paguei").
 */
export function LinhaPrevista({ line, hoje, conta, acoes, onAbrir }: {
  line: ExpectedLedgerLine;
  hoje: string;
  conta?: string;
  acoes: ItemAction[];
  onAbrir: () => void;
}) {
  const aparencia = useAparencia()(line.category, line.kind);
  const estado = estadoDaPrevista(line, hoje);
  const subtitulo = [origemDaPrevista(line), line.category, conta?.replace(/ /g, ' ')].filter(Boolean).join(' · ');
  return (
    <Deslizavel titulo={line.description} acoes={acoes}>
      <Row
        title={line.description}
        inlineValue
        badge={estado ? {
          label: estado,
          tone: estado === 'atrasado' ? 'danger' : estado === 'não caiu' ? 'warning' : undefined,
        } : undefined}
        subtitle={subtitulo}
        icon={aparencia.icon}
        tinta={aparencia.cor}
        accessibilityLabel={`${line.description}, ${formatBRL(line.amount_cents)}, ${line.kind === 'income' ? 'receita' : 'despesa'}, ${origemDaPrevista(line)}${estado ? `, ${estado}` : ''}`}
        onPress={onAbrir}
        onLongPress={() => showItemActions(line.description, acoes)}
        trailing={
          <Money
            cents={line.kind === 'expense' ? -line.amount_cents : line.amount_cents}
            variant="ticker"
            tone={line.kind === 'income' ? 'success' : 'text'}
            signed
          />
        }
      />
    </Deslizavel>
  );
}
