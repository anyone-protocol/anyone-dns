import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { AppController } from './app.controller'
import { AppService } from './app.service'
import { UnsModule } from './uns/uns.module'
import { UnsService } from './uns/uns.service'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    UnsModule
  ],
  controllers: [ AppController ],
  providers: [ AppService, UnsService ],
})
export class AppModule {}
