import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { TypeOrmModule } from '@nestjs/typeorm'

import { AppController } from './app.controller'
import { AppService } from './app.service'
import { HiddenServiceRecordEntity } from './db/entities/hidden-service-record.entity'
import { UnsModule } from './uns/uns.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<string>('DB_PORT', '5432')),
        username: configService.get<string>('DB_USER', 'postgres'),
        password: configService.get<string>('DB_PASS', 'postgres'),
        database: configService.get<string>('DB_NAME', 'uns_indexer'),
        entities: [HiddenServiceRecordEntity],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    UnsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
