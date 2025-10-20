import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

import {
  DomainResolutionResultDto
} from './schema/domain-resolution-result.dto'
import {
  UNS_REGISTRY_PROXY_READER_ABI,
  UNS_REGISTRY_PROXY_READER_ADDRESS
} from './schema/uns-registry-proxy-reader.contract'

@Injectable()
export class UnsService {
  private readonly logger = new Logger(UnsService.name)

  private readonly SUPPORTED_TLDS = ['anyone']
  private readonly provider: ethers.JsonRpcProvider
  private readonly unsProxyReaderContract: ethers.Contract
  private readonly anyoneApiBaseUrl: string
  private readonly cacheTtlMs: number
  
  // Cache properties
  private domainsCache: string[] | null = null
  private cacheExpiry: number = 0
  private mappingsCache: DomainResolutionResultDto[] | null = null
  private mappingsCacheExpiry: number = 0

  constructor(
    private readonly config: ConfigService<{ 
      JSON_RPC_URL: string, 
      ANYONE_API_BASE_URL: string,
      ANYONE_DOMAINS_CACHE_TTL_MS: string
    }>
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

  async resolveDomainToOnionAddress(domain: string): Promise<string | null> {
    const tld = domain.split('.').pop() || ''
    if (!this.SUPPORTED_TLDS.includes(tld)) {
      this.logger.warn(`TLD .${tld} is not supported for domain: ${domain}`)
      return null
    }

    const tokenId = BigInt(ethers.namehash(domain))
    const keys = [ 'token.ANYONE.ANYONE.ANYONE.address' ]

    try {
      const [
        onionAddress
      ] = await this.unsProxyReaderContract.getMany(keys, tokenId)
      // const owner = await this.unsProxyReaderContract.ownerOf(tokenId)
      // console.log(
      //   `Got UNS Registry data for domain ${domain}: ${typeof onionAddress}`
      // )

      if (onionAddress.trim() === '') {
        this.logger.warn(`No onion record found for domain: ${domain}`)
        return null
      }

      return onionAddress
    } catch (error) {
      if (
        error.shortMessage &&
        error.shortMessage.startsWith('execution reverted (no data present')
      ) {
        this.logger.error(`No onion record found for domain: ${domain}`)
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
        batch.map(async (domain) => {
          const onionAddress = await this.resolveDomainToOnionAddress(domain)
          return {
            domain,
            onionAddress
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
    // Check if cache is still valid
    const now = Date.now()
    if (this.domainsCache && now < this.cacheExpiry) {
      this.logger.debug('Returning cached anyone domains list')
      return this.domainsCache
    }

    try {
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
      
      // Update cache
      this.domainsCache = domainNames
      this.cacheExpiry = now + this.cacheTtlMs
      
      this.logger.debug(
        `Cached ${domainNames.length} domains for ${this.cacheTtlMs}ms`
      )
      return domainNames
    } catch (error) {
      this.logger.error('Error fetching anyone domains list:', error)
      
      // If we have stale cache data and the API is down, return it as fallback
      if (this.domainsCache) {
        this.logger.warn('API error, returning stale cached data as fallback')
        return this.domainsCache
      }
      
      throw error
    }
  }

  async getAnyoneDomainsWithOnionAddresses(
    batchSize: number = 100,
    delayMs: number = 1000
  ): Promise<DomainResolutionResultDto[]> {
    // Check if mappings cache is still valid
    const now = Date.now()
    if (this.mappingsCache && now < this.mappingsCacheExpiry) {
      this.logger.debug('Returning cached anyone domains with onion addresses')
      return this.mappingsCache
    }

    try {
      this.logger.debug('Fetching anyone domains list and resolving onion addresses')
      
      // Get the list of anyone domains
      const domains = await this.getAnyoneDomainsList()
      
      if (domains.length === 0) {
        this.logger.warn('No anyone domains found')
        return []
      }
      
      this.logger.debug(`Resolving onion addresses for ${domains.length} anyone domains`)
      
      // Resolve onion addresses for all domains
      const results = await this.tryResolveAll(domains, batchSize, delayMs)
      
      // Update mappings cache
      this.mappingsCache = results
      this.mappingsCacheExpiry = now + this.cacheTtlMs
      
      this.logger.debug(
        `Successfully resolved and cached ${results.length} domain mappings for ${this.cacheTtlMs}ms`
      )
      
      return results
    } catch (error) {
      this.logger.error('Error getting anyone domains with onion addresses:', error)
      
      // If we have stale cache data and the resolution fails, return it as fallback
      if (this.mappingsCache) {
        this.logger.warn('Resolution error, returning stale cached mappings as fallback')
        return this.mappingsCache
      }
      
      throw error
    }
  }
}
