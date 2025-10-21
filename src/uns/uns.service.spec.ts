import { ConfigModule } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { UnsService } from './uns.service'

describe('UnsService', () => {
  let unsService: UnsService

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [],
      providers: [UnsService],
    }).compile()

    unsService = app.get<UnsService>(UnsService)
  })

  describe('resolving .anyone domains', () => {
    let mockContract: any

    beforeEach(() => {
      // Mock the UNS contract
      mockContract = {
        getMany: jest.fn()
      }
      
      // Replace the contract instance with our mock
      ;(unsService as any).unsProxyReaderContract = mockContract
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('resolves anyone domain to hidden service address', async () => {
      const domain = 'test.anyone'
      const expectedHiddenServiceAddress = '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone'

      // Mock the contract response
      mockContract.getMany.mockResolvedValue([expectedHiddenServiceAddress])

      const result = await unsService.resolveDomainToHiddenServiceAddress(domain)

      expect(mockContract.getMany).toHaveBeenCalledTimes(1)
      expect(result).toEqual(expectedHiddenServiceAddress)
    })

    it('resolves to null if domain has no hidden service record', async () => {
      const domain = 'nonexistent.anyone'

      // Mock contract to respond with empty string
      mockContract.getMany.mockResolvedValue([''])

      const result = await unsService.resolveDomainToHiddenServiceAddress(domain)

      expect(result).toBeNull()
    })

    it('resolves to null if contract throws other errors', async () => {
      const domain = 'error.anyone'

      // Mock contract to throw a different error
      mockContract.getMany.mockRejectedValue(new Error('Network error'))

      const result = await unsService.resolveDomainToHiddenServiceAddress(domain)

      expect(result).toBeNull()
    })

    it('resolves multiple domains in bulk', async () => {
      const domains = ['test1.anyone', 'test2.anyone', 'test3.anyone']

      // Mock individual resolution calls
      const mockResults = [
        'test1.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone',
        'test2.anyone 987fed654cba32109876543210987654321098765432109876543210.anyone',
        null // Third domain has no record
      ]

      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1])
        .mockResolvedValueOnce(mockResults[2])

      const results = await unsService.tryResolveAll(domains)

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({
        name: domains[0],
        hiddenServiceAddress: mockResults[0]
      })
      expect(results[1]).toEqual({
        name: domains[1],
        hiddenServiceAddress: mockResults[1]
      })
      expect(results[2]).toEqual({
        name: domains[2],
        hiddenServiceAddress: null
      })
    })

    it('handles batch processing with custom parameters', async () => {
      const domains = ['batch1.anyone', 'batch2.anyone']
      const customBatchSize = 1
      const customDelay = 100

      const mockResults = [
        'test1.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone',
        'test2.anyone 987fed654cba32109876543210987654321098765432109876543210.anyone'
      ]

      // Mock resolution results
      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1])
      // Mock setTimeout to verify delay is called
      const mockSetTimeout = jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
        expect(delay).toBe(customDelay)
        ;(fn as Function)()
        return {} as any
      })

      await unsService.tryResolveAll(domains, customBatchSize, customDelay)

      expect(mockSetTimeout).toHaveBeenCalledTimes(1) // Called once for delay between batches
      expect(unsService.resolveDomainToHiddenServiceAddress).toHaveBeenCalledTimes(2)
    })
  })

  describe('fetching & caching .anyone domain list from anyone api', () => {
    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('fetches .anyone domain list from api-service', async () => {
      const mockDomains = [
        { name: 'example.anyone', },
        { name: 'test.anyone', },
        { name: 'demo.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      const result = await unsService.getAnyoneDomainsList()

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/anyone-domains')
      )
      expect(result).toEqual(['example.anyone', 'test.anyone', 'demo.anyone'])
    })

    it('handles HTTP errors when fetching .anyone domain list', async () => {
      const mockResponse = {
        ok: false,
        status: 500
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      await expect(unsService.getAnyoneDomainsList())
        .rejects.toThrow('Anyone API error, status: 500')
      
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('handles network errors when fetching .anyone domain list', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      await expect(unsService.getAnyoneDomainsList()).rejects.toThrow('Network error')
      
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('uses cached .anyone domain list for subsequent calls', async () => {
      const mockDomains = [
        { name: 'cached.anyone' },
        { name: 'test.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // First call should fetch from API
      const result1 = await unsService.getAnyoneDomainsList()
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(result1).toEqual(mockDomains.map(d => d.name))

      // Second call should use cache (no additional fetch)
      const result2 = await unsService.getAnyoneDomainsList()
      expect(global.fetch).toHaveBeenCalledTimes(1) // Still only 1 call
      expect(result2).toEqual(mockDomains.map(d => d.name))

      // Third call should also use cache
      const result3 = await unsService.getAnyoneDomainsList()
      expect(global.fetch).toHaveBeenCalledTimes(1) // Still only 1 call
      expect(result3).toEqual(mockDomains.map(d => d.name))
    })

    it('refreshes cached .anyone domain list after cache expiration', async () => {
      // Mock Date.now to control cache expiration
      const originalDateNow = Date.now
      let mockTime = 1000000

      jest.spyOn(Date, 'now').mockImplementation(() => mockTime)

      const mockDomains1 = [
        { name: 'first.anyone' },
        { name: 'call.anyone' }
      ]

      const mockDomains2 = [
        { name: 'second.anyone' },
        { name: 'call.anyone' }
      ]

      const mockResponse1 = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains1)
      }

      const mockResponse2 = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains2)
      }

      // First call
      ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse1)
      const result1 = await unsService.getAnyoneDomainsList()
      expect(result1).toEqual(mockDomains1.map(d => d.name))
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Advance time but not enough to expire cache (default TTL is 300000ms)
      mockTime += 100000 // Advance 100 seconds
      const result2 = await unsService.getAnyoneDomainsList()
      expect(result2).toEqual(mockDomains1.map(d => d.name)) // Same cached result
      expect(global.fetch).toHaveBeenCalledTimes(1) // No new API call

      // Advance time to expire cache
      mockTime += 250000 // Total advance: 350 seconds (> 300 second default TTL)
      
      // Second API call with different data
      ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse2)
      const result3 = await unsService.getAnyoneDomainsList()
      expect(result3).toEqual(mockDomains2.map(d => d.name)) // New data
      expect(global.fetch).toHaveBeenCalledTimes(2) // New API call made

      // Restore original Date.now
      Date.now = originalDateNow
    })
  })

  describe('building dns mappings from .anyone domains', () => {
    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('fetches domains and resolves their hidden service addresses', async () => {
      const mockDomains = [
        { name: 'test1.anyone' },
        { name: 'test2.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Mock the resolveDomainToHiddenServiceAddress method
      const mockResolveResults = [
        'test1.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone',
        'test2.anyone 987fed654cba32109876543210987654321098765432109876543210.anyone'
      ]

      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResolveResults[0])
        .mockResolvedValueOnce(mockResolveResults[1])

      const result =
        await unsService.getAnyoneDomainsWithHiddenServiceAddresses()

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        name: mockDomains[0].name,
        hiddenServiceAddress: mockResolveResults[0]
      })
      expect(result[1]).toEqual({
        name: mockDomains[1].name,
        hiddenServiceAddress: mockResolveResults[1]
      })
    })

    it('handles domains with no hidden service addresses', async () => {
      const mockDomains = [
        { name: 'norecord.anyone', hiddenServiceAddress: null },
        {
          name: 'hasrecord.anyone',
          hiddenServiceAddress: '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone'
        }
      ]
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }
      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)
      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockDomains[0].hiddenServiceAddress)
        .mockResolvedValueOnce(mockDomains[1].hiddenServiceAddress)

      const result =
      await unsService.getAnyoneDomainsWithHiddenServiceAddresses()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(mockDomains[0])
      expect(result[1]).toEqual(mockDomains[1])
    })

    it('returns empty array when no domains are found', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue([])
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      const result = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(result).toEqual([])
    })

    it('propagates errors from getAnyoneDomainsList', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('API error'))

      await expect(unsService.getAnyoneDomainsWithHiddenServiceAddresses())
        .rejects.toThrow('API error')
    })

    it('uses custom batch size and delay parameters', async () => {
      const mockDomains = [
        { name: 'batch1.anyone' },
        { name: 'batch2.anyone' },
        { name: 'batch3.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Mock tryResolveAll to verify it's called with correct parameters
      const mockTryResolveAll = jest.spyOn(unsService, 'tryResolveAll')
        .mockResolvedValue([
          { name: 'batch1.anyone', hiddenServiceAddress: 'b1.anyone' },
          { name: 'batch2.anyone', hiddenServiceAddress: 'b2.anyone' },
          { name: 'batch3.anyone', hiddenServiceAddress: 'b3.anyone' }
        ])

      const customBatchSize = 2
      const customDelay = 500

      await unsService.getAnyoneDomainsWithHiddenServiceAddresses(customBatchSize, customDelay)

      expect(mockTryResolveAll).toHaveBeenCalledWith(
        ['batch1.anyone', 'batch2.anyone', 'batch3.anyone'],
        customBatchSize,
        customDelay
      )
    })

    it('uses cached mappings for subsequent calls', async () => {
      const mockDomains = [
        { name: 'cached1.anyone' },
        { name: 'cached2.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Mock resolution results
      const mockResolveResults = [
        'anyone.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone',
        'anyone.anyone cached2hash987654321fedcba987654321fedcba987654321111111.anyone'
      ]

      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResolveResults[0])
        .mockResolvedValueOnce(mockResolveResults[1])

      // First call should perform full resolution
      const result1 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(unsService.resolveDomainToHiddenServiceAddress).toHaveBeenCalledTimes(2)
      expect(result1).toHaveLength(2)

      // Reset the mock to verify it's not called again
      jest.clearAllMocks()
      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Second call should use cached mappings (no resolution calls)
      const result2 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(unsService.resolveDomainToHiddenServiceAddress).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled() // Should not even fetch domains
      expect(result2).toEqual(result1) // Same cached result

      // Third call should also use cache
      const result3 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(unsService.resolveDomainToHiddenServiceAddress).not.toHaveBeenCalled()
      expect(result3).toEqual(result1) // Same cached result
    })

    it('refreshes cached mappings after cache expiration', async () => {
      // Mock Date.now to control cache expiration
      const originalDateNow = Date.now
      let mockTime = 1000000

      jest.spyOn(Date, 'now').mockImplementation(() => mockTime)

      const mockDomains = [{ name: 'test.anyone' }]
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // First resolution result
      const mockResult1 = 'anyone.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone'
      // Second resolution result (after cache expires)
      const mockResult2 = 'anyone.anyone second987654321fedcba987654321fedcba987654321fedcba91233.anyone'

      const mockResolve = jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResult1)
        .mockResolvedValueOnce(mockResult2)

      // First call - should resolve and cache
      const result1 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(mockResolve).toHaveBeenCalledTimes(1)
      expect(result1[0].hiddenServiceAddress).toBe(mockResult1)

      // Advance time but not enough to expire cache (default TTL is 300000ms)
      mockTime += 100000 // Advance 100 seconds
      const result2 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(mockResolve).toHaveBeenCalledTimes(1) // Still only 1 call
      expect(result2[0].hiddenServiceAddress).toBe(mockResult1) // Same cached result

      // Advance time to expire cache
      mockTime += 250000 // Total advance: 350 seconds (> 300 second default TTL)
      
      // Third call - should resolve again with fresh data
      const result3 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(mockResolve).toHaveBeenCalledTimes(2) // New resolution call
      expect(result3[0].hiddenServiceAddress).toBe(mockResult2) // New resolved data

      // Restore original Date.now
      Date.now = originalDateNow
    })

    it('returns stale cached mappings when resolution fails', async () => {
      const mockDomains = [{ name: 'test.anyone' }]
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // First successful call
      const mockResult = 'test.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone'
      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResult)
        .mockRejectedValueOnce(new Error('Resolution error'))

      const result1 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(result1[0].hiddenServiceAddress).toBe('test.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone')

      // Mock time advancement to expire cache
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 400000)

      // Second call with resolution error should return stale cache
      const result2 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(result2[0].hiddenServiceAddress).toBe('test.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone') // Stale cached data

      jest.restoreAllMocks()
    })
  })
})
