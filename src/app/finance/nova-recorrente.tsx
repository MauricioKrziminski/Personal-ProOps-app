import { Redirect, useLocalSearchParams } from 'expo-router';

/** Link antigo ("Aplicar" do "E se…?", o lançamento): o formulário único abre em Recorrente. */
export default function NovaRecorrenteAntiga() {
  const p = useLocalSearchParams<Record<string, string>>();
  return <Redirect href={{ pathname: '/finance/lancar', params: { ...p, tipo: 'recorrente' } }} />;
}
