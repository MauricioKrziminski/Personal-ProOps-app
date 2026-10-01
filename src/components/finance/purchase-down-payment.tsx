import { router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Row } from '@/components/ui/row';
import { Money } from '@/components/ui/money';
import { useBRL } from '@/components/ui/conceal';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccounts } from '@/hooks/use-finance';
import { usePurchaseDownPayment, type PurchaseType } from '@/hooks/use-down-payment';
import { formatDateBR } from '@/lib/dates';

/** A entrada pode ser editada/apagada pelo lançamento, sem reescrever o contrato. */
export function PurchaseDownPayment({ type, parentId, installmentsCents }: { type: PurchaseType; parentId: string; installmentsCents?: number }) {
  const entry = usePurchaseDownPayment(type, parentId);
  const accounts = useAccounts(undefined, true);
  const brl = useBRL();
  if (entry.isPending) return <Skeleton width="100%" height={48} />;
  if (entry.isError) return <Button label="Tentar carregar a entrada" variant="secondary" onPress={() => void entry.refetch()} />;
  if (!entry.data) return <Button label="Adicionar entrada" variant="secondary" size="sm"
    onPress={() => router.push({ pathname: '/finance/down-payment', params: { tipo: type, parent: parentId } })} />;
  const account = accounts.data?.find((a) => a.id === entry.data!.account_id);
  const details = [formatDateBR(entry.data.occurred_at), account?.name].filter(Boolean).join(' · ');
  return <><Row title="Entrada" icon="arrow.up.right" subtitle={details}
    accessibilityLabel={`Entrada, ${brl(Number(entry.data.amount_cents))}, ${details}`}
    trailing={<Money cents={Number(entry.data.amount_cents)} variant="subhead" />}
    onPress={() => router.push({ pathname: '/finance/[txId]', params: { txId: entry.data!.id } })} />
    {installmentsCents !== undefined ? <Row title="Total da compra" subtitle="Entrada + parcelas"
      accessibilityLabel={`Total da compra, ${brl(installmentsCents + Number(entry.data.amount_cents))}, entrada + parcelas`}
      trailing={<Money cents={installmentsCents + Number(entry.data.amount_cents)} variant="subhead" />} /> : null}
  </>;
}
