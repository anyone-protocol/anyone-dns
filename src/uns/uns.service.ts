import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { ethers } from 'ethers'

import {
  DomainResolutionResultDto
} from './schema/domain-resolution-result.dto'
import {
  UNS_REGISTRY_PROXY_READER_ABI,
  UNS_REGISTRY_PROXY_READER_ADDRESS
} from './schema/uns-registry-proxy-reader.contract'
import { hsUtils } from '../util/hidden-service-utils'

@Injectable()
export class UnsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UnsService.name)
  private readonly SUPPORTED_TLDS = ['anyone']
  private readonly provider: ethers.JsonRpcProvider
  private readonly unsProxyReaderContract: ethers.Contract
  private readonly anyoneApiBaseUrl: string
  private readonly cacheTtlMs: number
  private domainsCache: string[] | null = null
  private mappingsCache: DomainResolutionResultDto[] | null = null
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
        this.mappingsCache = []
        this.hostsListCache = ''
        return
      }

      this.logger.debug(`Resolving hidden service addresses for ${domainNames.length} anyone domains`)

      // Resolve hidden service addresses for all domains
      const results = await this.tryResolveAll(domainNames)
      const resultsWithHiddenServiceAddress = results.filter(
        res => !!res.hiddenServiceAddress
      )

      // Update mappings cache
      this.mappingsCache = results
      this.hostsListCache = resultsWithHiddenServiceAddress
        .map(mapping => `${mapping.name} ${mapping.hiddenServiceAddress}`)
        .join('\n')
        .trim()

      this.logger.log(
        `Successfully refreshed cache for [${results.length}] domains with ` +
          `[${resultsWithHiddenServiceAddress.length}] hidden service addresses`
      )
    } catch (error) {
      this.logger.error('Error refreshing cache:', error)
      // Keep existing cache data on error
    }
  }

  async resolveDomainToHiddenServiceAddress(
    domain: string
  ): Promise<string | null> {
    const tld = domain.split('.').pop() || ''
    if (!this.SUPPORTED_TLDS.includes(tld)) {
      this.logger.warn(`TLD .${tld} is not supported for domain: ${domain}`)
      return null
    }

    const tokenId = BigInt(ethers.namehash(domain))
    const keys = [ 'token.ANYONE.ANYONE.ANYONE.address' ]

    try {
      const [
        hsAddress
      ] = await this.unsProxyReaderContract.getMany(keys, tokenId)

      if (hsAddress.trim() === '') {
        this.logger.debug(
          `No hidden service record found for domain: ${domain}`
        )
        return null
      }

      const hsTld = hsAddress.split('.').pop() || ''
      if (!this.SUPPORTED_TLDS.includes(hsTld)) {
        this.logger.warn(
          `Hidden Service TLD .${hsTld} is not supported for hidden service ` +
            `address: ${hsAddress} of domain: ${domain}`
        )
        return null
      }

      if (hsUtils.isValidHiddenServiceAddress(hsAddress) === false) {
        this.logger.warn(
          `Invalid hidden service address checksum for address: ` +
            `${hsAddress} of domain: ${domain}`
        )
        return null
      }

      return hsAddress
    } catch (error) {
      if (
        error.shortMessage &&
        error.shortMessage.startsWith('execution reverted (no data present')
      ) {
        this.logger.error(
          `No hidden service record found for domain: ${domain}`
        )
        return null
      }

      this.logger.error(
        'Error fetching values from UNS Registry: ',
        error.stack
      )
    }

    return null
  }

  async tryResolveAll(
    domains: string[],
    batchSize: number = 100,
    delayMs: number = 1000
  ): Promise<DomainResolutionResultDto[]> {
    const results: DomainResolutionResultDto[] = []

    for (let i = 0; i < domains.length; i += batchSize) {
      const batch = domains.slice(i, i + batchSize)

      const batchResults = await Promise.all(
        batch.map(async (name) => {
          const hiddenServiceAddress =
            await this.resolveDomainToHiddenServiceAddress(name)
          return {
            name,
            hiddenServiceAddress
          }
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

  async getAnyoneDomainsWithHiddenServiceAddresses(): Promise<DomainResolutionResultDto[]> {
    if (this.mappingsCache) {
      this.logger.debug('Returning cached anyone domains with hidden service addresses')
      return this.mappingsCache
    }

    this.logger.warn('No cached domain mappings available yet, returning empty array')
    return []
  }

  async getHostsList(): Promise<string> {
    return this.hostsListCache
  }
}
