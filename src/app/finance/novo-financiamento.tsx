import { Redirect, useLocalSearchParams } from 'expo-router';

/** Link antigo ("Aplicar" do "E se…?", o lançamento): o formulário único abre em Financiamento. */
export default function NovoFinanciamentoAntigo() {
  const p = useLocalSearchParams<Record<string, string>>();
  return <Redirect href={{ pathname: '/finance/lancar', params: { ...p, tipo: 'financiamento' } }} />;
}
