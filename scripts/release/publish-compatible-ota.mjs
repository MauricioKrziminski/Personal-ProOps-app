import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publishCompatibleUpdate } from './ota-compatibility.mjs';
const [receiptPath, currentPath, tag] = process.argv.slice(2);
// EAS CLI 23.2.0 accepts inherited environment in CI without fetching it again.
// The workflow wraps this entire process in one explicit production env:exec.
if (!process.env.CI || process.env.EXPO_NO_DOTENV !== '1' || process.env.APP_VARIANT !== 'production') {
  throw new Error('Execute no CI dentro de eas env:exec production, sem dotenv.');
}
execFileSync(process.execPath, [fileURLToPath(new URL('./create-native-compatibility.mjs', import.meta.url)), currentPath], { stdio: 'inherit' });
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Tag nativa inválida.');
const sourceCommit = execFileSync('git', ['rev-parse', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim();
execFileSync('git', ['merge-base', '--is-ancestor', sourceCommit, 'HEAD']);
const changedFiles = execFileSync('git', ['diff', '--name-only', '-z', sourceCommit, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const base = JSON.parse(readFileSync(receiptPath, 'utf8'));
const current = JSON.parse(readFileSync(currentPath, 'utf8'));
await publishCompatibleUpdate(base, current, { tag, sourceCommit, changedFiles }, () => {
  execFileSync('eas', ['update', '--channel', 'production', '--platform', 'android', '--non-interactive', '--message', `OTA ${current.sourceCommit.slice(0, 12)} para ${tag}`], { stdio: 'inherit' });
});
