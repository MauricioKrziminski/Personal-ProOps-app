import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isExpectedPhoneLink } from './phone-link.ts';

test('aceita o mesmo usuário e telefone mesmo com formatos diferentes', () => {
  assert.equal(
    isExpectedPhoneLink(
      { id: 'user-1', phone: '5511999998888' },
      'user-1',
      '+55 (11) 99999-8888'
    ),
    true
  );
});

test('recusa resposta do OTP que aponta para outro usuário', () => {
  assert.equal(
    isExpectedPhoneLink(
      { id: 'user-2', phone: '5511999998888' },
      'user-1',
      '+5511999998888'
    ),
    false
  );
});

test('recusa usuário sem telefone ou com outro número', () => {
  assert.equal(isExpectedPhoneLink({ id: 'user-1', phone: null }, 'user-1', '+5511999998888'), false);
  assert.equal(
    isExpectedPhoneLink(
      { id: 'user-1', phone: '5511988887777' },
      'user-1',
      '+5511999998888'
    ),
    false
  );
});
