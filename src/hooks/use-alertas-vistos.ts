import { useAlertsSent } from '@/hooks/use-finance';
import { usePreferencia } from '@/hooks/use-preferencia';
import { combineAlertDeliveries, naoLidos, type EstadoDosAlertas } from '@/lib/alert-history';

const ehTexto = (v: string | number): v is string => typeof v === 'string';
const lista = (t: string) => (t ? t.split(',') : []);

/**
 * O que a pessoa leu e limpou do histórico de alertas — por usuário, no aparelho
 * (`usePreferencia`). As listas de ids moram como texto separado por vírgula (a preferência só
 * guarda texto e número); "todas" anda o marco e zera a lista, então elas ficam curtas.
 */
export function useEstadoDosAlertas() {
  const [vistoAte, setVistoAte] = usePreferencia<string>('alertas:visto-ate', '', ehTexto);
  const [lidos, setLidos] = usePreferencia<string>('alertas:lidos', '', ehTexto);
  const [limpoAte, setLimpoAte] = usePreferencia<string>('alertas:limpo-ate', '', ehTexto);
  const [limpos, setLimpos] = usePreferencia<string>('alertas:limpos', '', ehTexto);
  const estado: EstadoDosAlertas = { vistoAte, lidos: lista(lidos), limpoAte, limpos: lista(limpos) };

  /** Volta a um estado anterior — o "Desfazer" do aviso. */
  const restaurar = (e: EstadoDosAlertas) => {
    setVistoAte(e.vistoAte);
    setLidos(e.lidos.join(','));
    setLimpoAte(e.limpoAte);
    setLimpos(e.limpos.join(','));
  };

  return {
    estado,
    restaurar,
    marcarLido: (id: string) => {
      if (!estado.lidos.includes(id)) setLidos([...estado.lidos, id].join(','));
    },
    /** `maisNovo`: o `created_at` do alerta mais novo que existe. */
    marcarTodosLidos: (maisNovo: string) => {
      setVistoAte(maisNovo);
      setLidos('');
    },
    limpar: (id: string) => {
      if (!estado.limpos.includes(id)) setLimpos([...estado.limpos, id].join(','));
    },
    limparTodos: (maisNovo: string) => {
      setLimpoAte(maisNovo);
      setLimpos('');
      // Limpar também é ler: o que saiu da lista não fica contando no sino.
      setVistoAte(maisNovo);
      setLidos('');
    },
  };
}

/**
 * O número do sino da Hoje. ponytail: conta nos 50 mais recentes — o sino mostra "9+" a partir
 * de 10, então passar disso não muda o que se vê.
 */
export function useAlertasNaoLidos(): number {
  const { estado } = useEstadoDosAlertas();
  const recentes = useAlertsSent(50);
  return naoLidos(combineAlertDeliveries(recentes.data ?? []), estado);
}
