import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import * as fs from 'fs'
import { IsNull, Not, Repository } from 'typeorm'

import { HiddenServiceRecordEntity } from '../db/entities/hidden-service-record.entity'
import { hsUtils } from '../util/hidden-service-utils'
import { DomainResolutionError } from './errors/domain-resolution.error'
import { HiddenServiceAddressInvalidError } from './errors/hidden-service-address-invalid.error'
import { UnsupportedHiddenServiceTldError } from './errors/unsupported-hidden-service-tld.error'
import { UnsupportedUnsTldError } from './errors/unsupported-uns-tld.error'
import { DomainResolutionResult } from './schema/domain-resolution-result'

@Injectable()
export class UnsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UnsService.name)
  private readonly SUPPORTED_TLDS = ['anyone']
  private readonly cacheTtlMs: number
  private readonly defaultMappings: Record<string, string>
  private mappingsCache: { [key: string]: DomainResolutionResult } = {}
  private hostsListCache: string = ''

  constructor(
    private readonly config: ConfigService<{
      ANYONE_DOMAINS_CACHE_TTL_MS: string
      DEFAULT_MAPPINGS_PATH: string
    }>,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(HiddenServiceRecordEntity)
    private readonly hsRecords: Repository<HiddenServiceRecordEntity>,
  ) {
    const cacheTtlConfig = this.config.get<string>(
      'ANYONE_DOMAINS_CACHE_TTL_MS',
      '300000',
      { infer: true },
    )
    this.cacheTtlMs = parseInt(cacheTtlConfig, 10)
    if (isNaN(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new Error(
        'ANYONE_DOMAINS_CACHE_TTL_MS must be a valid positive number!',
      )
    }

    const defaultMappingsPath = this.config.get<string>(
      'DEFAULT_MAPPINGS_PATH',
      '',
      { infer: true },
    )
    this.defaultMappings = {}
    if (defaultMappingsPath) {
      try {
        const content = fs.readFileSync(defaultMappingsPath, 'utf-8')
        const lines = content.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          const [domain, address] = line.trim().split(/\s+/)
          if (domain && address) {
            this.defaultMappings[domain] = address
          } else {
            this.logger.warn(`Skipping invalid default mappings line: ${line}`)
          }
        }
        if (Object.keys(this.defaultMappings).length > 0) {
          this.logger.log(
            `Loaded ${Object.keys(this.defaultMappings).length} default` +
              ` mappings from ${defaultMappingsPath}`,
          )
        }
      } catch (e: any) {
        this.logger.warn(
          `Failed to read default mappings from` +
            ` ${defaultMappingsPath}: ${e.message}`,
        )
      }
    }
  }

  async onApplicationBootstrap() {
    this.applyDefaultMappings()
    await this.enqueueCacheRefresh()
  }

  private async enqueueCacheRefresh() {
    await this.refreshCache()

    try {
      this.schedulerRegistry.getTimeout('enqueueCacheRefresh') &&
        this.schedulerRegistry.deleteTimeout('enqueueCacheRefresh')
    } catch (e: any) {}

    this.schedulerRegistry.addTimeout(
      'enqueueCacheRefresh',
      setTimeout(this.enqueueCacheRefresh.bind(this), this.cacheTtlMs),
    )
    this.logger.log(
      `Scheduled next cache refresh with TTL ${this.cacheTtlMs} ms`,
    )
  }

  async refreshCache() {
    this.logger.log('Refreshing anyone domains cache')

    try {
      this.logger.debug('Loading hidden service records from database')
      const rows = await this.hsRecords.find({
        where: { name: Not(IsNull()), value: Not(IsNull()) },
        select: ['name', 'value'],
      })

      this.logger.debug(
        `Loaded ${rows.length} hidden service records from database`,
      )

      const nextMappings: { [key: string]: DomainResolutionResult } = {}
      let successfulCount = 0

      for (const row of rows) {
        // `name` / `value` are non-null by the WHERE clause above.
        const domain = row.name!
        const hsAddress = row.value!
        const resolved = this.validateRecord(domain, hsAddress)
        const result = hsUtils.mapDomainResolutionToResult(domain, resolved)
        nextMappings[domain] = result
        if (result.result === 'success') {
          successfulCount += 1
        }
      }

      this.mappingsCache = nextMappings
      this.hostsListCache = Object.values(nextMappings)
        .filter((res) => res.result === 'success')
        .map((m) => `${m.domain} ${m.hiddenServiceAddress}`)
        .join('\n')
        .trim()

      this.logger.log(
        `Successfully refreshed cache for [${rows.length}] records with ` +
          `[${successfulCount}] valid hidden service addresses`,
      )
    } catch (error: any) {
      this.logger.error('Error refreshing cache:', error?.stack ?? error)
    } finally {
      this.applyDefaultMappings()
    }
  }

  private validateRecord(
    domain: string,
    hsAddress: string,
  ): string | DomainResolutionError {
    const tld = domain.split('.').pop() || ''
    if (!this.SUPPORTED_TLDS.includes(tld)) {
      const error = new UnsupportedUnsTldError(tld, domain)
      this.logger.warn(error.message)
      return error
    }

    const hsTld = hsAddress.split('.').pop() || ''
    if (!this.SUPPORTED_TLDS.includes(hsTld)) {
      const error = new UnsupportedHiddenServiceTldError(
        hsTld,
        hsAddress,
        domain,
      )
      this.logger.warn(error.message)
      return error
    }

    if (hsUtils.isValidHiddenServiceAddress(hsAddress) === false) {
      const error = new HiddenServiceAddressInvalidError(hsAddress, domain)
      this.logger.warn(error.message)
      return error
    }

    return hsAddress
  }

  private applyDefaultMappings() {
    const defaultDomains = Object.keys(this.defaultMappings)
    if (defaultDomains.length === 0) {
      return
    }

    for (const [domain, hiddenServiceAddress] of Object.entries(
      this.defaultMappings,
    )) {
      this.mappingsCache[domain] = {
        result: 'success',
        domain,
        hiddenServiceAddress,
      }
    }

    // Regenerate hostsListCache from all successful mappings
    this.hostsListCache = Object.values(this.mappingsCache)
      .filter((res) => res.result === 'success')
      .map((mapping) => `${mapping.domain} ${mapping.hiddenServiceAddress}`)
      .join('\n')
      .trim()

    this.logger.log(`Applied ${defaultDomains.length} default mappings`)
  }

  async getHostsList(): Promise<string> {
    return this.hostsListCache
  }

  async getDomain(domain: string): Promise<DomainResolutionResult | null> {
    if (this.mappingsCache[domain]) {
      return this.mappingsCache[domain]
    }

    const defaultHs = this.defaultMappings[domain]
    if (defaultHs) {
      return {
        result: 'success',
        domain,
        hiddenServiceAddress: defaultHs,
      }
    }

    return null
  }
}
