/**
 * As dicas no lugar (spec `2026-09-24-dicas-e-guia-design.md`): o que o app ensina dentro das
 * telas, uma por vez, preso ao gesto que ninguém descobre sozinho.
 *
 * É o desenho do TipKit (Apple) e da ajuda contextual do NN/g: a dica aparece onde o recurso
 * mora, some quando a pessoa o USA, e nunca volta sozinha — só pelo "Mostrar" do guia.
 */

export type Tela = 'hoje' | 'contas' | 'financeiro' | 'carteira' | 'lancamentos' | 'notas' | 'fatura';

export const DICAS = [
  {
    id: 'hoje-painel',
    telas: ['hoje'],
    icone: 'hand.tap',
    texto: 'Toque no painel para ver o que fecha o ciclo, a projeção e as metas.',
  },
  {
    // A MESMA dica na Hoje ("Nas contas") e na lista de Contas: aprendeu numa, sabe na outra.
    id: 'conta-extrato',
    telas: ['contas', 'hoje'],
    icone: 'building.columns',
    texto: 'Toque numa conta para ver o extrato dela.',
  },
  {
    id: 'fin-grafico',
    telas: ['financeiro'],
    icone: 'hand.draw',
    texto: 'Arraste no gráfico para ver o saldo de cada dia.',
  },
  {
    id: 'fin-painel',
    telas: ['financeiro'],
    icone: 'hand.tap',
    texto: 'Toque no painel para ver o ciclo, o que entra e o que sai.',
  },
  {
    id: 'fin-pilha',
    telas: ['financeiro'],
    icone: 'creditcard',
    texto: 'Toque na pilha para ver todos os cartões.',
  },
  {
    id: 'carteira',
    telas: ['carteira'],
    icone: 'wallet.pass',
    texto: 'Deslize para ver os cartões. Toque para escolher.',
  },
  {
    // UMA dica para as duas listas: quem aprendeu a arrastar numa, sabe na outra.
    id: 'lista-arrasto',
    telas: ['lancamentos', 'notas'],
    icone: 'hand.draw',
    texto: 'Arraste para os lados para as ações rápidas. Segure para ver todas.',
  },
  {
    id: 'notas-ordem',
    telas: ['notas'],
    icone: 'line.3.horizontal',
    texto: 'Segure o ≡ e arraste para mudar a ordem.',
  },
  {
    id: 'notas-pastas',
    telas: ['notas'],
    icone: 'folder',
    texto: 'Segure uma pasta e arraste para mudar de lugar.',
  },
  {
    id: 'fatura-cartao',
    telas: ['fatura'],
    icone: 'creditcard',
    texto: 'Deslize o cartão para trocar de fatura. Importar a fatura fica no ⋯.',
  },
] as const satisfies readonly { id: string; telas: readonly Tela[]; icone: string; texto: string }[];

export type DicaId = (typeof DICAS)[number]['id'];

/**
 * `encerradas` é o que foi dispensado OU usado — gravado no aparelho, por usuário.
 * `suspensas` são as telas que já mostraram e fecharam uma dica NESTA abertura do app: a próxima
 * não emenda na mesma visita (uma por vez). `forcada` é a que o guia acabou de pedir.
 */
export interface EstadoDasDicas {
  encerradas: DicaId[];
  suspensas: Tela[];
  forcada: DicaId | null;
}

/**
 * A dica da vez numa tela: a primeira do catálogo daquela tela cujo alvo está NA TELA (`montadas`)
 * e que não foi encerrada. Uma que não está na tela (sem cartão, sem gráfico) não trava a próxima.
 */
export function dicaDaVez(tela: Tela, estado: EstadoDasDicas, montadas: readonly DicaId[]): DicaId | null {
  const daTela = DICAS.filter((d) => (d.telas as readonly Tela[]).includes(tela) && montadas.includes(d.id));
  if (estado.forcada && daTela.some((d) => d.id === estado.forcada)) return estado.forcada;
  if (estado.suspensas.includes(tela)) return null;
  return daTela.find((d) => !estado.encerradas.includes(d.id))?.id ?? null;
}

/** Dispensada ("Entendi") ou usada: não volta sozinha, e a tela fica quieta nesta visita. */
export function encerrar(estado: EstadoDasDicas, id: DicaId, tela: Tela): EstadoDasDicas {
  return {
    encerradas: estado.encerradas.includes(id) ? estado.encerradas : [...estado.encerradas, id],
    suspensas: estado.suspensas.includes(tela) ? estado.suspensas : [...estado.suspensas, tela],
    forcada: estado.forcada === id ? null : estado.forcada,
  };
}

/** O "Mostrar" do guia: acende esta dica na próxima vez que a tela dela aparecer. */
export function reacender(estado: EstadoDasDicas, id: DicaId): EstadoDasDicas {
  return { ...estado, encerradas: estado.encerradas.filter((x) => x !== id), forcada: id };
}

/** As telas de uma dica — quem a usa numa tela a encerra em todas. */
export function telasDaDica(id: DicaId): readonly Tela[] {
  return DICAS.find((d) => d.id === id)?.telas ?? [];
}

/** Onde cada dica mora — o "Mostrar" do guia leva para cá. A fatura depende do cartão: vai à lista. */
const ROTA_DA_TELA = {
  hoje: '/today',
  contas: '/finance/accounts',
  financeiro: '/finance',
  // A Carteira abre pela pilha do Financeiro (ela depende do cartão da frente).
  carteira: '/finance',
  lancamentos: '/finance/transactions',
  notas: '/notes',
  fatura: '/finance/cards',
} as const satisfies Record<Tela, string>;

