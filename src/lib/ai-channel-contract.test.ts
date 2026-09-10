/**
 * `ai_events` é o contador do paywall, e ele tem DOIS escritores.
 *
 * A cota mensal é `count(*)` de `ai_events` por workspace. Um escritor que
 * esqueça `workspace_id` ou `channel` não quebra nada — ele derruba o paywall em
 * silêncio (evento sem workspace não conta para ninguém) ou joga o consumo no
 * medidor do canal errado. Nenhum teste de comportamento pega isso do lado que
 * não rodou.
 *
 * **O que é comportamento está em pytest**, não aqui: quem prova que um turno do
 * app grava `channel='app'` e um do WhatsApp grava `whatsapp` é
 * `tests/test_app_whatsapp_isolation.py`.
 *
 * ⚠️ **Sobrou UM escritor** (09/09/2026). Este arquivo existia porque eram dois: o Python e a
 * Edge Function legada, que escrevia na mesma tabela durante o corte Strangler. Com
 * `supabase/functions/` apagado, o segundo escritor deixou de existir — o teste dele saiu, e a
 * asserção sobre a assinatura Python fica, porque o defeito que ela prende (um chamador novo
 * herdar um canal que não é o dele) não dependia da existência do outro.
 *
 * A leitura de fonte do lado Python ficou, mas ANCORADA na declaração e no SQL —
 * não em offsets entre comentários, que era o jeito frágil de antes: renomear um
 * comentário mudava a fatia e o teste passava a olhar para o nada.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pythonDb = readFileSync('agent/app/db.py', 'utf8');

test('o serviço Python exige o canal e grava as duas colunas', () => {
  // A assinatura: `channel` é keyword-only e SEM default. Um default aqui seria
  // pior que a ausência — todo chamador novo herdaria um canal que talvez não
  // seja o dele, e o medidor erraria sem ninguém notar.
  const assinatura = pythonDb.slice(
    pythonDb.indexOf('async def record_ai_event('),
    pythonDb.indexOf(') -> None:', pythonDb.indexOf('async def record_ai_event(')),
  );
  assert.match(assinatura, /^\s*\*,\s*$/m, 'os argumentos deixaram de ser keyword-only');
  assert.match(assinatura, /channel:\s*Literal\["whatsapp", "app"\],\s*$/m);
  assert.match(assinatura, /workspace_id:\s*UUID,/);

  // E o INSERT carrega as duas colunas.
  const sql = pythonDb.slice(
    pythonDb.indexOf('insert into public.ai_events'),
    pythonDb.indexOf('values', pythonDb.indexOf('insert into public.ai_events')),
  );
  assert.match(sql, /workspace_id/);
  assert.match(sql, /channel/);
});
