import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authErrorMessage } from './auth-errors.ts';

test('sem erro, sem mensagem', () => {
  assert.equal(authErrorMessage(null), null);
  assert.equal(authErrorMessage(undefined), null);
});

test('código errado e código expirado são frases diferentes', () => {
  assert.match(
    authErrorMessage({ message: 'Token has expired or is invalid', code: 'otp_expired' })!,
    /expirou/
  );
  assert.match(authErrorMessage({ message: 'Invalid token', code: 'invalid_credentials' })!, /6 dígitos/);
});

test('rate limit devolve os segundos que a API informou', () => {
  assert.equal(
    authErrorMessage({
      message: 'For security purposes, you can only request this after 39 seconds.',
      status: 429,
    }),
    'Aguarde 39 segundos para pedir outro código.'
  );
  assert.match(authErrorMessage({ code: 'over_sms_send_rate_limit' })!, /Espere um minuto/);
});

test('número inválido fala de DDD, não de token', () => {
  assert.match(
    authErrorMessage({ message: 'Invalid phone number', code: 'validation_failed' })!,
    /DDD/
  );
});

test('queda de rede tem saída própria', () => {
  assert.match(authErrorMessage({ message: 'Network request failed' })!, /conexão/);
});

test('erro imprevisto nunca vaza inglês', () => {
  const out = authErrorMessage({ message: 'Something exploded upstream', code: 'unexpected_failure' })!;
  assert.match(out, /Tente de novo/);
  assert.doesNotMatch(out, /exploded/);
});
