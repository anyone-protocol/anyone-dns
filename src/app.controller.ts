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
      return await this.unsService.getHostsList()
    } catch (error) {
      throw new Error(
        `Failed get hosts list: ${error.message}`
      )
    }
  }
}
