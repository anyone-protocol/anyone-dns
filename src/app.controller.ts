import { Controller, Get, NotFoundException, Param } from '@nestjs/common'

import { AppService } from './app.service'
import { UnsService } from './uns/uns.service'
import { hsUtils } from './util/hidden-service-utils'

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
      return await this.unsService.getHostsList()
    } catch (error) {
      throw new Error(
        `Failed get hosts list: ${error.message}`
      )
    }
  }

  @Get('tld/anyone/:name')
  async getAnyoneDomain(@Param('name') name: string) {
    const result = await this.unsService.getDomain(`${name}.anyone`)

    if (result) {
      if (result.result === 'success') {
        return hsUtils.formatHostsFileEntry(
          result.domain,
          result.hiddenServiceAddress
        ).trim()
      }

      if (result.result === 'error') {
        return result.error.message
      }
    }

    throw new NotFoundException('Domain not found')
  }
}
