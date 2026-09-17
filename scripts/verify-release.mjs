import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, verify } from 'node:crypto';

const manifestPath = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-release.mjs output/<release>.manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
const binary = readFileSync(resolve(dirname(manifestPath), manifest.file));
const hash = createHash('sha256').update(binary).digest('hex');
if (hash !== manifest.sha256 || binary.length !== manifest.size) throw new Error('Release hash/size mismatch');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = readFileSync(resolve(root, 'build/release-kit/release-public.pem'));
const message = `ProxySplit-Release-Signature-v1\nversion=${manifest.version}\nsha256=${hash}\nurl=${manifest.url}\n`;
if (!verify(null, Buffer.from(message), key, Buffer.from(manifest.signature, 'base64'))) throw new Error('Release Ed25519 signature mismatch');
console.log(JSON.stringify({ version: manifest.version, sha256: hash, size: binary.length, signatureValid: true, coreVersion: manifest.coreVersion, obfuscated: manifest.obfuscated, authenticodeSigned: manifest.authenticodeSigned }, null, 2));
