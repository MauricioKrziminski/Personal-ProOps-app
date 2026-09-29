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
  // Toda mudança parte do GRAVADO na hora, nunca do `rascunho` deste render: o "Aplicar todas"
  // tira uma hipótese por salvamento, todas com funções do mesmo render, e partindo do render a
  // segunda desfazia a primeira (a hipótese já salva na conta ficava no rascunho).
  const mudar = (f: (r: Rascunho) => Rascunho) => setTexto((antes) => gravarRascunho(f(lerRascunho(antes))));
  return {
    rascunho,
    setRapidas: (f: (antes: Draft[]) => Draft[]) => mudar((r) => ({ ...r, rapidas: f(r.rapidas) })),
    adicionarDetalhada: (h: Omit<HipoteseDetalhada, 'id'>) => {
      const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      mudar((r) => ({ ...r, detalhadas: [...r.detalhadas, { ...h, id } as HipoteseDetalhada] }));
      return id;
    },
    trocarDetalhada: (id: string, h: Omit<HipoteseDetalhada, 'id'>) =>
      mudar((r) => ({ ...r, detalhadas: r.detalhadas.map((d) => (d.id === id ? ({ ...h, id } as HipoteseDetalhada) : d)) })),
    tirarDetalhada: (id: string) => mudar((r) => ({ ...r, detalhadas: r.detalhadas.filter((d) => d.id !== id) })),
    limpar: () => setTexto(''),
    restaurar: (r: Rascunho) => setTexto(gravarRascunho(r)),
  };
}
