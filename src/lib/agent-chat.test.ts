/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  appendConversationPage,
  canSendMessage,
  canSaveTitle,
  canSubmitMessage,
  conversationRoute,
  markResolved,
  parseUiActions,
  defaultRandomBytes,
  hitlControlsDisabled,
  isNearChatEnd,
  newClientMessageId,
  prependMessagePage,
  authorizedRequest,
  retryPolicyFor,
} from './agent-chat.ts';

// ---------------------------------------------------------------------------
// UUID do turno
// ---------------------------------------------------------------------------
// É uma chave OPACA de deduplicação, nunca um segredo: o servidor sempre a
// restringe ao usuário e à conversa. Por isso ela pode sair de `Math.random`
// quando não houver CSPRNG — o que ela precisa é ser estável no retry, não ser
// imprevisível.

test('newClientMessageId monta um UUID v4 a partir dos 16 bytes recebidos', () => {
  const id = newClientMessageId((bytes) => bytes.fill(0));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('os bits de versão e variant são aplicados mesmo com bytes todos 0xff', () => {
  const id = newClientMessageId((bytes) => bytes.fill(0xff));
  assert.equal(id[14], '4', 'a versão 4 não foi carimbada');
  assert.ok('89ab'.includes(id[19]), `variant inválido: ${id[19]}`);
});

test('bytes diferentes geram ids diferentes', () => {
  let n = 0;
  const seq = () => newClientMessageId((bytes) => bytes.fill(n++));
  assert.notEqual(seq(), seq());
});

test('só os 16 bytes entram: a mesma semente devolve o mesmo id', () => {
  const semente = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i * 7;
  };
  assert.equal(newClientMessageId(semente), newClientMessageId(semente));
});

test('defaultRandomBytes prefere o CSPRNG quando ele existe', () => {
  let usou = false;
  const fake = {
    getRandomValues(bytes: Uint8Array) {
      usou = true;
      return bytes.fill(1);
    },
  };
  const bytes = defaultRandomBytes(new Uint8Array(16), fake as Crypto);
  assert.ok(usou, 'getRandomValues não foi usado');
  assert.equal(bytes[0], 1);
});

test('sem CSPRNG cai no fallback e ainda preenche os 16 bytes', () => {
  // React Native sem polyfill não tem `crypto.getRandomValues`. Lançar aqui
  // deixaria o app sem conseguir mandar mensagem nenhuma — e o valor é uma
  // chave de deduplicação, não uma credencial.
  const bytes = defaultRandomBytes(new Uint8Array(16), undefined);
  assert.equal(bytes.length, 16);
  assert.ok(bytes.every((b) => b >= 0 && b <= 255));
});

test('o retry reaproveita o UUID já guardado na mensagem falha', () => {
  // Gerar um id novo no retry criaria um SEGUNDO lançamento do que já rodou:
  // é exatamente a duplicata que a chave existe para impedir.
  const falha = { clientMessageId: 'f7c1c2b8-0000-4000-8000-000000000001' };
  const idDoRetry = falha.clientMessageId ?? newClientMessageId();
  assert.equal(idDoRetry, 'f7c1c2b8-0000-4000-8000-000000000001');
});

// ---------------------------------------------------------------------------
// validação do que dá para enviar
// ---------------------------------------------------------------------------

test('mensagem vazia ou só com espaço não envia', () => {
  for (const texto of ['', '   ', '\n\n', '\t ']) {
    assert.equal(canSendMessage(texto), false, JSON.stringify(texto));
  }
});

test('mensagem no limite envia e acima não', () => {
  assert.equal(MAX_MESSAGE_LENGTH, 4000);
  assert.equal(canSendMessage('x'.repeat(4000)), true);
  assert.equal(canSendMessage('x'.repeat(4001)), false);
});

test('o limite conta o texto TRIMADO, que é o que o servidor recebe', () => {
  assert.equal(canSendMessage(`  ${'x'.repeat(4000)}  `), true);
});

test('título vazio ou acima de 80 não salva', () => {
  assert.equal(MAX_TITLE_LENGTH, 80);
  assert.equal(canSaveTitle('Contas do mês'), true);
  assert.equal(canSaveTitle('t'.repeat(80)), true);
  assert.equal(canSaveTitle('t'.repeat(81)), false);
  assert.equal(canSaveTitle('   '), false);
});

// ---------------------------------------------------------------------------
// paginação
// ---------------------------------------------------------------------------

const conversa = (id: string) => ({ id, title: id, last_message_at: '2026-09-04T12:00:00Z' });

test('páginas de conversas concatenam sem duplicar id', () => {
  const juntas = appendConversationPage(
    [conversa('a'), conversa('b')],
    [conversa('b'), conversa('c')],
  );
  assert.deepEqual(juntas.map((c) => c.id), ['a', 'b', 'c']);
});

test('a conversa repetida fica com a versão MAIS NOVA', () => {
  // A página seguinte chega depois; se a conversa recebeu mensagem no meio, o
  // título e a data novos são os que valem.
  const juntas = appendConversationPage(
    [{ ...conversa('a'), title: 'antigo' }],
    [{ ...conversa('a'), title: 'renomeado' }],
  );
  assert.equal(juntas.length, 1);
  assert.equal(juntas[0].title, 'renomeado');
});

const msg = (sequence: number) => ({
  id: `m${sequence}`,
  sequence,
  role: 'user' as const,
  content: `t${sequence}`,
  status: 'completed' as const,
});

test('página antiga entra ANTES sem mudar a ordem', () => {
  const juntas = prependMessagePage([msg(5), msg(6)], [msg(3), msg(4)]);
  assert.deepEqual(juntas.map((m) => m.sequence), [3, 4, 5, 6]);
});

test('sequence repetido não duplica', () => {
  const juntas = prependMessagePage([msg(4), msg(5)], [msg(3), msg(4)]);
  assert.deepEqual(juntas.map((m) => m.sequence), [3, 4, 5]);
});

test('mensagem local sem sequence sobrevive à chegada da página', () => {
  // O turno otimista ainda não tem `sequence` (o banco é quem numera). Cortá-lo
  // aqui faria a própria mensagem sumir da tela enquanto ela é enviada.
  const local = { id: 'local-1', role: 'user' as const, content: 'enviando',
                  status: 'processing' as const, clientMessageId: 'abc' };
  const juntas = prependMessagePage([local], [msg(3)]);
  assert.equal(juntas.length, 2);
  assert.equal(juntas.at(-1)?.id, 'local-1');
});

// ---------------------------------------------------------------------------
// scroll
// ---------------------------------------------------------------------------

test('isNearChatEnd distingue 80px do fim', () => {
  // A régua existe para decidir se a resposta que chega rola sozinha. Rolar com
  // o usuário lendo mensagem antiga é arrancar a tela da mão dele.
  const perto = { contentOffset: 920, layoutHeight: 100, contentHeight: 1040 };
  assert.equal(isNearChatEnd(perto), true, '20px do fim é perto');

  const longe = { contentOffset: 500, layoutHeight: 100, contentHeight: 1040 };
  assert.equal(isNearChatEnd(longe), false, '440px do fim não é perto');

  const limite = { contentOffset: 860, layoutHeight: 100, contentHeight: 1040 };
  assert.equal(isNearChatEnd(limite), true, 'exatamente 80px ainda conta como perto');
});

// ---------------------------------------------------------------------------
// erros: o que a tela faz com cada um
// ---------------------------------------------------------------------------

test('402 abre paywall e não oferece nova tentativa', () => {
  const p = retryPolicyFor({ status: 402, code: 'plan_limit' });
  assert.equal(p.paywall, true);
  assert.equal(p.retryable, false);
});

test('409 mantém o composer bloqueado e é retentável', () => {
  // A conversa está processando outra mensagem: tentar de novo é o certo, mas
  // não com o composer liberado — o usuário escreveria em cima do que espera.
  const p = retryPolicyFor({ status: 409, code: 'conversation_busy' });
  assert.equal(p.blockComposer, true);
  assert.equal(p.retryable, true);
  assert.equal(p.paywall, false);
});

test('429 é retentável sem paywall', () => {
  const p = retryPolicyFor({ status: 429, code: 'rate_limit' });
  assert.equal(p.retryable, true);
  assert.equal(p.paywall, false);
});

test('falha de rede é retentável', () => {
  const p = retryPolicyFor({ status: 0, code: 'network' });
  assert.equal(p.retryable, true);
});

test('422 e 404 não são retentáveis: repetir dá o mesmo erro', () => {
  assert.equal(retryPolicyFor({ status: 422, code: 'invalid_request' }).retryable, false);
  assert.equal(retryPolicyFor({ status: 404, code: 'conversation_not_found' }).retryable, false);
});

test('500 é retentável', () => {
  assert.equal(retryPolicyFor({ status: 500, code: 'internal' }).retryable, true);
});

// ---------------------------------------------------------------------------
// HITL
// ---------------------------------------------------------------------------

test('pergunta já resolvida desabilita TODOS os controles', () => {
  // Um botão vivo numa pergunta antiga faria o usuário tocar no que a tela
  // mostra e receber um erro por isso.
  assert.equal(hitlControlsDisabled({ pending_id: 'p1', resolved: 'approve' }), true);
  assert.equal(hitlControlsDisabled({ pending_id: 'p1', resolved: 'reject' }), true);
  assert.equal(hitlControlsDisabled({ pending_id: 'p1' }), false);
});

test('payload sem pending_id não tem controle para habilitar', () => {
  assert.equal(hitlControlsDisabled({}), true);
  assert.equal(hitlControlsDisabled(null), true);
});

test('turno em andamento também desabilita', () => {
  assert.equal(hitlControlsDisabled({ pending_id: 'p1' }, { busy: true }), true);
});

// ---------------------------------------------------------------------------
// requisição autenticada
// ---------------------------------------------------------------------------

function deps(statuses: number[], tokenNovo: string | null = 'novo') {
  const log: string[] = [];
  let i = 0;
  return {
    log,
    d: {
      send: async (token: string | null) => {
        log.push(`send:${token}`);
        return { status: statuses[Math.min(i++, statuses.length - 1)] };
      },
      getToken: async () => 'antigo',
      refresh: async () => {
        log.push('refresh');
        return tokenNovo;
      },
      signOut: async () => {
        log.push('signOut');
      },
    },
  };
}

test('200 não renova nada', async () => {
  const { log, d } = deps([200]);
  const r = await authorizedRequest(d);
  assert.equal(r.kind, 'response');
  assert.deepEqual(log, ['send:antigo']);
});

test('401 renova UMA vez e repete com o token novo', async () => {
  const { log, d } = deps([401, 200]);
  const r = await authorizedRequest(d);
  assert.equal(r.kind, 'response');
  assert.deepEqual(log, ['send:antigo', 'refresh', 'send:novo']);
});

test('401 no retry encerra a sessão e NÃO tenta uma terceira vez', async () => {
  // O loop de refresh é o bug que esta função existe para impedir: com o token
  // expirado, ele bateria no servidor sem parar e a tela giraria para sempre.
  const { log, d } = deps([401, 401]);
  const r = await authorizedRequest(d);
  assert.equal(r.kind, 'expired');
  assert.deepEqual(log, ['send:antigo', 'refresh', 'send:novo', 'signOut']);
  assert.equal(log.filter((l) => l === 'refresh').length, 1);
});

test('refresh que falha encerra a sessão sem tentar de novo', async () => {
  const { log, d } = deps([401], null);
  const r = await authorizedRequest(d);
  assert.equal(r.kind, 'expired');
  assert.deepEqual(log, ['send:antigo', 'refresh', 'signOut']);
});

test('erro que não é 401 passa direto, sem renovar', async () => {
  for (const status of [402, 409, 429, 500]) {
    const { log, d } = deps([status]);
    const r = await authorizedRequest(d);
    assert.equal(r.kind, 'response');
    assert.deepEqual(log, ['send:antigo'], `status ${status} renovou sessão à toa`);
  }
});

// ---------------------------------------------------------------------------
// composer
// ---------------------------------------------------------------------------

test('composer bloqueia vazio, acima do limite, turno ativo e pergunta aberta', () => {
  assert.equal(canSubmitMessage('oi'), true);
  assert.equal(canSubmitMessage('   '), false, 'só espaço não é mensagem');
  assert.equal(canSubmitMessage('a'.repeat(MAX_MESSAGE_LENGTH + 1)), false);
  // As duas travas que evitam um 409 que a tela já sabia que viria: a conversa
  // é serializada por lease no servidor.
  assert.equal(canSubmitMessage('oi', { sending: true }), false);
  assert.equal(canSubmitMessage('oi', { awaitingAction: true }), false);
});

// ---------------------------------------------------------------------------
// rota depois de criar
// ---------------------------------------------------------------------------

test('a conversa criada vira a rota do id, não uma tela nova', () => {
  assert.equal(conversationRoute('c1'), '/agent/c1');
});

// ---------------------------------------------------------------------------
// HITL — tradução do payload do motor
// ---------------------------------------------------------------------------

const PID = 'e0a1b2c3-0000-4000-8000-000000000001';

test('confirmação simples vira approve e reject', () => {
  const { body, options } = parseUiActions({
    pending_id: PID,
    body: '⚠️ Confirma apagar o gasto de R$ 45?',
    buttons: [
      [`pa:${PID}:ok`, 'Confirmar'],
      [`pa:${PID}:no`, 'Cancelar'],
    ],
  });
  assert.equal(body, '⚠️ Confirma apagar o gasto de R$ 45?');
  assert.deepEqual(
    options.map((o) => [o.label, o.decision, o.candidateId]),
    [
      ['Confirmar', 'approve', undefined],
      ['Cancelar', 'reject', undefined],
    ],
  );
});

test('candidatos viram choose com o id que o servidor congelou', () => {
  const { options } = parseUiActions({
    pending_id: PID,
    body: '🤔 qual deles?',
    buttons: [
      [`pa:${PID}:c:tx-1`, '1) Mercado R$ 45'],
      [`pa:${PID}:c:tx-2`, '2) Mercado R$ 54'],
      [`pa:${PID}:none`, 'Nenhuma dessas'],
    ],
  });
  assert.deepEqual(
    options.map((o) => [o.decision, o.candidateId]),
    [
      ['choose', 'tx-1'],
      ['choose', 'tx-2'],
      // "nenhuma dessas" é um cancelamento para a API do app.
      ['reject', undefined],
    ],
  );
});

test('lista longa vira linhas com descrição', () => {
  const { options } = parseUiActions({
    pending_id: PID,
    body: 'qual deles?',
    rows: [
      [`pa:${PID}:c:tx-9`, '1) Uber', '28/08/2026'],
      [`pa:${PID}:none`, 'Nenhuma dessas', 'Buscar de outro jeito'],
    ],
  });
  assert.equal(options[0].description, '28/08/2026');
  assert.equal(options[1].description, 'Buscar de outro jeito');
});

test('opção de OUTRA pergunta é descartada', () => {
  // A trava que importa: um payload velho ainda na tela não pode responder à
  // pergunta nova — seria apagar o registro errado com um toque.
  const { options } = parseUiActions({
    pending_id: PID,
    buttons: [
      [`pa:${PID}:ok`, 'Confirmar'],
      ['pa:00000000-0000-4000-8000-0000000000ff:ok', 'Confirmar (outra)'],
      ['lixo', 'Sem prefixo'],
      [`pa:${PID}:c:`, 'Choose sem candidato'],
    ],
  });
  assert.deepEqual(options.map((o) => o.label), ['Confirmar']);
});

test('payload sem pendente não rende botão nenhum', () => {
  // Sem `pending_id` não há a que responder: o balão é só texto.
  const r = parseUiActions({ body: 'oi', buttons: [['pa:x:ok', 'Confirmar']] });
  assert.deepEqual(r.options, []);
  assert.equal(r.body, 'oi');
  assert.deepEqual(parseUiActions(null).options, []);
});

test('resolvido e expirado deixam os controles inertes', () => {
  const aberta = { pending_id: PID };
  assert.equal(hitlControlsDisabled(aberta), false);
  assert.equal(hitlControlsDisabled(aberta, { busy: true }), true);
  assert.equal(hitlControlsDisabled(markResolved(aberta, 'approve')), true);
  // `pending_invalid` (422) não vem do servidor como estado da mensagem: quem
  // carimba é a tela, senão os botões da pergunta morta seguiriam vivos.
  assert.equal(hitlControlsDisabled(markResolved(aberta, 'expired')), true);
  assert.equal(markResolved(aberta, 'expired').pending_id, PID, 'o resumo continua');
});
