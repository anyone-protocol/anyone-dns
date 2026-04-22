import { ConsoleLogger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Test, TestingModule } from '@nestjs/testing'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { HiddenServiceRecordEntity } from '../db/entities/hidden-service-record.entity'
import { UnsService } from './uns.service'

type Row = Partial<HiddenServiceRecordEntity>

const VALID_HS_1 =
  'gadmrvl67444hgzrhsnhzknxaimfnzp6az3wq4d2j7hrf7th34elrrad.anyone'
const VALID_HS_2 =
  'kjlkfrfxquevo64qv4gssl3t52tiuay2muj7u4rox4llxboj4c4ypcid.anyone'
const VALID_HS_3 =
  'jntoblprbfgcpldwuzobmzsdjs6mtwtr3dtn3mtgdjnk6j7x2frcabad.anyone'

function buildRepoMock(rows: Row[] = []) {
  return {
    find: jest.fn().mockResolvedValue(rows),
  }
}

async function buildService(repoMock: {
  find: jest.Mock
}): Promise<UnsService> {
  const app: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      ScheduleModule.forRoot(),
    ],
    controllers: [],
    providers: [
      UnsService,
      {
        provide: getRepositoryToken(HiddenServiceRecordEntity),
        useValue: repoMock,
      },
    ],
  })
    .setLogger(new ConsoleLogger({ logLevels: [] }))
    .compile()

  return app.get<UnsService>(UnsService)
}

describe('UnsService', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env.DEFAULT_MAPPINGS_PATH
  })

  describe('refreshCache', () => {
    it('loads records and populates caches with valid entries', async () => {
      const repoMock = buildRepoMock([
        { name: 'dns-live-1.anyone.anyone', value: VALID_HS_1 },
        { name: 'dns-live-2.anyone.anyone', value: VALID_HS_2 },
      ])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      expect(repoMock.find).toHaveBeenCalledTimes(1)
      const hosts = await svc.getHostsList()
      expect(hosts).toContain(`dns-live-1.anyone.anyone ${VALID_HS_1}`)
      expect(hosts).toContain(`dns-live-2.anyone.anyone ${VALID_HS_2}`)

      const domain = await svc.getDomain('dns-live-1.anyone.anyone')
      expect(domain).toEqual({
        result: 'success',
        domain: 'dns-live-1.anyone.anyone',
        hiddenServiceAddress: VALID_HS_1,
      })
    })

    it('filters out null name / value at query level', async () => {
      // The service is expected to rely on the SQL WHERE to exclude nulls;
      // we assert the query is shaped that way and simply return non-null rows.
      const repoMock = buildRepoMock([
        { name: 'dns-live-3.anyone.anyone', value: VALID_HS_3 },
      ])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      const callArg = repoMock.find.mock.calls[0][0]
      expect(callArg.where.name).toBeDefined()
      expect(callArg.where.value).toBeDefined()

      const hosts = await svc.getHostsList()
      expect(hosts).toBe(`dns-live-3.anyone.anyone ${VALID_HS_3}`)
    })

    it('handles empty result set', async () => {
      const repoMock = buildRepoMock([])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      expect(await svc.getHostsList()).toBe('')
      expect(await svc.getDomain('anything.anyone')).toBeNull()
    })

    it('handles DB errors gracefully without throwing', async () => {
      const repoMock = {
        find: jest.fn().mockRejectedValue(new Error('DB down')),
      }
      const svc = await buildService(repoMock)

      await expect(svc.refreshCache()).resolves.not.toThrow()
      expect(await svc.getHostsList()).toBe('')
    })

    it('marks unsupported UNS TLDs as error results', async () => {
      const repoMock = buildRepoMock([{ name: 'bad.com', value: VALID_HS_1 }])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      const result = await svc.getDomain('bad.com')
      expect(result?.result).toBe('error')
      const hosts = await svc.getHostsList()
      expect(hosts).toBe('')
    })

    it('marks invalid hidden service addresses as error results', async () => {
      const repoMock = buildRepoMock([
        {
          name: 'invalid.anyone',
          // valid base32 length + tld but bad checksum
          value:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.anyone',
        },
      ])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      const result = await svc.getDomain('invalid.anyone')
      expect(result?.result).toBe('error')
    })

    it('marks unsupported hidden-service TLDs as error results', async () => {
      const repoMock = buildRepoMock([
        {
          name: 'mismatch.anyone',
          value:
            'gadmrvl67444hgzrhsnhzknxaimfnzp6az3wq4d2j7hrf7th34elrrad.onion',
        },
      ])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      const result = await svc.getDomain('mismatch.anyone')
      expect(result?.result).toBe('error')
    })
  })

  describe('default mappings', () => {
    const defaultMappingsHosts = [
      `dns-live-1.anyone.anyone ${VALID_HS_1}`,
      `dns-live-2.anyone.anyone ${VALID_HS_2}`,
    ].join('\n')
    let tmpFile: string

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `default-mappings-${Date.now()}`)
      fs.writeFileSync(tmpFile, defaultMappingsHosts)
      process.env.DEFAULT_MAPPINGS_PATH = tmpFile
    })

    afterEach(() => {
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    })

    it('merges defaults on top of DB results', async () => {
      const repoMock = buildRepoMock([
        { name: 'extra.anyone', value: VALID_HS_3 },
      ])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      const hosts = await svc.getHostsList()
      expect(hosts).toContain(`dns-live-1.anyone.anyone ${VALID_HS_1}`)
      expect(hosts).toContain(`dns-live-2.anyone.anyone ${VALID_HS_2}`)
      expect(hosts).toContain(`extra.anyone ${VALID_HS_3}`)
    })

    it('defaults override conflicting DB entries', async () => {
      const repoMock = buildRepoMock([
        { name: 'dns-live-1.anyone.anyone', value: VALID_HS_3 },
      ])
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      const result = await svc.getDomain('dns-live-1.anyone.anyone')
      expect(result).toEqual({
        result: 'success',
        domain: 'dns-live-1.anyone.anyone',
        hiddenServiceAddress: VALID_HS_1,
      })
    })

    it('defaults survive DB errors', async () => {
      const repoMock = {
        find: jest.fn().mockRejectedValue(new Error('DB down')),
      }
      const svc = await buildService(repoMock)

      await svc.refreshCache()

      const hosts = await svc.getHostsList()
      expect(hosts).toContain(`dns-live-1.anyone.anyone ${VALID_HS_1}`)
    })
  })

  describe('default mappings edge cases', () => {
    it('starts without error when DEFAULT_MAPPINGS_PATH is not set', async () => {
      delete process.env.DEFAULT_MAPPINGS_PATH
      const svc = await buildService(buildRepoMock())
      expect(svc).toBeDefined()
    })

    it('starts without error when DEFAULT_MAPPINGS_PATH points to missing file', async () => {
      process.env.DEFAULT_MAPPINGS_PATH = '/nonexistent/path/default-mappings'
      const svc = await buildService(buildRepoMock())
      expect(svc).toBeDefined()
    })
  })
})
