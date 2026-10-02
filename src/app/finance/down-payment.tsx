import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { DownPaymentFields } from '@/components/finance/down-payment-fields';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { useAccounts } from '@/hooks/use-finance';
import { useAddPurchaseDownPayment } from '@/hooks/use-down-payment';
import { downPaymentError, downPaymentInput, type DownPaymentForm } from '@/lib/down-payment';
import { isoToBR, localISODate } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';
import { paymentMethodError } from '@/lib/payment-method';

export default function AddDownPayment() {
  const params = useLocalSearchParams<{ tipo?: string; parent?: string }>();
  const accounts = useAccounts();
  const save = useAddPurchaseDownPayment();
  const toast = useToast();
  const [form, setForm] = useState<DownPaymentForm>({ amountCents: 0, dateBR: isoToBR(localISODate()), accountId: null });
  const error = downPaymentError(form, localISODate())
    ?? paymentMethodError(form.paymentMethod, accounts.data?.find((a) => a.id === form.accountId) ?? null);
  const validParent = Boolean(params.parent && (params.tipo === 'financiamento' || params.tipo === 'parcelada'));
  const salvar = () => {
    if (error || !validParent || save.isPending || accounts.isPending || accounts.isError) return;
    save.mutate({ type: params.tipo === 'parcelada' ? 'parcelada' : 'financiamento', parentId: params.parent!,
      payment: downPaymentInput(form, localISODate()) }, {
      onSuccess: () => { toast({ message: 'Entrada registrada.', tone: 'success' }); router.back(); },
      onError: (e) => toast({ message: financeErrorMessage(e, 'Não deu para registrar a entrada.'), tone: 'error' }),
    });
  };
  return <Screen>
    <TaskHeader title="Adicionar entrada" onClose={() => router.back()}
      action={<Button label="Salvar" size="sm" loading={save.isPending} disabled={Boolean(error) || !validParent || accounts.isPending || accounts.isError} onPress={salvar} />} />
    <DownPaymentFields enabled showToggle={false} onEnabled={() => {}} value={form} onChange={setForm} accounts={accounts.data ?? []} />
  </Screen>;
}
