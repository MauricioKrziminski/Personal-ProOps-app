/**
 * O agente (Python) espelha três regras do app: `decodeModelo`, `paramsDaCopia`/`podeDuplicar` e
 * `getEmergencyReserveSummary`. Os fixtures em `agent/tests/fixtures/` guardam o que ESTAS funções
 * devolveram um dia; este teste roda as funções de hoje sobre os MESMOS insumos. Se a regra do app
 * mudar, o `npm test` quebra aqui — e é o aviso para atualizar o espelho em `agent/app/tools/` e
 * regerar o JSON (o pytest do agente lê o mesmo arquivo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { paramsDaCopia, podeDuplicar } from './duplicar.ts';
import { decodeEmergencyReserveState, formatEmergencyReserveCoverage, getEmergencyReserveSummary } from './emergency-reserve.ts';
import { decodeModelo } from './favoritos.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'agent', 'tests', 'fixtures');
const ler = (nome: string) => JSON.parse(readFileSync(join(FIXTURES, nome), 'utf8'));

test('decodeModelo de hoje devolve o que o agente espelha', () => {
  const f = ler('copias_paridade.json');
  f.modelos.forEach((m: unknown, i: number) => {
    assert.deepEqual(JSON.parse(JSON.stringify(decodeModelo(m))), f.decodificados[i], `modelo ${i}`);
  });
});

test('paramsDaCopia e podeDuplicar de hoje devolvem o que o agente espelha', () => {
  const f = ler('copias_paridade.json');
  f.txs.forEach((t: any, i: number) => {
    const r = paramsDaCopia(t, '05/10/2026', 10);
    assert.deepEqual({ params: r.params, nota: r.nota, pode: podeDuplicar(t) }, f.copias[i], `lançamento ${i}`);
  });
});

test('o resumo da reserva de hoje devolve o que o agente espelha', () => {
  const f = ler('reserva_paridade.json');
  for (const [nome, caso] of Object.entries<any>(f)) {
    const resumo = getEmergencyReserveSummary(decodeEmergencyReserveState(caso.state));
    assert.deepEqual(JSON.parse(JSON.stringify(resumo)), caso.summary, nome);
    const cobertura = resumo.monthlyCents === null ? null : formatEmergencyReserveCoverage(resumo);
    assert.equal(cobertura, caso.coverage, nome);
  }
});
