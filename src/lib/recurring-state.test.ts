import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { estadoDaRecorrencia } from './recurring-state.ts';

const tzAnterior = process.env.TZ;
before(() => { process.env.TZ = 'America/Sao_Paulo'; });
after(() => { if (tzAnterior === undefined) delete process.env.TZ; else process.env.TZ = tzAnterior; });
const serie = { active: true, end_date: null as string | null, next_run_at: '2026-12-22T03:00:00Z' };

test('conversão encerra pelo corte antes da próxima mesmo com active preservado', () => {
  assert.equal(estadoDaRecorrencia({ ...serie, end_date: '2026-12-21' }, '2026-09-30'), 'encerrada');
});
test('fim anterior a hoje encerra mesmo com next_run_at desatualizado', () => {
  assert.equal(estadoDaRecorrencia({ ...serie, end_date: '2026-09-29', next_run_at: '2026-09-28T03:00:00Z' }, '2026-09-30'), 'encerrada');
});
test('fim hoje é inclusivo quando a próxima ainda cabe', () => {
  assert.equal(estadoDaRecorrencia({ ...serie, end_date: '2026-09-30', next_run_at: '2026-09-30T03:00:00Z' }, '2026-09-30'), 'ativa');
});
test('virada UTC não antecipa o fim no Brasil', () => {
  const local = { ...serie, end_date: '2026-12-21', next_run_at: '2026-12-22T02:59:59Z' };
  assert.equal(estadoDaRecorrencia(local, '2026-12-21'), 'ativa');
  assert.equal(estadoDaRecorrencia({ ...local, next_run_at: '2026-12-22T03:00:00Z' }, '2026-12-21'), 'encerrada');
});
test('fim futuro com próxima válida mantém estado ativo ou pausado', () => {
  assert.equal(estadoDaRecorrencia({ ...serie, end_date: '2026-12-31' }, '2026-09-30'), 'ativa');
  assert.equal(estadoDaRecorrencia({ ...serie, active: false, end_date: '2026-12-31' }, '2026-09-30'), 'pausada');
});
test('sem fim segue o estado persistido', () => {
  assert.equal(estadoDaRecorrencia(serie, '2026-09-30'), 'ativa');
  assert.equal(estadoDaRecorrencia({ ...serie, active: false }, '2026-09-30'), 'pausada');
});
test('encerrada prevalece sobre pausa e erro antigo', () => {
  const comErro = { ...serie, active: false, end_date: '2026-12-21', last_error: 'falha antiga' };
  assert.equal(estadoDaRecorrencia(comErro, '2026-09-30'), 'encerrada');
});
test('data pura da próxima mantém o dia local e timestamp inválido não inventa encerramento', () => {
  assert.equal(estadoDaRecorrencia({ ...serie, end_date: '2026-12-21', next_run_at: '2026-12-22' }, '2026-09-30'), 'encerrada');
  assert.equal(estadoDaRecorrencia({ ...serie, end_date: '2026-12-21', next_run_at: 'inválida' }, '2026-09-30'), 'ativa');
});
test('pausa com prazo: dentro do período é pausada, no futuro segue ativa', () => {
  const p = { ...serie, paused_from: '2026-11-05', paused_until: '2027-01-05' };
  assert.equal(estadoDaRecorrencia(p, '2026-12-01'), 'pausada');
  assert.equal(estadoDaRecorrencia(p, '2026-10-01'), 'ativa');
  assert.equal(estadoDaRecorrencia(p, '2027-01-05'), 'ativa');
});
