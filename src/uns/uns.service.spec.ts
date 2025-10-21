import { ConsoleLogger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { Test, TestingModule } from '@nestjs/testing'

import { UnsService } from './uns.service'

describe('UnsService', () => {
  let unsService: UnsService

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule(
      {
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          ScheduleModule.forRoot()
        ],
        controllers: [],
        providers: [ UnsService ]
      }
    )
    .setLogger(
      new ConsoleLogger({
        logLevels: [
          // 'error',
          // 'warn',
          // 'log',
          // 'debug',
          // 'verbose'
        ]
      })
    )
    .compile()

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

  describe('caching .anyone domain list', () => {
    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('returns empty array when no cache is available', async () => {
      const result = await unsService.getAnyoneDomainsList()
      expect(result).toEqual([])
    })

    it('returns cached domain list when cache is populated', async () => {
      const mockDomains = [
        { name: 'example.anyone' },
        { name: 'test.anyone' },
        { name: 'demo.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Manually populate cache via refreshCache
      await unsService.refreshCache()

      const result = await unsService.getAnyoneDomainsList()
      expect(result).toEqual(['example.anyone', 'test.anyone', 'demo.anyone'])
    })

    it('maintains cached data across multiple calls', async () => {
      const mockDomains = [
        { name: 'cached.anyone' },
        { name: 'test.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Populate cache
      await unsService.refreshCache()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Multiple calls should return same cached data without additional API calls
      const result1 = await unsService.getAnyoneDomainsList()
      const result2 = await unsService.getAnyoneDomainsList()
      const result3 = await unsService.getAnyoneDomainsList()

      expect(global.fetch).toHaveBeenCalledTimes(1) // Still only 1 call
      expect(result1).toEqual(mockDomains.map(d => d.name))
      expect(result2).toEqual(mockDomains.map(d => d.name))
      expect(result3).toEqual(mockDomains.map(d => d.name))
    })
  })

  describe('cache refresh functionality', () => {
    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('refreshes cache and fetches domains from API', async () => {
      const mockDomains = [
        { name: 'example.anyone' },
        { name: 'test.anyone' },
        { name: 'demo.anyone' }
      ]

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Mock domain resolution
      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValue('test.anyone 6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone')

      await unsService.refreshCache()

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/anyone-domains')
      )

      // Verify cache is populated
      const domains = await unsService.getAnyoneDomainsList()
      expect(domains).toEqual(['example.anyone', 'test.anyone', 'demo.anyone'])
    })

    it('handles HTTP errors during cache refresh', async () => {
      const mockResponse = {
        ok: false,
        status: 500
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      // Should not throw, but log error and keep existing cache
      await expect(unsService.refreshCache()).resolves.not.toThrow()
      
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('handles network errors during cache refresh', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      // Should not throw, but log error and keep existing cache
      await expect(unsService.refreshCache()).resolves.not.toThrow()
      
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('handles empty domain list from API', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue([])
      }

      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)

      await unsService.refreshCache()

      expect(global.fetch).toHaveBeenCalledTimes(1)
      
      // Should cache empty array
      const domains = await unsService.getAnyoneDomainsList()
      expect(domains).toEqual([])
      
      const mappings = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(mappings).toEqual([])
    })
  })

  describe('caching domain mappings', () => {
    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('returns empty array when no cache is available', async () => {
      const result = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      expect(result).toEqual([])
    })

    it('returns cached domain mappings when cache is populated', async () => {
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

      // Populate cache via refreshCache
      await unsService.refreshCache()

      const result = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()

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
        { name: 'norecord.anyone' },
        { name: 'hasrecord.anyone' }
      ]
      
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockDomains)
      }
      
      ;(global.fetch as jest.Mock).mockResolvedValue(mockResponse)
      
      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(null) // No record
        .mockResolvedValueOnce('6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone')

      await unsService.refreshCache()
      const result = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        name: 'norecord.anyone',
        hiddenServiceAddress: null
      })
      expect(result[1]).toEqual({
        name: 'hasrecord.anyone',
        hiddenServiceAddress: '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone'
      })
    })

    it('maintains cached mappings across multiple calls', async () => {
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
        'cached1.anyone abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone',
        'cached2.anyone 987fed654cba32109876543210987654321098765432109876543210.anyone'
      ]

      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResolveResults[0])
        .mockResolvedValueOnce(mockResolveResults[1])

      // Populate cache
      await unsService.refreshCache()
      expect(unsService.resolveDomainToHiddenServiceAddress).toHaveBeenCalledTimes(2)

      // Multiple calls should return same cached data without additional resolution calls
      const result1 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      const result2 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()
      const result3 = await unsService.getAnyoneDomainsWithHiddenServiceAddresses()

      expect(unsService.resolveDomainToHiddenServiceAddress).toHaveBeenCalledTimes(2) // Still only 2 calls
      expect(result1).toEqual(result2)
      expect(result2).toEqual(result3)
      expect(result1).toHaveLength(2)
    })
  })
})
