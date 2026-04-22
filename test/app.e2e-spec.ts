import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { getRepositoryToken } from '@nestjs/typeorm'
import * as request from 'supertest'
import { App } from 'supertest/types'

import { AppController } from './../src/app.controller'
import { AppService } from './../src/app.service'
import { HiddenServiceRecordEntity } from './../src/db/entities/hidden-service-record.entity'
import { UnsService } from './../src/uns/uns.service'

describe('AppController (e2e)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    // Build the module without AppModule to avoid requiring a live Postgres
    // connection. Mirrors the providers AppModule wires up but injects a
    // stubbed repository for HiddenServiceRecordEntity.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ScheduleModule.forRoot(),
      ],
      controllers: [AppController],
      providers: [
        AppService,
        UnsService,
        {
          provide: getRepositoryToken(HiddenServiceRecordEntity),
          useValue: { find: async () => [] },
        },
      ],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  it('/ (GET)', () => {
    const version = process.env.VERSION || 'unknown'
    const hostname = process.env.HIDDEN_SERVICE_HOSTNAME || 'unknown'
    const publicKeyBase64 = process.env.HIDDEN_SERVICE_PUBLIC_KEY
    const publicKey = publicKeyBase64
      ? Buffer.from(publicKeyBase64, 'base64').toString('hex').toUpperCase()
      : 'unknown'
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect(
        `Anyone DNS Service version ${version}\n` +
          `Hostname: ${hostname}\n` +
          `Public Key: ${publicKey}`,
      )
  })

  it('/tld/anyone (GET)', () => {
    return request(app.getHttpServer())
      .get('/tld/anyone')
      .expect(200)
      .expect((res) => {
        expect(typeof res.text).toBe('string')
      })
  })

  afterAll(async () => {
    await app.close()
  })
})
