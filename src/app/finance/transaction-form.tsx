import { Redirect, useLocalSearchParams } from 'expo-router';

/** Link antigo (APK em campo, notificação): o formulário único abre no tipo certo. */
export default function TransactionFormAntigo() {
  const p = useLocalSearchParams<Record<string, string>>();
  return <Redirect href={{ pathname: '/finance/lancar', params: { ...p, tipo: 'uma', ...(p.id ? { origem: 'transacao' } : {}) } }} />;
}
