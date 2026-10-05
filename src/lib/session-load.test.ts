import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authorizedRequest } from './agent-chat.ts';
import { carregarSessao, tokenDoRefresh } from './session-load.ts';

const rede = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' });
const SEM_REDE = { data: { session: null }, error: rede };

/** Relógio falso: `esperar` só avança o tempo. */
function ambiente(respostas: unknown[]) {
  let t = 0;
  const ev: string[] = [];
  let i = 0;
  return {
    ev,
    chamadas: () => i,
    d: {
      getSession: async () => respostas[Math.min(i++, respostas.length - 1)] as never,
      receber: (s: unknown) => void ev.push(`receber:${s === null ? 'null' : 'sessao'}`),
      semConexao: () => void ev.push('semConexao'),
      vivo: () => true,
      esperar: async (ms: number) => void (t += ms),
      agora: () => t,
    },
  };
}

test('(a) erro de rede com sessão nula NÃO é saída: tenta de novo, sem mostrar o login', async () => {
  const s = ambiente([SEM_REDE, SEM_REDE, { data: { session: 'S' }, error: null }]);
  await carregarSessao(s.d);
  assert.deepEqual(s.ev, ['receber:sessao']);
  assert.equal(s.chamadas(), 3);
});

test('(b) passado o teto mostra "Sem conexão", nunca receber(null); tentar de novo entra', async () => {
  const s = ambiente([SEM_REDE]);
  await carregarSessao({ ...s.d, tetoMs: 10_000 });
  assert.deepEqual(s.ev, ['semConexao']);
  assert.ok(s.chamadas() > 2);
  const volta = ambiente([{ data: { session: 'S' }, error: null }]);
  await carregarSessao(volta.d);
  assert.deepEqual(volta.ev, ['receber:sessao']);
});

test('(b2) o teto conta do início: getSession lento avisa "Sem conexão" sem esperar o erro', async () => {
  const s = ambiente([]);
  let avisouAntes = false;
  await carregarSessao({
    ...s.d,
    tetoMs: 20,
    getSession: async () => {
      await new Promise((ok) => setTimeout(ok, 120));
      avisouAntes = s.ev.includes('semConexao');
      return { data: { session: 'S' }, error: null } as never;
    },
  });
  assert.ok(avisouAntes);
  assert.deepEqual(s.ev, ['semConexao', 'receber:sessao']);
});

test('(c) a rodada morta (desmontou, ou a sessão chegou por evento) não decide nada', async () => {
  let vivo = true;
  const s = ambiente([SEM_REDE]);
  await carregarSessao({ ...s.d, vivo: () => vivo, esperar: async () => void (vivo = false) });
  assert.deepEqual(s.ev, []);
});

test('(d) storage vazio, sem erro: login imediato, sem espera', async () => {
  const s = ambiente([{ data: { session: null }, error: null }]);
  await carregarSessao({ ...s.d, esperar: async () => assert.fail('esperou') });
  assert.deepEqual(s.ev, ['receber:null']);
  const inv = ambiente([{ data: { session: null }, error: new Error('invalid') }]);
  await carregarSessao(inv.d);
  assert.deepEqual(inv.ev, ['receber:null']);
});

function agente(refresh: () => Promise<string | null>) {
  const log: string[] = [];
  return {
    log,
    d: {
      send: async () => ({ status: 401 }),
      getToken: async () => 'antigo',
      refresh,
      signOut: async () => void log.push('signOut'),
    },
  };
}

test('(e) refresh que falha por REDE não sai da conta; o definitivo sai', async () => {
  const a = agente(async () => tokenDoRefresh(SEM_REDE));
  await assert.rejects(authorizedRequest(a.d), /fetch failed/);
  assert.deepEqual(a.log, []);

  const b = agente(async () =>
    tokenDoRefresh({ data: { session: null }, error: new Error('Auth session missing') })
  );
  assert.equal((await authorizedRequest(b.d)).kind, 'expired');
  assert.deepEqual(b.log, ['signOut']);
});
