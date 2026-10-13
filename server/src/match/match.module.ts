import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MatchGateway } from './match.gateway';
import { InMemoryMatchRepository, MATCH_REPOSITORY, matchLimitsFromEnv } from './match.repository';
import { MatchService } from './match.service';
import { GuestAuthAdapter, WS_AUTH_ADAPTER } from './ws-auth.adapter';

/**
 * Realtime matches. Swap the seams here once their real implementations
 * exist: `MATCH_REPOSITORY` (Prisma) and `WS_AUTH_ADAPTER` (JWT cookie).
 */
@Module({
  providers: [
    MatchService,
    MatchGateway,
    {
      provide: MATCH_REPOSITORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new InMemoryMatchRepository(matchLimitsFromEnv((key) => config.get<string>(key))),
    },
    { provide: WS_AUTH_ADAPTER, useClass: GuestAuthAdapter },
  ],
  exports: [MatchService],
})
export class MatchModule {}
