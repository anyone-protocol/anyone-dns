import { ConsoleLogger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { Test, TestingModule } from '@nestjs/testing'

import { UnsService } from './uns.service'
import {
  HiddenServiceRecordNotFoundError
} from './errors/hidden-service-record-not-found.error'
import { DomainResolutionError } from './errors/domain-resolution.error'

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

      expect(result).toBeInstanceOf(HiddenServiceRecordNotFoundError)
    })

    it('resolves to null if contract throws other errors', async () => {
      const domain = 'error.anyone'

      // Mock contract to throw a different error
      mockContract.getMany.mockRejectedValue(new Error('Network error'))

      const result = await unsService.resolveDomainToHiddenServiceAddress(domain)

      expect(result).toBeInstanceOf(DomainResolutionError)
    })

    it('resolves multiple domains in bulk', async () => {
      const domains = ['test1.anyone', 'test2.anyone', 'test3.anyone']

      // Mock individual resolution calls
      const noRecordError = new HiddenServiceRecordNotFoundError(domains[2])
      const mockResults = [
        'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone',
        '987fed654cba32109876543210987654321098765432109876543210.anyone',
        noRecordError
      ]

      jest.spyOn(unsService, 'resolveDomainToHiddenServiceAddress')
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1])
        .mockResolvedValueOnce(mockResults[2])

      const results = await unsService.tryResolveAll(domains)

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({
        domain: domains[0],
        hiddenServiceAddress: mockResults[0],
        result: 'success'
      })
      expect(results[1]).toEqual({
        domain: domains[1],
        hiddenServiceAddress: mockResults[1],
        result: 'success'
      })
      expect(results[2]).toEqual({
        domain: domains[2],
        error: noRecordError,
        result: 'error'
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
      
      const hosts = await unsService.getHostsList()
      expect(hosts).toEqual('')
    })
  })
})
