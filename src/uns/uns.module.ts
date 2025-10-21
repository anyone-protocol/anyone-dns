import { Module } from '@nestjs/common'

import { UnsService } from './uns.service'

@Module({
  imports: [],
  controllers: [],
  providers: [ UnsService],
  exports: [ UnsService ]
})
export class UnsModule {}
