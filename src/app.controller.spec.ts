import { ConsoleLogger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { Test, TestingModule } from '@nestjs/testing'

import { AppController } from './app.controller'
import { AppService } from './app.service'
import { UnsService } from './uns/uns.service'
import { DomainResolutionResult } from './uns/schema/domain-resolution-result'
import { DomainResolutionError } from './uns/errors/domain-resolution.error'

describe('AppController', () => {
  let appController: AppController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ScheduleModule.forRoot()
      ],
      controllers: [ AppController ],
      providers: [ AppService, UnsService ],
    })
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

    appController = app.get<AppController>(AppController)
  })

  describe('root', () => {
    it('should return the versioned healthcheck string', () => {
      expect(appController.getHealthcheck())
        .toBe(`Anyone DNS Service version ${process.env.VERSION || 'unknown'}`)
    })
  })

  describe('anyone-domains', () => {
    it('should fetch anyone domains mappings', async () => {
      const mockDomainMappings = [
        { domain: 'example.anyone', hiddenServiceAddress: '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone' },
        { domain: 'test.anyone', hiddenServiceAddress: '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone' },
        { domain: 'demo.anyone', hiddenServiceAddress: '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone' }
      ]
      let expectedOutput = ''
      for (const mapping of mockDomainMappings) {
        expectedOutput += `${mapping.domain} ${mapping.hiddenServiceAddress}\n`
      }
      expectedOutput = expectedOutput.trim()
      appController['unsService']['hostsListCache'] = expectedOutput

      const domains = await appController.getAnyoneDomains()
      expect(typeof domains === 'string').toBe(true)
      expect(domains).toEqual(expectedOutput)
    })
  })

  describe('getAnyoneDomain', () => {
    it('should return formatted host entry for successful domain resolution', async () => {
      const mockDomainName = 'example'
      const mockResult: DomainResolutionResult = {
        result: 'success',
        domain: 'example.anyone',
        hiddenServiceAddress: '6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone'
      }
      
      jest.spyOn(appController['unsService'], 'getDomain').mockResolvedValue(mockResult)
      
      const result = await appController.getAnyoneDomain(mockDomainName)

      expect(appController['unsService'].getDomain).toHaveBeenCalledWith(mockDomainName)
      expect(result).toBe('example.anyone 6zctvi63m7xxbd34hxn2uvnaw5ao7sec4l3k4bflzeqtve5jleh6ddyd.anyone')
    })

    it('should return error message for failed domain resolution', async () => {
      const mockDomainName = 'invalid'
      const mockError = new DomainResolutionError('Domain resolution failed')
      const mockResult: DomainResolutionResult = {
        result: 'error',
        domain: 'invalid.anyone',
        error: mockError
      }
      
      jest.spyOn(appController['unsService'], 'getDomain').mockResolvedValue(mockResult)
      
      const result = await appController.getAnyoneDomain(mockDomainName)
      
      expect(appController['unsService'].getDomain).toHaveBeenCalledWith(mockDomainName)
      expect(result).toBe('Domain resolution failed')
    })

    it('should throw NotFoundException when domain is not found (null result)', async () => {
      const mockDomainName = 'notfound'
      
      jest.spyOn(appController['unsService'], 'getDomain').mockResolvedValue(null)
      
      await expect(appController.getAnyoneDomain(mockDomainName)).rejects.toThrow('Domain not found')
      expect(appController['unsService'].getDomain).toHaveBeenCalledWith(mockDomainName)
    })

    it('should throw NotFoundException when domain is not found (undefined result)', async () => {
      const mockDomainName = 'notfound'
      
      jest.spyOn(appController['unsService'], 'getDomain').mockResolvedValue(null)
      
      await expect(appController.getAnyoneDomain(mockDomainName)).rejects.toThrow('Domain not found')
      expect(appController['unsService'].getDomain).toHaveBeenCalledWith(mockDomainName)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })
  })
})
