import { usePreferencia } from '@/hooks/use-preferencia';
import type { Draft } from '@/hooks/use-finance';
import type { Hipotese } from '@/lib/hipotese';
import { gravarRascunho, lerRascunho, type Rascunho } from '@/lib/rascunho';

const ehTexto = (v: string | number): v is string => typeof v === 'string';

/**
 * O rascunho do "E se…?" no aparelho, por usuário (28/09/2026: *"salvar no aparelho"*). A
 * Projeção, o ciclo, o detalhe da hipótese e os formulários do "Aplicar" leem e escrevem o MESMO
 * estado.
 *
 * Toda mudança parte do GRAVADO na hora, nunca do `rascunho` deste render: duas mudanças com
 * funções do mesmo render (tirar e trocar, ou o salvar de um formulário que ficou aberto) valem as
 * duas.
 */
export function useRascunho() {
  const [texto, setTexto] = usePreferencia<string>('projecao:rascunho', '', ehTexto);
  const rascunho = lerRascunho(texto);
  const mudar = (f: (r: Rascunho) => Rascunho) => setTexto((antes) => gravarRascunho(f(lerRascunho(antes))));
  return {
    rascunho,
    adicionar: (h: Hipotese) => mudar((r) => ({ ...r, hipoteses: [...r.hipoteses, h] })),
    trocar: (h: Hipotese) => mudar((r) => ({ ...r, hipoteses: r.hipoteses.map((x) => (x.id === h.id ? h : x)) })),
    /** Pelo id: a hipótese certa sai mesmo que a lista tenha mudado com o formulário aberto. */
    tirar: (id: string) => mudar((r) => ({ ...r, hipoteses: r.hipoteses.filter((x) => x.id !== id) })),
    setAdiantamentos: (f: (antes: Draft[]) => Draft[]) => mudar((r) => ({ ...r, adiantamentos: f(r.adiantamentos) })),
    limpar: () => setTexto(''),
    /** O "Desfazer": devolve SÓ o que saiu, somado ao rascunho de agora. */
    devolver: (saiu: Pick<Rascunho, 'hipoteses' | 'adiantamentos'>) =>
      mudar((r) => ({
        ...r,
        hipoteses: [...r.hipoteses, ...saiu.hipoteses.filter((h) => !r.hipoteses.some((x) => x.id === h.id))],
        adiantamentos: [...r.adiantamentos, ...saiu.adiantamentos],
      })),
  };
}
