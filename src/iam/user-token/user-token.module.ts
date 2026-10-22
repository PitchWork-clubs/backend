import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { TimezoneModule } from '@common/timezone/timezone.module';
import { UserTokenService } from './user-token.service';

@Module({
  imports: [PrismaModule, TimezoneModule],
  providers: [UserTokenService],
  exports: [UserTokenService],
})
export class UserTokenModule {}
