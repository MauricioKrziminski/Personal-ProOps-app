import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avisoNoPrazo, avisoVisivel, decisaoDeVersao, type AppConfig } from './app-config.ts';

const cfg: AppConfig = {
  min_version_ios: '1.5.0',
  latest_version_ios: '1.8.0',
  store_url_ios: 'https://apps.apple.com/app/x',
  min_version_android: '1.2.0',
  latest_version_android: '1.2.0',
  updated_at: '2026-10-09T10:00:00Z',
};

test('versão: abaixo do mínimo bloqueia, abaixo da última avisa, a plataforma decide', () => {
  assert.deepEqual(decisaoDeVersao(cfg, 'ios', '1.4.9'), { tipo: 'bloquear', url: cfg.store_url_ios, ultima: null });
  assert.deepEqual(decisaoDeVersao(cfg, 'ios', '1.6.0'), { tipo: 'aviso', url: cfg.store_url_ios, ultima: '1.8.0' });
  assert.equal(decisaoDeVersao(cfg, 'ios', '1.8.0').tipo, null);
  assert.equal(decisaoDeVersao(cfg, 'android', '1.2.0').tipo, null, 'o Android tem os próprios números');
  assert.equal(decisaoDeVersao(cfg, 'android', '1.1.0').url, null, 'sem URL, o botão não aparece');
});

test('versão: config ausente, web ou versão ilegível segue', () => {
  assert.equal(decisaoDeVersao(null, 'ios', '1.0.0').tipo, null);
  assert.equal(decisaoDeVersao(cfg, 'web', '1.0.0').tipo, null);
  assert.equal(decisaoDeVersao(cfg, 'ios', null).tipo, null);
});

test('aviso: no prazo, sem prazo, vencido e vazio', () => {
  const agora = Date.parse('2026-10-09T12:00:00Z');
  const base: AppConfig = { notice_title: 'Manutenção', notice_body: 'Hoje às 22h', notice_level: 'warning', updated_at: 'v1' };
  assert.equal(avisoNoPrazo(base, agora)?.nivel, 'warning', 'null = sem prazo');
  assert.ok(avisoNoPrazo({ ...base, notice_until: '2026-10-09T13:00:00Z' }, agora));
  assert.equal(avisoNoPrazo({ ...base, notice_until: '2026-10-09T11:00:00Z' }, agora), null, 'passou do prazo');
  assert.equal(avisoNoPrazo({ ...base, notice_title: ' ', notice_body: null }, agora), null);
  assert.equal(avisoNoPrazo(null, agora), null);
});

test('aviso: dispensar vale por updated_at; crítico não dispensa', () => {
  const agora = Date.parse('2026-10-09T12:00:00Z');
  const info = avisoNoPrazo({ notice_title: 'x', notice_level: 'info', updated_at: 'v1' }, agora);
  assert.equal(avisoVisivel(info, 'v1'), null);
  assert.ok(avisoVisivel(info, 'v0'), 'texto editado volta');
  const critico = avisoNoPrazo({ notice_title: 'x', notice_level: 'critical', updated_at: 'v1' }, agora);
  assert.ok(avisoVisivel(critico, 'v1'));
});
