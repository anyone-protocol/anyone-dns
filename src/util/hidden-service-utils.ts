import * as base32 from 'hi-base32'
import * as crypto from 'crypto'

import { DomainResolutionError } from '../uns/errors/domain-resolution.error'
import { DomainResolutionResult } from '../uns/schema/domain-resolution-result'

const V3_VERSION_BYTE = 0x03

function computeHsChecksum(pubKey: Buffer, tld: string): Buffer {
  const input = Buffer.concat([
    Buffer.from(`.${tld} checksum`, 'utf8'),
    pubKey,
    Buffer.from([V3_VERSION_BYTE]),
  ])
  return crypto.createHash('sha3-256').update(input).digest().subarray(0, 2)
}

export const hsUtils = {
  isValidHiddenServiceAddress(address: string): boolean {
    if (!address || address.trim() === '') {
      return false
    }

    const addressParts = address.split('.')
    const addressTld = addressParts.pop() || ''
    const addressHash = addressParts.pop() || ''

    if (addressHash.length !== 56) {
      return false
    }

    try {
      const decoded = Buffer.from(
        base32.decode.asBytes(addressHash.toUpperCase()),
      )
      if (decoded.length !== 35) {
        return false
      }
      const pubkey = decoded.subarray(0, 32)
      const checksum = decoded.subarray(32, 34)
      const versionByte = decoded[34]

      if (versionByte !== V3_VERSION_BYTE) {
        return false
      }

      const expectedChecksum = computeHsChecksum(pubkey, addressTld)
      return checksum.equals(expectedChecksum)
    } catch (e: any) {
      return false
    }
  },

  hiddenServiceAddressFromPublicKey(
    pubKey: Buffer,
    tld: string = 'anyone',
  ): string {
    if (pubKey.length !== 32) {
      throw new Error('Ed25519 public key must be 32 bytes')
    }
    const checksum = computeHsChecksum(pubKey, tld)
    const full = Buffer.concat([
      pubKey,
      checksum,
      Buffer.from([V3_VERSION_BYTE]),
    ])
    const label = base32.encode(full).replace(/=+$/, '').toLowerCase()
    return `${label}.${tld}`
  },

  hiddenServicePublicKeyFromAddress(address: string): Buffer {
    const parts = address.split('.')
    parts.pop()
    const label = parts.pop() || ''
    const decoded = Buffer.from(base32.decode.asBytes(label.toUpperCase()))
    return Buffer.from(decoded.subarray(0, 32))
  },

  formatHostsFileEntry(domain: string, hiddenServiceAddress: string) {
    return `${domain} ${hiddenServiceAddress}\n`
  },

  mapDomainResolutionToResult(
    domain: string,
    result: string | DomainResolutionError
  ): DomainResolutionResult {
    if (result instanceof DomainResolutionError) {
      return {
        result: 'error',
        domain: domain,
        error: result
      }
    }
    return {
      result: 'success',
      domain: domain,
      hiddenServiceAddress: result
    }
  }
}
