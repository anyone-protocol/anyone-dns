import { Injectable } from '@nestjs/common'

@Injectable()
export class AppService {
  getHealthcheck(): string {
    return `Anyone DNS Service version ${process.env.VERSION || 'unknown'}`
  }
}
