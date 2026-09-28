import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agendaDoDia,
  iconeDoItem,
  legendaDoDia,
  linhasDoDia,
  metaDoItem,
  pendentesDaHoje,
  resumoDoAtrasado,
  semanaDoDia,
  separarLembretes,
  type ContaPrevista,
  type ItemDaAgenda,
} from './today-sections.ts';
import { painelDoDia, porDiaLivre } from './today-spend.ts';

const HOJE = '2026-09-17';
const conta = (o: Partial<ContaPrevista>): ContaPrevista => ({
  ref_id: 'x', title: 'Conta', due_date: HOJE, amount_cents: 1000, kind: 'transaction', overdue: false, ...o,
});

test('Agora tem o atrasado, o que vence hoje e o que chega hoje; atrasado primeiro', () => {
  const { agora } = agendaDoDia(
    [
      conta({ ref_id: 'luz', title: 'Luz', due_date: HOJE }),
      conta({ ref_id: 'fatura', kind: 'invoice', title: 'Fatura', due_date: '2026-09-10', overdue: true }),
      conta({ ref_id: 'pix', kind: 'income', title: 'Pix', due_date: HOJE }),
      conta({ ref_id: 'agua', title: 'Água', due_date: '2026-09-19' }),
    ],
    [],
    HOJE
  );
  assert.deepEqual(agora.map((i) => i.ref_id), ['fatura', 'luz', 'pix']);
});

test('Próximos dias agrupa por dia, respeita a janela e nunca repete o que está em Agora', () => {
  const { proximos } = agendaDoDia(
    [
      conta({ ref_id: 'agua', title: 'Água', due_date: '2026-09-19' }),
      conta({ ref_id: 'salario', kind: 'income', title: 'Salário', due_date: '2026-09-19', amount_cents: 500000 }),
      conta({ ref_id: 'longe', due_date: '2026-10-30' }),
      conta({ ref_id: 'luz', due_date: HOJE }),
    ],
    [{ id: 'c1', title: 'DAS', occurred_at: '2026-09-18', amount_cents: 7000, card: 'Nubank', invoice_id: 'f1' }],
    HOJE
  );
  assert.deepEqual(proximos.map((g) => g.day), ['2026-09-18', '2026-09-19']);
  assert.deepEqual(proximos[1].itens.map((i) => i.ref_id), ['agua', 'salario']);
  assert.equal(proximos[0].itens[0].kind, 'card');
  assert.equal(proximos[0].itens[0].faturaId, 'f1');
});

test('compra no cartão de hoje não vira pendência', () => {
  const { agora, proximos } = agendaDoDia(
    [],
    [{ id: 'c1', title: 'Uber', occurred_at: HOJE, amount_cents: 2000, card: 'Inter', invoice_id: 'f2' }],
    HOJE
  );
  assert.equal(agora.length, 0);
  assert.equal(proximos[0].day, HOJE);
});

test('o texto e o tom de cada item dizem o que aconteceu', () => {
  const [atrasada] = agendaDoDia([conta({ kind: 'invoice', due_date: '2026-09-10', overdue: true })], [], HOJE).agora;
  assert.deepEqual(metaDoItem(atrasada, 'agora'), { texto: 'venceu 10/09', tom: 'danger' });
  const [pix] = agendaDoDia([conta({ kind: 'income', due_date: '2026-09-15', overdue: true })], [], HOJE).agora;
  assert.deepEqual(metaDoItem(pix, 'agora'), { texto: 'não caiu 15/09', tom: 'warning' });
  const [hoje] = agendaDoDia([conta({})], [], HOJE).agora;
  assert.deepEqual(metaDoItem(hoje, 'agora'), { texto: 'vence hoje', tom: 'neutral' });
  assert.equal(iconeDoItem(atrasada), 'creditcard');
  assert.equal(iconeDoItem(pix), 'arrow.down.left');
});

/** Um horário LOCAL de 17/09 (o teste roda em qualquer fuso: a data que conta é a do aparelho). */
const as = (h: number, m = 0, dia = 17) => new Date(2026, 8, dia, h, m).toISOString();
const lembrete = (id: string, next_run_at: string) => ({ id, title: id, next_run_at, channel: 'push', recurrence: null });
const item = (o: Partial<ItemDaAgenda>): ItemDaAgenda => ({
  chave: `transaction:${o.ref_id ?? 'x'}:${o.day ?? HOJE}`, ref_id: 'x', kind: 'transaction', title: 'Conta', day: HOJE,
  cents: 1000, atrasado: false, cartao: null, faturaId: null, ...o,
});

