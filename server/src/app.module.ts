import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { MatchModule } from './match/match.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), MatchModule],
  controllers: [HealthController],
})
export class AppModule {}
