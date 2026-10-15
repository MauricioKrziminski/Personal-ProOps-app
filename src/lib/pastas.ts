/**
 * Árvore de pastas de notas — helpers puros (sem rede), compartilhados pelo "Mover para", pela folha
 * da pasta e pela tela de Organizar. O banco também barra ciclo e o 6º nível (P0001); aqui a tela
 * só deixa de OFERECER o que ele recusaria.
 */
export interface PastaBase {
  id: string;
  name: string;
  parent_id: string | null;
}

/** Níveis permitidos: raiz é o nível 1, a 5ª subpasta é a última (`depth` 0..4). */
export const NIVEIS_DE_PASTA = 5;

const FRASE_REPETIDA = 'Já existe uma pasta com esse nome aqui.';

/**
 * Ordena as pastas em ÁRVORE, achatada para lista, com o nível de cada uma. As filhas ficam logo
 * abaixo da mãe. Pasta cuja mãe não está na lista é tratada como raiz (sumir é pior que aparecer
 * no lugar errado por um instante); o teto de profundidade evita recursão infinita num ciclo.
 */
export function folderTree<T extends PastaBase>(folders: T[]): (T & { depth: number })[] {
  const filhas = new Map<string | null, T[]>();
  const ids = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    const mae = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null;
    filhas.set(mae, [...(filhas.get(mae) ?? []), f]);
  }
  const saida: (T & { depth: number })[] = [];
  const desce = (mae: string | null, depth: number) => {
    if (depth >= NIVEIS_DE_PASTA) return;
    for (const f of filhas.get(mae) ?? []) {
      saida.push({ ...f, depth });
      desce(f.id, depth + 1);
    }
  };
  desce(null, 0);
  return saida;
}

/** "trabalho / 2026" — o caminho da raiz até a pasta (vazio se o id não existe). */
export function caminhoDaPasta(pastas: PastaBase[], id: string | null): string {
  const porId = new Map(pastas.map((p) => [p.id, p]));
  const nomes: string[] = [];
  const vistos = new Set<string>();
  for (let atual = id ? porId.get(id) : undefined; atual && !vistos.has(atual.id); atual = atual.parent_id ? porId.get(atual.parent_id) : undefined) {
    vistos.add(atual.id);
    nomes.unshift(atual.name);
  }
  return nomes.join(' / ');
}

/**
 * Onde uma pasta pode ficar: em ordem de árvore, com `depth` e `caminho`. Ao MOVER (`movendo`),
 * nem ela mesma nem as descendentes (virariam ciclo) e nenhuma que faça a subárvore passar do
 * 5º nível. Criando, é só a regra de profundidade.
 */
export function destinosDePasta<T extends PastaBase>(
  pastas: T[],
  movendo?: { id: string } | null,
): (T & { depth: number; caminho: string })[] {
  const arvore = folderTree(pastas);
  let altura = 0; // níveis abaixo da pasta que se move
  const fora = new Set<string>();
  if (movendo) {
    const raiz = arvore.find((p) => p.id === movendo.id);
    fora.add(movendo.id);
    if (raiz) {
      // A árvore é pré-ordem: a subárvore são as linhas seguintes mais fundas que a raiz.
      for (let i = arvore.indexOf(raiz) + 1; i < arvore.length && arvore[i].depth > raiz.depth; i++) {
        fora.add(arvore[i].id);
        altura = Math.max(altura, arvore[i].depth - raiz.depth);
      }
    }
  }
  return arvore
    .filter((p) => !fora.has(p.id) && p.depth + 1 + altura < NIVEIS_DE_PASTA)
    .map((p) => ({ ...p, caminho: caminhoDaPasta(pastas, p.id) }));
}

/** Nome repetido só conta entre IRMÃS (mesma mãe); `ignorarId` é a própria pasta ao editar. */
export function nomeRepetidoEntreIrmas(
  pastas: PastaBase[],
  nome: string,
  paiId: string | null,
  ignorarId?: string,
): boolean {
  return pastas.some((f) => f.name === nome && (f.parent_id ?? null) === paiId && f.id !== ignorarId);
}

/** A irmã com o mesmo nome (o "devolve a existente" do Mover para). */
export function irmaComONome<T extends PastaBase>(pastas: T[], nome: string, paiId: string | null): T | undefined {
  return pastas.find((f) => f.name === nome && (f.parent_id ?? null) === paiId);
}

/** A frase do erro do banco: a trava de ciclo/profundidade (P0001) já vem em português. */
export function mensagemDoErroDePasta(e: unknown, padrao: string): string {
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  if (code === '23505') return FRASE_REPETIDA;
  if (code === 'P0001' && message) return message;
  return padrao;
}
