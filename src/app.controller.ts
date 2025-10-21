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
  async getAnyoneDomains() {
    try {
      const anyoneDomainsMappings =
        await this.unsService.getAnyoneDomainsWithHiddenServiceAddresses()

      let output = ''
      for (const mapping of anyoneDomainsMappings) {
        output += `${mapping.domain} ${mapping.onionAddress}\n`
      }

      return output
    } catch (error) {
      throw new Error(`Failed to fetch anyone domains: ${error.message}`)
    }
  }
}