test('lembrete de outro dia não é "de hoje" — o "Para hoje" listava 03/09 em 28/09', () => {
  const { deHoje, deOutroDia } = separarLembretes(
    [lembrete('seguro', as(6, 0, 3)), lembrete('filtro', as(15, 30)), lembrete('meia-noite', as(0, 0))],
    HOJE
  );
  assert.deepEqual(deHoje.map((l) => l.id), ['filtro', 'meia-noite']);
  assert.deepEqual(deOutroDia.map((l) => l.id), ['seguro']);
});

test('o AGORA fica entre o lembrete que passou e o que vem, e o que vem é o próximo', () => {
  const linhas = linhasDoDia({
    atrasados: [], atrasadosAbertos: false, limiteDoAtrasado: 20, doDia: [],
    lembretes: { deHoje: [lembrete('b', as(15, 30)), lembrete('a', as(6)), lembrete('c', as(20))], deOutroDia: [] },
    agora: new Date(2026, 8, 17, 12, 54).getTime(),
  });
  assert.deepEqual(
    linhas.map((l) => (l.tipo === 'lembrete' ? `${l.lembrete.id}:${l.estado}` : l.tipo)),
    ['a:passou', 'agora', 'b:proximo', 'c:depois']
  );
});

test('com todos os lembretes já passados o AGORA vai para o fim; sem lembrete não há AGORA', () => {
  const tarde = new Date(2026, 8, 17, 23, 0).getTime();
  const passados = linhasDoDia({
    atrasados: [], atrasadosAbertos: false, limiteDoAtrasado: 20, doDia: [],
    lembretes: { deHoje: [lembrete('a', as(6))], deOutroDia: [] }, agora: tarde,
  });
  assert.deepEqual(passados.map((l) => l.tipo), ['lembrete', 'agora']);
  const semLembrete = linhasDoDia({
    atrasados: [], atrasadosAbertos: false, limiteDoAtrasado: 20, doDia: [item({ ref_id: 'luz' })],
    lembretes: { deHoje: [], deOutroDia: [] }, agora: tarde,
  });
  assert.deepEqual(semLembrete.map((l) => l.tipo), ['item']);
});

test('2+ atrasados viram UMA linha recolhida; aberta, mostra cada um com Ver mais; 1 só não vira resumo', () => {
  const atrasados = [
    item({ ref_id: 'f1', kind: 'invoice', day: '2026-07-10', cents: 135000, atrasado: true }),
    item({ ref_id: 'f2', kind: 'invoice', day: '2026-08-10', cents: 135000, atrasado: true }),
    item({ ref_id: 'pix', kind: 'income', day: '2026-09-15', cents: 5000, atrasado: true }),
  ];
  const base = { doDia: [item({ ref_id: 'luz' })], lembretes: { deHoje: [], deOutroDia: [lembrete('velho', as(6, 0, 3))] }, agora: 0 };
  const fechado = linhasDoDia({ ...base, atrasados, atrasadosAbertos: false, limiteDoAtrasado: 20 });
  assert.deepEqual(fechado.map((l) => l.tipo), ['resumo', 'item', 'lembrete']);
  const resumo = fechado[0].tipo === 'resumo' ? fechado[0].resumo : null;
  assert.deepEqual(resumo, { contas: 2, contasCents: 270000, entradas: 1, entradasCents: 5000, desde: '2026-07-10' });

  const aberto = linhasDoDia({ ...base, atrasados, atrasadosAbertos: true, limiteDoAtrasado: 2 });
  assert.deepEqual(aberto.map((l) => l.tipo), ['resumo', 'item', 'item', 'verMais', 'item', 'lembrete']);
  assert.equal(aberto[3].tipo === 'verMais' && aberto[3].restantes, 1);

  const umSo = linhasDoDia({ ...base, atrasados: atrasados.slice(0, 1), atrasadosAbertos: false, limiteDoAtrasado: 20 });
  assert.deepEqual(umSo.map((l) => l.tipo), ['item', 'item', 'lembrete'], 'resumo de um item é eco dele');
  assert.equal(resumoDoAtrasado([]), null);
});

