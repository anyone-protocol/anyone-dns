import { ConsoleLogger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { Test, TestingModule } from '@nestjs/testing'

import { AppController } from './app.controller'
import { AppService } from './app.service'
import { UnsService } from './uns/uns.service'

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
})
