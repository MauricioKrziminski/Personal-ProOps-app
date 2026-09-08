import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseApkCompatibility, attestLocalNativeBuild } from './local-native-compatibility.mjs';

const [receiptPath, apkPath, aapt2] = process.argv.slice(2);
assert.ok(receiptPath && apkPath && aapt2, 'Informe comprovante, APK e caminho do aapt2.');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Atestação local exige runner GitHub Actions.');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), process.env.GITHUB_SHA);
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const dump = (args) => execFileSync(aapt2, ['dump', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const apk = parseApkCompatibility(dump(['xmltree', apkPath, '--file', 'AndroidManifest.xml']), dump(['resources', apkPath]));
const apkSha256 = createHash('sha256').update(readFileSync(apkPath)).digest('hex');
const result = attestLocalNativeBuild(receipt, apk, apkSha256, {
  sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
});
writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');
