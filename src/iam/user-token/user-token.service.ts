import { Injectable } from '@nestjs/common';
import { ENUserTokenStatus, ENUserTokenType } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { TimezoneService } from '@common/timezone/timezone.service';

/** Owns lifecycle operations shared by user-action tokens. */
@Injectable()
export class UserTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
  ) {}

  async deleteExpiredOrDisrupted(): Promise<number> {
    const result = await this.prisma.userToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: this.timezoneService.nowUtc() } },
          { status: ENUserTokenStatus.DISRUPTED },
        ],
      },
    });
    return result.count;
  }

  async disruptPending(input: {
    userId?: string;
    identifierId?: string;
    type: ENUserTokenType;
  }): Promise<number> {
    const result = await this.prisma.userToken.updateMany({
      where: {
        userId: input.userId,
        identifierId: input.identifierId,
        type: input.type,
        status: ENUserTokenStatus.PENDING,
        usedAt: null,
      },
      data: { status: ENUserTokenStatus.DISRUPTED },
    });
    return result.count;
  }
}
