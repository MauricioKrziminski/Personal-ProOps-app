import { readFileSync, writeFileSync } from 'node:fs';
import { attestNativeBuild } from './native-compatibility.mjs';
const [receiptPath, buildPath, apkSha256] = process.argv.slice(2);
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const build = JSON.parse(readFileSync(buildPath, 'utf8'));
writeFileSync(receiptPath, JSON.stringify(attestNativeBuild(receipt, build, apkSha256), null, 2) + '\n');
