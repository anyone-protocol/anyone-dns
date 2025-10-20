import { ConfigModule } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { AppController } from './app.controller'
import { AppService } from './app.service'
import { UnsService } from './uns/uns.service'

describe('AppController', () => {
  let appController: AppController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [ AppController ],
      providers: [ AppService, UnsService ],
    }).compile()

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
        { domain: 'example.anyone', onionAddress: 'aaa123def456ghi789jkl012mno345pqr678stu901vwx234yz567890.anyone' },
        { domain: 'test.anyone', onionAddress: 'bbb123def456ghi789jkl012mno345pqr678stu901vwx234yz567891.anyone' },
        { domain: 'demo.anyone', onionAddress: 'ccc123def456ghi789jkl012mno345pqr678stu901vwx234yz567892.anyone' }
      ]

      jest.spyOn(appController['unsService'], 'getAnyoneDomainsList')
        .mockResolvedValue(mockDomainMappings.map(mapping => mapping.domain))
      jest.spyOn(appController['unsService'], 'resolveDomainToOnionAddress')
        .mockImplementation(async (domain: string) => {
          const mapping = mockDomainMappings.find(m => m.domain === domain)
          return mapping ? mapping.onionAddress : null
        })

      const domains = await appController.getAnyoneDomains()
      expect(Array.isArray(domains)).toBe(true)
      expect(domains).toEqual(
        mockDomainMappings.map(
          mapping => `${mapping.domain} ${mapping.onionAddress}`
        )
      )
    })
  })
})
