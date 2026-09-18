import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { walletStageWidth } from './card-geometry.ts';

test('the wallet keeps phone geometry and bounds the tablet carousel', () => {
  assert.equal(walletStageWidth(390), 390);
  assert.equal(walletStageWidth(640), 640);
  assert.equal(walletStageWidth(820), 640);
  assert.equal(walletStageWidth(1180), 640);
  assert.equal(walletStageWidth(1180, 560), 560);
  assert.equal(walletStageWidth(820, 480), 480);
  assert.equal(walletStageWidth(Number.NaN), 0);
});

test('the measured stage is centered and a resize follows the current card', () => {
  const carousel = readFileSync('src/components/finance/wallet-carousel.tsx', 'utf8');
  const wallet = readFileSync('src/app/finance/wallet.tsx', 'utf8');
  assert.match(carousel, /walletStageWidth\(width, availableWidth\)/);
  assert.match(wallet, /onLayout=\{tablet \? measureStage : undefined\}/);
  assert.match(wallet, /geometry=\{g\}/);
  assert.match(carousel, /width: g\.largura/);
  assert.match(carousel, /alignSelf: 'center'/);
  assert.match(carousel, /x\.set\(indiceAtual\.current \* g\.passo\)/);
});
