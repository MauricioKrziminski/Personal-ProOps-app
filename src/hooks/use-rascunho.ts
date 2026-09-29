import { usePreferencia } from '@/hooks/use-preferencia';
import type { Draft } from '@/hooks/use-finance';
import { gravarRascunho, lerRascunho, type HipoteseDetalhada, type Rascunho } from '@/lib/rascunho';

const ehTexto = (v: string | number): v is string => typeof v === 'string';

/**
 * O rascunho do "E se…?" no aparelho, por usuário (28/09/2026: *"salvar no aparelho"*). A
 * Projeção e os formulários em modo hipótese leem e escrevem o MESMO estado.
 */
export function useRascunho() {
  const [texto, setTexto] = usePreferencia<string>('projecao:rascunho', '', ehTexto);
  const rascunho = lerRascunho(texto);
  const gravar = (r: Rascunho) => setTexto(gravarRascunho(r));
  return {
    rascunho,
    setRapidas: (f: (antes: Draft[]) => Draft[]) => gravar({ ...rascunho, rapidas: f(rascunho.rapidas) }),
    adicionarDetalhada: (h: Omit<HipoteseDetalhada, 'id'>) => {
      const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      gravar({ ...rascunho, detalhadas: [...rascunho.detalhadas, { ...h, id } as HipoteseDetalhada] });
      return id;
    },
    trocarDetalhada: (id: string, h: Omit<HipoteseDetalhada, 'id'>) =>
      gravar({ ...rascunho, detalhadas: rascunho.detalhadas.map((d) => (d.id === id ? ({ ...h, id } as HipoteseDetalhada) : d)) }),
    tirarDetalhada: (id: string) => gravar({ ...rascunho, detalhadas: rascunho.detalhadas.filter((d) => d.id !== id) }),
    limpar: () => setTexto(''),
    restaurar: (r: Rascunho) => gravar(r),
  };
}
