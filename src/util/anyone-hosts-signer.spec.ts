import * as crypto from 'crypto'
import { ed25519 } from '@noble/curves/ed25519.js'

import {
  _internals,
  buildSignedAnyoneHostsDocument,
  deriveSignerAddress,
  parseTorSecretKey,
  signWithExpandedKey,
} from './anyone-hosts-signer'
import { hsUtils } from './hidden-service-utils'

function makeTorSecretKeyBase64(seed?: Buffer): {
  base64: string
  seed: Buffer
} {
  const actualSeed = seed ?? crypto.randomBytes(32)
  const h = crypto.createHash('sha512').update(actualSeed).digest()
  const scalar = Buffer.from(h.subarray(0, 32))
  scalar[0] &= 0xf8
  scalar[31] &= 0x7f
  scalar[31] |= 0x40
  const prefix = Buffer.from(h.subarray(32, 64))
  const file = Buffer.concat([_internals.TOR_SECRET_KEY_MAGIC, scalar, prefix])
  return { base64: file.toString('base64'), seed: actualSeed }
}

describe('anyone-hosts-signer', () => {
  describe('parseTorSecretKey', () => {
    it('parses a valid 96-byte Tor secret key file', () => {
      const { base64, seed } = makeTorSecretKeyBase64()
      const key = parseTorSecretKey(base64)
      expect(key.scalar.length).toBe(32)
      expect(key.prefix.length).toBe(32)
      expect(key.publicKey.length).toBe(32)
      const expectedPub = Buffer.from(ed25519.getPublicKey(seed))
      expect(key.publicKey.equals(expectedPub)).toBe(true)
    })

    it('rejects wrong length', () => {
      const short = Buffer.alloc(95).toString('base64')
      expect(() => parseTorSecretKey(short)).toThrow(/96/)
    })

    it('rejects bad magic header', () => {
      const bad = Buffer.alloc(96)
      expect(() => parseTorSecretKey(bad.toString('base64'))).toThrow(
        /magic header/,
      )
    })
  })

  describe('signWithExpandedKey', () => {
    it('produces signatures that verify with ed25519.verify', () => {
      const { base64 } = makeTorSecretKeyBase64()
      const key = parseTorSecretKey(base64)
      const msg = Buffer.from('test-message')
      const sig = signWithExpandedKey(key, msg)
      expect(sig.length).toBe(64)
      expect(ed25519.verify(sig, msg, key.publicKey)).toBe(true)
    })
  })

  describe('buildSignedAnyoneHostsDocument', () => {
    const mappings = [
      {
        domain: 'b.anyone.anyone',
        hsAddress:
          'kjlkfrfxquevo64qv4gssl3t52tiuay2muj7u4rox4llxboj4c4ypcid.anyone',
      },
      {
        domain: 'a.anyone.anyone',
        hsAddress:
          'gadmrvl67444hgzrhsnhzknxaimfnzp6az3wq4d2j7hrf7th34elrrad.anyone',
      },
    ]

    it('emits the expected header / mapping / digest / signature layout', () => {
      const { base64 } = makeTorSecretKeyBase64()
      const key = parseTorSecretKey(base64)
      const addr = deriveSignerAddress(key)
      const doc = buildSignedAnyoneHostsDocument({
        mappings,
        signerAddress: addr,
        key,
        published: new Date(Date.UTC(2026, 3, 22, 0, 0, 0)),
        validUntil: new Date(Date.UTC(2026, 3, 23, 0, 0, 0)),
      })

      const lines = doc.split('\n')
      expect(lines[0]).toBe('anyone-hosts-version 1')
      expect(lines[1]).toBe('anyone-hosts-status signed')
      expect(lines[2]).toBe('published 2026-04-22 00:00:00')
      expect(lines[3]).toBe('valid-until 2026-04-23 00:00:00')
      expect(doc).toContain(
        `anyone-hosts-signature ${addr}\n-----BEGIN SIGNATURE-----\n`,
      )
      expect(doc.endsWith('-----END SIGNATURE-----\n')).toBe(true)
    })

    it('mapping digest matches sha256 of sorted-joined mapping lines', () => {
      const { base64 } = makeTorSecretKeyBase64()
      const key = parseTorSecretKey(base64)
      const addr = deriveSignerAddress(key)
      const doc = buildSignedAnyoneHostsDocument({
        mappings,
        signerAddress: addr,
        key,
        published: new Date(0),
        validUntil: new Date(24 * 3600 * 1000),
      })

      const digestLine = doc
        .split('\n')
        .find((l) => l.startsWith('anyone-hosts-digest '))
      expect(digestLine).toBeDefined()
      const hex = digestLine!.split(' ')[2]

      const sorted = mappings
        .map((m) => `${m.domain} ${m.hsAddress}`)
        .sort()
        .join('\n')
      const expected = crypto
        .createHash('sha256')
        .update(sorted, 'utf8')
        .digest('hex')
      expect(hex).toBe(expected)
    })

    it('embedded signature verifies over the signed region with the prefix', () => {
      const { base64 } = makeTorSecretKeyBase64()
      const key = parseTorSecretKey(base64)
      const addr = deriveSignerAddress(key)
      const doc = buildSignedAnyoneHostsDocument({
        mappings,
        signerAddress: addr,
        key,
        published: new Date(0),
        validUntil: new Date(24 * 3600 * 1000),
      })

      const sigIdx = doc.indexOf('-----BEGIN SIGNATURE-----')
      const signedRegion = doc.slice(0, sigIdx)
      expect(signedRegion.endsWith(`anyone-hosts-signature ${addr}\n`)).toBe(true)

      const pemBody = doc
        .slice(sigIdx)
        .split('\n')
        .slice(1, -2)
        .join('')
      const signature = Buffer.from(pemBody, 'base64')
      const digest = crypto
        .createHash('sha256')
        .update(Buffer.from(signedRegion, 'utf8'))
        .digest()
      const message = Buffer.concat([_internals.SIGNATURE_PREFIX, digest])
      const pub = hsUtils.hiddenServicePublicKeyFromAddress(addr)
      expect(ed25519.verify(signature, message, pub)).toBe(true)
    })
  })
})
