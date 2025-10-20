import { Controller, Get } from '@nestjs/common'

import { AppService } from './app.service'
import { UnsService } from './uns/uns.service'

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly unsService: UnsService
  ) {}

  @Get()
  getHealthcheck(): string {
    return this.appService.getHealthcheck()
  }

  @Get('tld/anyone')
  async getAnyoneDomains(): Promise<string[]> {
    try {
      const anyoneDomainsMappings =
        await this.unsService.getAnyoneDomainsWithOnionAddresses()

      return anyoneDomainsMappings.map(
        mapping => `${mapping.domain} ${mapping.onionAddress}`
      )
    } catch (error) {
      throw new Error(`Failed to fetch anyone domains: ${error.message}`)
    }
  }
}