test('o badge conta conta a vencer SEM receita, lembrete de HOJE e orçamento estourado', () => {
  assert.equal(
    pendentesDaHoje({
      contas: [{ kind: 'invoice' }, { kind: 'income' }, { kind: 'transaction' }],
      lembretes: [{ next_run_at: as(15) }, { next_run_at: as(6, 0, 3) }],
      orcamentos: [
        { category: 'mercado', limit_cents: 100, spent_cents: 90, committed_cents: 20 },
        { category: 'lazer', limit_cents: 100, spent_cents: 85 },
      ],
      hoje: HOJE,
    }),
    2 + 1 + 1
  );
});

test('"por dia" é UMA conta: o card da Hoje e o widget dividem igual', () => {
  const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
  assert.equal(porDiaLivre(3_247_769, 12), 270_647);
  assert.equal(porDiaLivre(-500, 12), 0);
  assert.equal(porDiaLivre(1000, 0), 1000, 'dia zero não divide por zero');

  const porDia = painelDoDia({ livreCents: 3_247_769, diasLivres: 12, ate: '2026-10-10', entrada: null, brl });
  assert.deepEqual(porDia, {
    modo: 'porDia', rotulo: 'Dá para gastar por dia', cents: 270_647, negativo: false,
    legenda: 'R$ 32477.69 livre até 10/10',
  });

  const negativo = painelDoDia({ livreCents: -80_000, diasLivres: 5, ate: '2026-10-05', entrada: '2026-10-05', brl });
  assert.deepEqual(negativo, {
    modo: 'total', rotulo: 'Livre até 05/10', cents: -80_000, negativo: true, legenda: '5 dias · entra dinheiro 05/10',
  });

  const miudo = painelDoDia({ livreCents: 300, diasLivres: 4, ate: null, entrada: null, brl });
  assert.equal(miudo.modo, 'total', 'R$ 0,75 por dia não é manchete');
  assert.equal(miudo.rotulo, 'Livre');
  assert.equal(miudo.legenda, '4 dias');

  const umDia = painelDoDia({ livreCents: 50_000, diasLivres: 1, ate: '2026-09-29', entrada: '2026-09-29', brl });
  assert.deepEqual(
    { modo: umDia.modo, rotulo: umDia.rotulo, cents: umDia.cents, legenda: umDia.legenda },
    { modo: 'total', rotulo: 'Livre até 29/09', cents: 50_000, legenda: '1 dia · entra dinheiro 29/09' },
    'com um dia só, "por dia" repetiria o total'
  );

  const semCiclo = painelDoDia({ livreCents: 50_000, diasLivres: null, ate: null, entrada: null, brl });
  assert.deepEqual({ modo: semCiclo.modo, rotulo: semCiclo.rotulo, legenda: semCiclo.legenda },
    { modo: 'total', rotulo: 'Livre', legenda: '' }, 'sem saber até quando, não inventa "1 dia"');
});

test('a semana tem hoje no meio: o que saiu para trás, o previsto para a frente', () => {
  const { dias, teto, linha } = semanaDoDia({
    hoje: HOJE,
    gastos: [
      { day: '2026-09-14', expense_cents: 5000, income_cents: 0 },
      { day: '2026-09-16', expense_cents: '31240', income_cents: '400000' },
      { day: HOJE, expense_cents: 116667, income_cents: 0 },
      // o gasto de amanhã que já está lançado NÃO vira "saiu": o futuro é o previsto
      { day: '2026-09-18', expense_cents: 999999, income_cents: 0 },
    ],
    proximos: [
      { day: '2026-09-18', itens: [
        item({ ref_id: 'luz', kind: 'transaction', day: '2026-09-18', cents: 21430 }),
        item({ ref_id: 'fatura', kind: 'invoice', day: '2026-09-18', cents: 500000 }),
        item({ ref_id: 'sal', kind: 'income', day: '2026-09-18', cents: 400000 }),
        item({ ref_id: 'das', kind: 'card', day: '2026-09-18', cents: 7000 }),
      ] },
      { day: '2026-09-25', itens: [item({ ref_id: 'longe', day: '2026-09-25' })] },
    ],
    porDia: 100000,
  });
  assert.deepEqual(dias.map((d) => `${d.semana} ${d.numero} ${d.tipo}`), [
    'seg 14 passado', 'ter 15 passado', 'qua 16 passado', 'qui 17 hoje', 'sex 18 futuro', 'sáb 19 futuro', 'dom 20 futuro',
  ]);
  assert.deepEqual(dias.map((d) => d.saiu), [5000, 0, 31240, 116667, 0, 0, 0]);
  assert.equal(dias[2].entrou, 400000);
  assert.equal(dias[4].previsto, 21430 + 500000 + 7000, 'os MESMOS itens dos Próximos dias, fatura inclusive, sem a receita');
  assert.equal(dias[4].previstos, 3);
  assert.equal(dias[4].aEntrar, 400000);
  assert.deepEqual(dias.map((d) => d.acima), [false, false, false, true, false, false, false]);
  assert.equal(teto, 116667);
  assert.equal(linha, 100000);
});

