import * as base32 from 'hi-base32'
import * as crypto from 'crypto'

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
      const addressHex = Buffer
        .from(base32.decode.asBytes(addressHash.toUpperCase()))
        .toString('hex')
      const pubkey = addressHex.slice(0, 64)
      const checksum = addressHex.slice(64, 68)
      const versionByte = addressHex.slice(68, 70)
      
      // First 2 bytes of SHA3(".${tld} checksum" || PUBKEY || VERSION)
      const expectedChecksumInput = Buffer.concat([
        Buffer.from(`.${addressTld} checksum`, 'utf8'),
        Buffer.from(pubkey, 'hex'),
        Buffer.from(versionByte, 'hex')
      ])
      const expectedChecksum = crypto.createHash('sha3-256')
        .update(expectedChecksumInput)
        .digest('hex')
        .slice(0, 4)

      return checksum === expectedChecksum
    } catch (e) { return false }
  }
}
