const assert = require('node:assert/strict');
const { test } = require('node:test');

const { alinhar } = require('./with-work-runtime-alinhado');

test('força o work-runtime-ktx na 2.8.1, uma vez só (prebuild roda de novo)', () => {
  const uma = alinhar('android {}');
  assert.match(uma, /force 'androidx\.work:work-runtime-ktx:2\.8\.1'/);
  assert.equal(alinhar(uma), uma, 'idempotente');
});