test('semana sem nada ainda tem teto (nunca divide por zero) e sem "por dia" não tem régua', () => {
  const vazia = semanaDoDia({ hoje: HOJE, gastos: [], proximos: [], porDia: null });
  assert.equal(vazia.teto, 1);
  assert.equal(vazia.linha, null);
  assert.ok(vazia.dias.every((d) => !d.acima));
  const soRegua = semanaDoDia({ hoje: HOJE, gastos: [], proximos: [], porDia: 270647 });
  assert.equal(soRegua.teto, 270647, 'a régua cabe no gráfico mesmo sem gasto');
});

test('a frase do dia diz quando, quanto e o estado — "dentro" não se escreve, a entrada vai à parte', () => {
  const { dias } = semanaDoDia({
    hoje: HOJE,
    gastos: [{ day: HOJE, expense_cents: 116667, income_cents: 50000 }, { day: '2026-09-16', expense_cents: 100, income_cents: 0 }],
    proximos: [
      { day: '2026-09-18', itens: [item({ day: '2026-09-18', cents: 21430 }), item({ kind: 'income', day: '2026-09-18', cents: 9000 })] },
      { day: '2026-09-20', itens: [item({ kind: 'income', day: '2026-09-20', cents: 400000 })] },
    ],
    porDia: 100000,
  });
  assert.deepEqual(legendaDoDia(dias[3]), {
    quando: 'Hoje', rotulo: 'saiu', valor: 116667, tom: 'warning', estado: 'acima do que dá por dia',
    entrada: { rotulo: 'entrou', valor: 50000 }, vazio: false,
  });
  assert.deepEqual(legendaDoDia(dias[2]), {
    quando: 'qua, 16 set', rotulo: 'saiu', valor: 100, tom: 'text', estado: null, entrada: null, vazio: false,
  });
  assert.deepEqual(legendaDoDia(dias[4]), {
    quando: 'sex, 18 set', rotulo: 'vence', valor: 21430, tom: 'text', estado: '1 compromisso',
    entrada: { rotulo: 'entra', valor: 9000 }, vazio: false,
  });
  assert.deepEqual(legendaDoDia(dias[5]), {
    quando: 'sáb, 19 set', rotulo: 'nada previsto', valor: 0, tom: 'text', estado: null, entrada: null, vazio: true,
  }, 'dia vazio não diz "vence R$ 0,00"');
  assert.deepEqual(legendaDoDia(dias[6]), {
    quando: 'dom, 20 set', rotulo: 'entra', valor: 400000, tom: 'success', estado: null, entrada: null, vazio: false,
  }, 'dia que só entra é verde, como na lista de baixo');
});

test('um dia enorme não esmaga a régua: o teto para em 3× o "por dia"', () => {
  const s = semanaDoDia({ hoje: HOJE, gastos: [{ day: HOJE, expense_cents: 3_000_000, income_cents: 0 }], proximos: [], porDia: 100_000 });
  assert.equal(s.teto, 300_000);
  const semRegua = semanaDoDia({ hoje: HOJE, gastos: [{ day: HOJE, expense_cents: 3_000_000, income_cents: 0 }], proximos: [], porDia: null });
  assert.equal(semRegua.teto, 3_000_000, 'sem régua, o teto é o maior gasto');
});
