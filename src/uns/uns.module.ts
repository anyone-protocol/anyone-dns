import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { HiddenServiceRecordEntity } from '../db/entities/hidden-service-record.entity'
import { UnsService } from './uns.service'

@Module({
  imports: [TypeOrmModule.forFeature([HiddenServiceRecordEntity])],
  controllers: [],
  providers: [UnsService],
  exports: [UnsService],
})
export class UnsModule {}
