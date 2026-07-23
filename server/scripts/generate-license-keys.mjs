import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = join(process.cwd(), 'secrets')
mkdirSync(out, { recursive: true })
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
writeFileSync(join(out, 'license-private.pem'), privateKey, { mode: 0o600 })
writeFileSync(join(out, 'license-public.pem'), publicKey)
console.log('Generated server/secrets/license-private.pem and license-public.pem')
console.log('Keep the private key in the production secret manager; only the public key is embedded in clients.')
