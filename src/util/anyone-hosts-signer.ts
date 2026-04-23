import * as crypto from 'crypto'
import { ed25519 } from '@noble/curves/ed25519.js'

import { hsUtils } from './hidden-service-utils'

const TOR_SECRET_KEY_MAGIC = Buffer.concat([
  Buffer.from('== ed25519v1-secret: type0 ==', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00]),
])
const TOR_SECRET_KEY_LENGTH = 96
const ED25519_L = ed25519.Point.Fn.ORDER

const SIGNATURE_PREFIX = Buffer.from('anyone-hosts-signature', 'ascii')

export interface ExpandedSecretKey {
  scalar: Buffer
  prefix: Buffer
  publicKey: Buffer
}

export interface SignedDocumentInput {
  mappings: Array<{ domain: string; hsAddress: string }>
  signerAddress: string
  key: ExpandedSecretKey
  published: Date
  validUntil: Date
}

function bytesToBigIntLE(bytes: Buffer): bigint {
  let result = 0n
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i])
  }
  return result
}

function bigIntToBytesLE(n: bigint, length: number): Buffer {
  const out = Buffer.alloc(length)
  let value = n
  for (let i = 0; i < length; i++) {
    out[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return out
}

function sha512(...chunks: Buffer[]): Buffer {
  const h = crypto.createHash('sha512')
  for (const c of chunks) h.update(c)
  return h.digest()
}

/**
 * Parse a Tor v3 hs_ed25519_secret_key file (base64-encoded).
 *
 * The file is 96 bytes: a 32-byte magic header followed by a 64-byte
 * expanded Ed25519 private key (32-byte scalar `a` + 32-byte nonce prefix).
 */
export function parseTorSecretKey(base64: string): ExpandedSecretKey {
  let raw: Buffer
  try {
    raw = Buffer.from(base64, 'base64')
  } catch (e: any) {
    throw new Error(`HIDDEN_SERVICE_SECRET_KEY is not valid base64: ${e.message}`)
  }
  if (raw.length !== TOR_SECRET_KEY_LENGTH) {
    throw new Error(
      `HIDDEN_SERVICE_SECRET_KEY must decode to ${TOR_SECRET_KEY_LENGTH}` +
        ` bytes (got ${raw.length})`,
    )
  }
  const header = raw.subarray(0, 32)
  if (!header.equals(TOR_SECRET_KEY_MAGIC)) {
    throw new Error(
      'HIDDEN_SERVICE_SECRET_KEY magic header does not match' +
        ' "== ed25519v1-secret: type0 =="',
    )
  }

  const scalar = Buffer.from(raw.subarray(32, 64))
  const prefix = Buffer.from(raw.subarray(64, 96))
  // The Tor-stored scalar is a clamped 255-bit value that may exceed the
  // curve order L (~2^252). Reduce mod L before calling into noble (which
  // enforces 1 <= scalar < L). Reducing the scalar preserves the public
  // key point and all signatures because the scalar subgroup has order L.
  const scalarInt = bytesToBigIntLE(scalar) % ED25519_L
  const publicKeyPoint = ed25519.Point.BASE.multiply(scalarInt)
  const publicKey = Buffer.from(publicKeyPoint.toBytes())

  return { scalar, prefix, publicKey }
}

/**
 * Raw Ed25519 signing from an already-expanded (scalar, prefix) secret key.
 *
 * Required because Tor stores the 64-byte expanded form rather than the
 * 32-byte seed that high-level Ed25519 APIs expect.
 */
export function signWithExpandedKey(
  key: ExpandedSecretKey,
  message: Buffer,
): Buffer {
  const scalarInt = bytesToBigIntLE(key.scalar) % ED25519_L
  const rHash = sha512(key.prefix, message)
  const r = bytesToBigIntLE(rHash) % ED25519_L
  // r = 0 has probability ~2^-252 and would make R the identity point,
  // which noble's multiply() rejects. In that vanishingly unlikely case we
  // multiply by L (which is equivalent to 0 on the group) so the sig is
  // still well-formed; S uses r unchanged.
  const R = ed25519.Point.BASE.multiply(r === 0n ? ED25519_L : r)
  const rBytes = Buffer.from(R.toBytes())

  const kHash = sha512(rBytes, key.publicKey, message)
  const k = bytesToBigIntLE(kHash) % ED25519_L
  const sInt = (r + k * scalarInt) % ED25519_L
  const sBytes = bigIntToBytesLE(sInt, 32)

  return Buffer.concat([rBytes, sBytes])
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatTimestamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    ` ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  )
}

function computeMappingDigest(
  mappings: Array<{ domain: string; hsAddress: string }>,
): string {
  const lines = mappings
    .map((m) => `${m.domain} ${m.hsAddress}`)
    .sort()
    .join('\n')
  return crypto.createHash('sha256').update(lines, 'utf8').digest('hex')
}

function wrapBase64(data: Buffer, width = 64): string {
  const b64 = data.toString('base64')
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += width) {
    lines.push(b64.slice(i, i + width))
  }
  return lines.join('\n')
}

/**
 * Build a signed anyone_hosts document per the spec in
 * `.todo/anyone_hosts_format.txt`.
 *
 * The signed region runs from the first byte of `anyone-hosts-version`
 * through (and including) the trailing LF of the `anyone-hosts-signature`
 * line. The signature is computed as
 *   Ed25519(key, "anyone-hosts-signature" || sha256(signedRegion))
 * and emitted inside a PEM-style object after the signed region.
 */
export function buildSignedAnyoneHostsDocument(
  input: SignedDocumentInput,
): string {
  const { mappings, signerAddress, key, published, validUntil } = input

  const mappingBlock = mappings
    .map((m) => `${m.domain} ${m.hsAddress}`)
    .join('\n')
  const digestHex = computeMappingDigest(mappings)

  const signedRegion =
    `anyone-hosts-version 1\n` +
    `anyone-hosts-status signed\n` +
    `published ${formatTimestamp(published)}\n` +
    `valid-until ${formatTimestamp(validUntil)}\n` +
    `\n` +
    (mappingBlock ? `${mappingBlock}\n` : ``) +
    `\n` +
    `anyone-hosts-digest sha256 ${digestHex}\n` +
    `anyone-hosts-signature ${signerAddress}\n`

  const signedRegionBytes = Buffer.from(signedRegion, 'utf8')
  const digest = crypto.createHash('sha256').update(signedRegionBytes).digest()
  const message = Buffer.concat([SIGNATURE_PREFIX, digest])
  const signature = signWithExpandedKey(key, message)

  const pem =
    `-----BEGIN SIGNATURE-----\n` +
    `${wrapBase64(signature)}\n` +
    `-----END SIGNATURE-----\n`

  return signedRegion + pem
}

/**
 * Derive the signer's hidden-service address from the parsed secret key.
 */
export function deriveSignerAddress(
  key: ExpandedSecretKey,
  tld: string = 'anyone',
): string {
  return hsUtils.hiddenServiceAddressFromPublicKey(key.publicKey, tld)
}

export const _internals = {
  SIGNATURE_PREFIX,
  TOR_SECRET_KEY_MAGIC,
  computeMappingDigest,
  formatTimestamp,
}
