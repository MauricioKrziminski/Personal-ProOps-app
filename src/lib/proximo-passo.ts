/**
 * O "Próximo passo" da Hoje (23/09/2026): depois dos Primeiros passos, um recurso por vez que a
 * pessoa ainda não usou — decidido por DADO REAL, como os Primeiros passos, e nunca por uma flag
 * de "já viu o tutorial".
 *
 * A queixa que originou: *"meu pai não sabia o que existia no app, como importar a fatura"*. A
 * pesquisa (spec `2026-09-23-onboarding-hibrido-design.md`) diz que tutorial na abertura não
 * ensina; o que funciona é apresentar o recurso no lugar, um de cada vez, aberto pelo toque da
 * pessoa. A ordem é a do valor para quem acabou de chegar: a fatura primeiro (é o que mais dado
 * traz de uma vez), a projeção (é a pergunta que o app responde e a planilha não), e o resto.
 */
export type ProximoId = 'importar' | 'projecao' | 'lembrete' | 'parcelada' | 'nota';

export type Proximo = {
  id: ProximoId;
  titulo: string;
  acao: string;
  icon: 'square.and.arrow.down' | 'chart.line.uptrend.xyaxis' | 'bell' | 'creditcard.and.123' | 'note.text';
  href: string;
};

export function proximoPasso(
  i: { cartaoId: string | null; importou: boolean; lembretes: number; parceladas: number; notas: number },
  dispensados: ReadonlySet<ProximoId>,
): Proximo | null {
  const candidatos: (Proximo & { aplica: boolean })[] = [
    {
      id: 'importar',
      aplica: Boolean(i.cartaoId) && !i.importou,
      titulo: 'Traga a fatura do cartão',
      acao: 'Importar fatura',
      icon: 'square.and.arrow.down',
      href: `/import?conta=${i.cartaoId ?? ''}`,
    },
    {
      id: 'projecao',
      aplica: true,
      titulo: 'Veja até quando o dinheiro dura',
      acao: 'Ver projeção',
      icon: 'chart.line.uptrend.xyaxis',
      href: '/finance/forecast',
    },
    {
      id: 'lembrete',
      aplica: i.lembretes === 0,
      titulo: 'Peça um lembrete',
      acao: 'Criar lembrete',
      icon: 'bell',
      href: '/reminder-form',
    },
    {
      id: 'parcelada',
      aplica: Boolean(i.cartaoId) && i.parceladas === 0,
      titulo: 'Compra parcelada se organiza sozinha',
      acao: 'Lançar compra',
      icon: 'creditcard.and.123',
      href: '/finance/transaction-form',
    },
    {
      id: 'nota',
      aplica: i.notas === 0,
      titulo: 'Anote do seu jeito',
      acao: 'Abrir notas',
      icon: 'note.text',
      href: '/notes',
    },
  ];
  const achado = candidatos.find((c) => c.aplica && !dispensados.has(c.id));
  if (!achado) return null;
  const { aplica: _aplica, ...passo } = achado;
  return passo;
}
