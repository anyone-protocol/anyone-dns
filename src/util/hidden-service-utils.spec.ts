import { hsUtils } from './hidden-service-utils'

const validAnyoneAddress = '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone'
const validAnonAddress   = '25njqamcweflpvkl73j4szahhihoc4xt3ktcgjnpaingr5yhkenc2hqd.anon'
const invalidAddress     = '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6dzzz.anyone'

describe('hsUtils', () => {
  describe('isValidHiddenServiceAddress', () => {
    it('should return true for valid .anyone address', () => {
      expect(hsUtils.isValidHiddenServiceAddress(validAnyoneAddress)).toBe(true)
    })

    it('should return true for valid .anon address', () => {
      expect(hsUtils.isValidHiddenServiceAddress(validAnonAddress)).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(hsUtils.isValidHiddenServiceAddress('')).toBe(false)
    })

    it('should return false for address with invalid checksum', () => {
      expect(hsUtils.isValidHiddenServiceAddress(invalidAddress)).toBe(false)
    })

    it('validates invalid base32 chars in address', () => {
      expect(
        hsUtils.isValidHiddenServiceAddress('.anyone'.padStart(63, '1'))
      ).toBe(false)
    })

    it('validates garbage strings', () => {
      expect(
        hsUtils.isValidHiddenServiceAddress('not a hidden service')
      ).toBe(false)
    })
  })
})