// Sem `/finance/cycle`: o link do ciclo carrega a régua do `cycle_now` (finance.md), e quem leva
// até ele com a régua certa é o painel da Hoje — o item "Tocar no painel".
type Rota = (typeof ROTA_DA_TELA)[Tela] | '/agent/new' | '/import' | '/finance/forecast'
  | '/finance/goals' | '/finance/budgets' | '/reminders';

export type ItemDoGuia =
  | { titulo: string; texto: string; dica: DicaId }
  | { titulo: string; texto: string; href: Rota };

/**
 * "Como usar o ProOps" (`/guia`): tudo que dá para fazer, em grupos curtos. Item com `dica` leva à
 * tela dela e acende a dica (mesmo já dispensada); os outros só levam à tela.
 */
export const GUIA: readonly { titulo: string; itens: readonly ItemDoGuia[] }[] = [
  {
    titulo: 'Registrar',
    itens: [
      { titulo: 'Em frase, pelo Agente', texto: '“gastei 45 no mercado”. No WhatsApp também.', href: '/agent/new' },
      { titulo: 'Lançar à mão', texto: 'O + em Lançamentos.', href: '/finance/transactions' },
      { titulo: 'Importar fatura ou extrato', texto: 'O arquivo do banco; o que já está no app fica de fora.', href: '/import' },
    ],
  },
  {
    titulo: 'Contas e cartões',
    itens: [
      { titulo: 'Saldo de uma conta', texto: 'O saldo e o extrato dela.', dica: 'conta-extrato' },
      { titulo: 'Todos os cartões', texto: 'A carteira, com a fatura de cada um.', dica: 'fin-pilha' },
      { titulo: 'O cartão da frente', texto: 'Escolha qual fica na frente da pilha.', dica: 'carteira' },
      { titulo: 'Trocar de fatura', texto: 'Deslizar o cartão; importar fica no ⋯.', dica: 'fatura-cartao' },
    ],
  },
  {
    titulo: 'Planejar',
    itens: [
      { titulo: 'O ciclo, o que entra e sai', texto: 'Toque no painel do Financeiro.', dica: 'fin-painel' },
      { titulo: 'Projeção e “E se…”', texto: 'Até quando o dinheiro dura, e se você comprar algo.', href: '/finance/forecast' },
      { titulo: 'Metas', texto: 'Guardar para um objetivo.', href: '/finance/goals' },
      { titulo: 'Orçamentos', texto: 'Um limite por categoria.', href: '/finance/budgets' },
    ],
  },
  {
    titulo: 'Notas e lembretes',
    itens: [
      { titulo: 'Anotar rápido', texto: 'Pelo Agente, pelo WhatsApp ou em Notas.', href: '/notes' },
      { titulo: 'Lembrete que repete', texto: '“me lembra todo dia 5”.', href: '/reminders' },
      { titulo: 'Pastas', texto: 'Segure e arraste para mudar de lugar.', dica: 'notas-pastas' },
      { titulo: 'A ordem das notas', texto: 'Segure o ≡ e arraste.', dica: 'notas-ordem' },
    ],
  },
  {
    titulo: 'Gestos',
    itens: [
      { titulo: 'Arrastar um card', texto: 'Para os lados: ações rápidas. Segurar: todas.', dica: 'lista-arrasto' },
      { titulo: 'Tocar no painel', texto: 'Ciclo, projeção e metas.', dica: 'hoje-painel' },
      { titulo: 'Arrastar no gráfico', texto: 'O saldo de cada dia.', dica: 'fin-grafico' },
    ],
  },
];

export function destinoDoItem(item: ItemDoGuia): Rota {
  return 'dica' in item ? ROTA_DA_TELA[telasDaDica(item.dica)[0]] : item.href;
}

/**
 * O passo "O que dá para fazer" do onboarding (24/09/2026): o que existe no app, numa tela só,
 * para quem nunca usou — *"meu pai… não sabia de coisas que tinha ali dentro, como importar a
 * fatura"*. As dicas no lugar ensinam o gesto quando o alvo existe; esta lista cobre o que a
 * conta nova ainda não tem (conta, cartão, fatura).
 */
export const O_QUE_DA_PARA_FAZER: readonly { icone: string; titulo: string; texto: string }[] = [
  // O Agente do app só recebe texto; foto e áudio são do WhatsApp.
  { icone: 'bubble.left.and.bubble.right', titulo: 'Fale do seu jeito', texto: 'No Agente ou no WhatsApp. No WhatsApp, até foto e áudio.' },
  { icone: 'square.and.arrow.down', titulo: 'Traga a fatura do banco', texto: 'Importe o arquivo; o que já está no app fica de fora.' },
  { icone: 'building.columns', titulo: 'Toque numa conta', texto: 'Para ver o saldo e o extrato dela.' },
  { icone: 'chart.line.uptrend.xyaxis', titulo: 'Toque no painel', texto: 'O ciclo, a projeção e o “E se…”.' },
  { icone: 'hand.draw', titulo: 'Arraste e segure os cards', texto: 'Para os lados: ações rápidas. Segurar: todas.' },
  { icone: 'questionmark.circle', titulo: 'Ajuda sempre à mão', texto: 'Perfil › Como usar o ProOps.' },
];
