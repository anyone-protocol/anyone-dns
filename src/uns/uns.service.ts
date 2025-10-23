import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { ethers } from 'ethers'

import {
  DomainResolutionResult
} from './schema/domain-resolution-result'
import {
  UNS_REGISTRY_PROXY_READER_ABI,
  UNS_REGISTRY_PROXY_READER_ADDRESS
} from './schema/uns-registry-proxy-reader.contract'
import { hsUtils } from '../util/hidden-service-utils'
import { DomainResolutionError } from './errors/domain-resolution.error'
import { UnsupportedUnsTldError } from './errors/unsupported-uns-tld.error'
import {
  HiddenServiceRecordNotFoundError
} from './errors/hidden-service-record-not-found.error'
import {
  UnsupportedHiddenServiceTldError
} from './errors/unsupported-hidden-service-tld.error'
import {
  HiddenServiceAddressInvalidError
} from './errors/hidden-service-address-invalid.error'

@Injectable()
export class UnsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UnsService.name)
  private readonly SUPPORTED_TLDS = ['anyone']
  private readonly UNS_STORAGE_KEYS = [ 'token.ANYONE.ANYONE.ANYONE.address' ]
  private readonly provider: ethers.JsonRpcProvider
  private readonly unsProxyReaderContract: ethers.Contract
  private readonly anyoneApiBaseUrl: string
  private readonly cacheTtlMs: number
  private domainsCache: string[] | null = null
  private mappingsCache: { [key: string]: DomainResolutionResult } = {}
  private hostsListCache: string = ''

  constructor(
    private readonly config: ConfigService<{
      JSON_RPC_URL: string,
      ANYONE_API_BASE_URL: string,
      ANYONE_DOMAINS_CACHE_TTL_MS: string
    }>,
    private readonly schedulerRegistry: SchedulerRegistry
  ) {
    const jsonRpcUrl = this.config.get<string>('JSON_RPC_URL', { infer: true })
    if (!jsonRpcUrl) {
      throw new Error('JSON_RPC_URL is not set!')
    }

    this.anyoneApiBaseUrl = this.config.get<string>(
      'ANYONE_API_BASE_URL',
      '',
      { infer: true }
    )
    if (!this.anyoneApiBaseUrl) {
      throw new Error('ANYONE_API_BASE_URL is not set!')
    }

    const cacheTtlConfig = this.config.get<string>(
      'ANYONE_DOMAINS_CACHE_TTL_MS',
      '300000',
      { infer: true }
    )
    this.cacheTtlMs = parseInt(cacheTtlConfig, 10)
    if (isNaN(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new Error(
        'ANYONE_DOMAINS_CACHE_TTL_MS must be a valid positive number!'
      )
    }

    this.provider = new ethers.JsonRpcProvider(jsonRpcUrl)
    this.unsProxyReaderContract = new ethers.Contract(
      UNS_REGISTRY_PROXY_READER_ADDRESS,
      UNS_REGISTRY_PROXY_READER_ABI,
      this.provider
    )
  }

  async onApplicationBootstrap() {
    await this.enqueueCacheRefresh()
  }

  private async enqueueCacheRefresh() {
    await this.refreshCache()

    try {
      this.schedulerRegistry.getTimeout('enqueueCacheRefresh') &&
        this.schedulerRegistry.deleteTimeout('enqueueCacheRefresh')
    } catch (e) {}

    this.schedulerRegistry.addTimeout(
      'enqueueCacheRefresh',
      setTimeout(
        this.enqueueCacheRefresh.bind(this),
        this.cacheTtlMs
      )
    )
    this.logger.log(
      `Scheduled next cache refresh with TTL ${this.cacheTtlMs} ms`
    )
  }

  async refreshCache() {
    this.logger.log('Refreshing anyone domains cache')
    
    try {
      // Fetch fresh domains list
      this.logger.debug('Fetching fresh anyone domains list from API')
      const response = await fetch(`${this.anyoneApiBaseUrl}/anyone-domains`)
      if (!response.ok) {
        throw new Error(`Anyone API error, status: ${response.status}`)
      }
      const domains = await response.json()

      // Extract the "name" property from each domain object
      const domainNames = domains
        .map((domain: any) => domain.name)
        .filter(Boolean)

      // Update domains cache
      this.domainsCache = domainNames
      this.logger.debug(`Cached ${domainNames.length} domains`)

      if (domainNames.length === 0) {
        this.logger.warn('No anyone domains found')
        this.mappingsCache = {}
        this.hostsListCache = ''
        return
      }

      this.logger.debug(
        `Resolving hidden service addresses for `
          + `${domainNames.length} anyone domains`
      )

      // Resolve hidden service addresses for all domains
      const results = await this.tryResolveAll(domainNames)
      const successfulResults = results.filter(res => res.result === 'success')

      // Update mappings cache
      for (const res of results) {
        this.mappingsCache[res.domain] = res
      }
      this.hostsListCache = successfulResults
        .map(mapping => `${mapping.domain} ${mapping.hiddenServiceAddress}`)
        .join('\n')
        .trim()

      this.logger.log(
        `Successfully refreshed cache for [${results.length}] domains with ` +
          `[${successfulResults.length}] hidden service addresses`
      )
    } catch (error) {
      this.logger.error('Error refreshing cache:', error)
      // Keep existing cache data on error
    }
  }

  async resolveDomainToHiddenServiceAddress(
    domain: string
  ): Promise<string | DomainResolutionError> {
    const tld = domain.split('.').pop() || ''
    if (!this.SUPPORTED_TLDS.includes(tld)) {
      const error = new UnsupportedUnsTldError(tld, domain)
      this.logger.warn(error.message)
      return error
    }

    try {
      const tokenId = BigInt(ethers.namehash(domain))
      const [ hsAddress ] = await this.unsProxyReaderContract.getMany(
        this.UNS_STORAGE_KEYS,
        tokenId
      )

      if (hsAddress.trim() === '') {
        const error = new HiddenServiceRecordNotFoundError(domain)
        this.logger.debug(error.message)
        return error
      }

      const hsTld = hsAddress.split('.').pop() || ''
      if (!this.SUPPORTED_TLDS.includes(hsTld)) {
        const error = new UnsupportedHiddenServiceTldError(
          hsTld,
          hsAddress,
          domain
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
    } catch (error) {
      const errorMessage =
        `Error fetching records from UNS Registry for domain ${domain}`
      this.logger.error(errorMessage, error.stack)
      return new DomainResolutionError(errorMessage)
    }
  }

  async tryResolveAll(
    domains: string[],
    batchSize: number = 100,
    delayMs: number = 1000
  ): Promise<DomainResolutionResult[]> {
    const results: DomainResolutionResult[] = []

    for (let i = 0; i < domains.length; i += batchSize) {
      const batch = domains.slice(i, i + batchSize)

      const batchResults = await Promise.all(
        batch.map<Promise<DomainResolutionResult>>(async (domain) => {
          const resolved = await this.resolveDomainToHiddenServiceAddress(domain)
          return hsUtils.mapDomainResolutionToResult(domain, resolved)
        })
      )

      results.push(...batchResults)

      // Add delay between batches (except for the last batch)
      if (i + batchSize < domains.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }

    return results
  }

  async getAnyoneDomainsList(): Promise<string[]> {
    // Return cached data if available
    if (this.domainsCache) {
      this.logger.debug('Returning cached anyone domains list')
      return this.domainsCache
    }

    // If no cache is available, return empty array and let the cron job populate it
    this.logger.warn('No cached domains available yet, returning empty array')
    return []
  }

  async getHostsList(): Promise<string> {
    return this.hostsListCache
  }

  async getDomain(name: string): Promise<DomainResolutionResult | null> {
    return this.mappingsCache[name] || null
  }
}
