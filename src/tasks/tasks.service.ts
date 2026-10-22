import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { TimezoneService } from '@common/timezone/timezone.service';
import { ENAuditLogResult, ENFeature, ENInvitationStatus } from '@prisma/client';
import { ClubService } from '@clubs/club/club.service';
import { UserTokenService } from '@iam/user-token/user-token.service';
import { AuditLogsService } from '@infrastructure/audit-logs/audit-logs.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
    private readonly clubService: ClubService,
    private readonly userTokenService: UserTokenService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Deletes user tokens that are expired or marked as DISRUPTED.
   * Runs daily at midnight.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  public async deleteExpiredUserTokens() {
    this.logger.log('Running task: deleteExpiredUserTokens...');
    try {
      const count = await this.userTokenService.deleteExpiredOrDisrupted();
      await this.auditLogs.createLog({
        category: ENFeature.ACCESS,
        action: 'USER_TOKEN_CLEANUP',
        entityType: 'UserToken',
        result: ENAuditLogResult.SUCCESS,
        metadata: { deleted_count: count },
      });
      this.logger.log(`Deleted ${count} expired/disrupted user tokens.`);
    } catch (error) {
      this.logger.error('Failed to delete expired user tokens:', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  public async archiveExpiredPendingClubs() {
    this.logger.log('Running task: archiveExpiredPendingClubs...');
    try {
      await this.clubService.archiveExpiredPendingClubs();
    } catch (error) {
      this.logger.error('Failed to archive expired pending clubs:', error);
    }
  }

  /**
   * Deletes invitations that are expired or marked as DISRUPTED.
   * Runs daily at midnight.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  public async deleteExpiredInvitations() {
    this.logger.log('Running task: deleteExpiredInvitations...');
    try {
      const result = await this.prisma.invitation.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: this.timezoneService.nowUtc() } },
            { status: ENInvitationStatus.DISRUPTED },
          ],
        },
      });
      await this.auditLogs.createLog({
        category: ENFeature.ACCESS,
        action: 'INVITATION_CLEANUP',
        entityType: 'Invitation',
        result: ENAuditLogResult.SUCCESS,
        metadata: { deleted_count: result.count },
      });
      this.logger.log(`Deleted ${result.count} expired/disrupted invitations.`);
    } catch (error) {
      this.logger.error('Failed to delete expired invitations:', error);
    }
  }

  /**
   * Deletes registered accounts that have not verified their email after 24 hours,
   * including associated tokens and Person records to prevent foreign key errors.
   * Runs every hour.
   */
  @Cron(CronExpression.EVERY_HOUR)
  public async deleteUnVerifiedAccounts() {
    this.logger.log('Running task: deleteUnVerifiedAccounts...');
    try {
      const twentyFourHoursAgo = this.timezoneService.futureUtc(
        -(24 * 60 * 60 * 1000),
      );

      // 1. Find all unverified users created over 24 hours ago
      const unverifiedUsers = await this.prisma.user.findMany({
        where: {
          isEmailVerified: false,
          createdAt: { lt: twentyFourHoursAgo },
        },
        select: {
          id: true,
          personId: true,
        },
      });

      if (unverifiedUsers.length === 0) {
        this.logger.log('No unverified accounts found to purge.');
        return;
      }

      const userIds = unverifiedUsers.map((user) => user.id);
      const personIds = unverifiedUsers.map((user) => user.personId);

      // 2. Perform cleanup inside a transaction to maintain database integrity
      await this.prisma.$transaction([
        // Delete user tokens related to these accounts
        this.prisma.userToken.deleteMany({
          where: { userId: { in: userIds } },
        }),
        // Delete user records
        this.prisma.user.deleteMany({
          where: { id: { in: userIds } },
        }),
        // Delete associated person records
        this.prisma.person.deleteMany({
          where: { id: { in: personIds } },
        }),
      ]);

      await this.auditLogs.createLog({
        category: ENFeature.ACCESS,
        action: 'UNVERIFIED_ACCOUNT_CLEANUP',
        entityType: 'User',
        result: ENAuditLogResult.SUCCESS,
        metadata: { deleted_count: userIds.length },
      });

      this.logger.log(
        `Successfully purged ${userIds.length} unverified account(s).`,
      );
    } catch (error) {
      this.logger.error('Failed to purge unverified accounts:', error);
    }
  }
}
