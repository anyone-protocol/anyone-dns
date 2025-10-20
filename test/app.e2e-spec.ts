import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import * as request from 'supertest'
import { App } from 'supertest/types'

import { AppModule } from './../src/app.module'

describe('AppController (e2e)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect(`Anyone DNS Service version ${process.env.VERSION || 'unknown'}`)
  })

  it('/tld/anyone (GET)', () => {
    return request(app.getHttpServer())
      .get('/tld/anyone')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true)
      })
  })

  afterAll(async () => {
    await app.close()
  })
})
