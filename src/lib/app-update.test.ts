/** `node --test` (Node 24+ faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_UPDATE_MANIFEST_BYTES,
  appUpdateAction,
  appUpdateSubtitle,
  downloadAndVerifyApkStream,
  downloadPercent,
  hasNewerVersion,
  parseUpdateManifest,
  readTextStreamWithLimit,
  type AppUpdateState,
} from './app-update.ts';

const manifest = {
  versionCode: 7,
  versionName: '1.2.0',
  url: 'https://github.com/almeidagabriel01/Personal-ProOps-app-releases/releases/download/v1.2.0/personal-proops-1.2.0.apk',
  sha256: 'A'.repeat(64),
  notes: 'Busca mais rápida e correção dos lembretes.',
};

test('parseia o contrato, ignora campos novos e normaliza o sha256', () => {
  assert.deepEqual(
    parseUpdateManifest(JSON.stringify({ ...manifest, futureField: true })),
    { ...manifest, sha256: 'a'.repeat(64) },
  );
});

test('notas são opcionais para manter compatibilidade com manifestos antigos', () => {
  const { notes: _notes, ...withoutNotes } = manifest;
  assert.equal(parseUpdateManifest(JSON.stringify(withoutNotes)).notes, '');
});

test('recusa HTML explicitamente antes de tentar baixar qualquer APK', () => {
  assert.throws(
    () => parseUpdateManifest('<!doctype html><title>Not Found</title>'),
    /HTML/,
  );
});

test('recusa campos obrigatórios inválidos', () => {
  assert.throws(
    () => parseUpdateManifest(JSON.stringify({ ...manifest, versionCode: 0 })),
    /versionCode/,
  );
  assert.throws(
    () => parseUpdateManifest(JSON.stringify({ ...manifest, versionName: '' })),
    /versionName/,
  );
  assert.throws(
    () => parseUpdateManifest(JSON.stringify({ ...manifest, url: 'http://example.com/app.apk' })),
    /HTTPS/,
  );
  assert.throws(
    () => parseUpdateManifest(JSON.stringify({ ...manifest, sha256: 'abc' })),
    /sha256/,
  );
});

test('limita o corpo durante a leitura, não só depois do download', async () => {
  const withinLimit = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ok":'));
      controller.enqueue(new TextEncoder().encode('true}'));
      controller.close();
    },
  });
  assert.equal(await readTextStreamWithLimit(withinLimit.getReader(), 32), '{"ok":true}');

  const tooLarge = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_UPDATE_MANIFEST_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  await assert.rejects(
    readTextStreamWithLimit(tooLarge.getReader(), MAX_UPDATE_MANIFEST_BYTES),
    /64 KB/,
  );
});

test('só versionCode estritamente maior é atualização', () => {
  assert.equal(hasNewerVersion({ ...manifest, versionCode: 8 }, 7), true);
  assert.equal(hasNewerVersion({ ...manifest, versionCode: 7 }, 7), false);
  assert.equal(hasNewerVersion({ ...manifest, versionCode: 6 }, 7), false);
});

test('progresso é inteiro, limitado e ausente sem tamanho total', () => {
  assert.equal(downloadPercent(1, 3), 33);
  assert.equal(downloadPercent(3, 3), 100);
  assert.equal(downloadPercent(4, 3), 100);
  assert.equal(downloadPercent(1, null), null);
  assert.equal(downloadPercent(1, 0), null);
});

test('grava e calcula o SHA-256 no mesmo laço, emitindo só percentuais novos', async () => {
  const chunks = [
    new TextEncoder().encode('a'),
    new TextEncoder().encode('b'),
    new TextEncoder().encode('c'),
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const written: number[] = [];
  const progress: number[] = [];
  let closed = false;
  let removed = false;

  const result = await downloadAndVerifyApkStream({
    reader: stream.getReader(),
    expectedSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    totalBytes: 3,
    sink: {
      write(chunk) {
        written.push(...chunk);
      },
      close() {
        closed = true;
      },
      remove() {
        removed = true;
      },
    },
    onProgress(value) {
      progress.push(value);
    },
  });

  assert.deepEqual(written, [...new TextEncoder().encode('abc')]);
  assert.deepEqual(progress, [33, 66, 100]);
  assert.equal(result.bytesWritten, 3);
  assert.equal(closed, true);
  assert.equal(removed, false);
});

test('apaga o APK parcial quando o hash não confere', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('arquivo truncado'));
      controller.close();
    },
  });
  let closed = false;
  let removed = false;

  await assert.rejects(
    downloadAndVerifyApkStream({
      reader: stream.getReader(),
      expectedSha256: '0'.repeat(64),
      totalBytes: null,
      sink: {
        write() {},
        close() {
          closed = true;
        },
        remove() {
          removed = true;
        },
      },
    }),
    /não confere/,
  );
  assert.equal(closed, true);
  assert.equal(removed, true);
});

test('a interface mostra as notas e só oferece a próxima etapa válida', () => {
  const available: AppUpdateState = { status: 'available', manifest };
  assert.match(appUpdateSubtitle(available, '1.0.0'), /Busca mais rápida/);
  assert.equal(appUpdateAction(available), 'download');
  assert.equal(
    appUpdateAction({ status: 'downloading', manifest, progress: 42 }),
    null,
  );
  assert.equal(
    appUpdateAction({ status: 'ready', manifest, fileUri: 'file:///cache/app.apk' }),
    'install',
  );
});
