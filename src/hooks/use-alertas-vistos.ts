import { useAlertsSent } from '@/hooks/use-finance';
import { usePreferencia } from '@/hooks/use-preferencia';
import { temAlertaNovo } from '@/lib/alert-history';

const ehTexto = (v: string | number): v is string => typeof v === 'string';

/**
 * Até onde a pessoa já viu o histórico de alertas — gravado por usuário, no aparelho
 * (`usePreferencia`). O sino da Hoje acende com o que chegou depois; abrir o histórico marca.
 */
export function useAlertasVistos(): [string, (ate: string) => void] {
  return usePreferencia<string>('alertas:visto-ate', '', ehTexto);
}

/** A bolinha do sino: o alerta mais novo é mais novo que o último visto. */
export function useTemAlertaNovo(): boolean {
  const [vistoAte] = useAlertasVistos();
  const ultimo = useAlertsSent(1);
  return temAlertaNovo(ultimo.data?.[0]?.created_at, vistoAte);
}
