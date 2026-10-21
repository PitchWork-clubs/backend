import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { CreateClubDto, UpdateClubDto } from './club.dto';
import { ResourceNotFoundException } from '@common/exceptions/resource-not-found';
import {
  ENClubStatus,
  ENMembershipStatus,
  ENMembershipType,
} from '@prisma/client';
import { parsePrismaError } from '@common/utils/error-handler';
import { TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { CloudinaryService } from '../../media/cloudinary/cloudinary.service';
import { ENClubFeatureStatus } from '@generated/prisma-nestjs-graphql/prisma/en-club-feature-status.enum';
import { TimezoneService } from '@common/timezone/timezone.service';
import { AuditLogsService } from '@infrastructure/audit-logs/audit-logs.service';
import { ENAuditLogResult, ENFeature } from '@prisma/client';

@Injectable()
export class ClubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly timezoneService: TimezoneService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private logger = new Logger(ClubService.name);

  /**
   * Generates a short abbreviation/acronym from a full club name.
   *
   * Examples:
   * - "Manchester United" -> "MU"
   * - "Real Madrid Football Club" -> "RMFC"
   * - "Arsenal" -> "ARS"
   * - "FC Barcelona" -> "FCB"
   * - "A" -> "A"
   */
  private generateShortName(name: string, maxLen: number = 4): string {
    if (!name || !name.trim()) return '';

    // Clean extra spaces and extract words ignoring special chars
    const words = name
      .trim()
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 0);

    if (words.length === 0) return 'CLUB';

    // Multi-word name: Take the first letter of each word
    if (words.length > 1) {
      return words
        .map((word) => word[0])
        .join('')
        .toUpperCase()
        .slice(0, maxLen);
    }

    // Single word: Take up to 3 chars (e.g., "Arsenal" -> "ARS")
    const singleWord = words[0];
    if (singleWord.length <= 3) {
      return singleWord.toUpperCase();
    }

    return singleWord.slice(0, 3).toUpperCase();
  }

  public async createClub(
    createClubDto: CreateClubDto,
    userId: string,
    timezone?: string,
  ) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { person: true },
      });

      if (!user) throw new ResourceNotFoundException('User not found', 'user');

      return await this.prisma.$transaction(async (tx) => {
        const now = this.timezoneService.nowUtc();

        const club = await tx.club.create({
          data: {
            name: createClubDto.name,
            shortName:
              createClubDto.shortName ??
              this.generateShortName(createClubDto.name),
            logo: createClubDto.logo,
            country: createClubDto.country,
            timezone: this.timezoneService.resolve(
              createClubDto.timezone ?? timezone,
              undefined,
            ),
            status: ENClubStatus.PENDING_VERIFICATION,
          },
        });

        const uniqueTypes = Array.from(
          new Set([ENMembershipType.OWNER, ...createClubDto.membershipTypes]),
        );

        // Create membership for creator
        const ownerMembership = await tx.membership.create({
          data: {
            clubId: club.id,
            joinedAt: now,
            personId: user.person.id,
            types: {
              create: uniqueTypes.map((type) => ({ type: type })),
            },
            status: ENMembershipStatus.PENDING,
          },
          include: { types: true },
        });

        // Pending owners must not receive active access before platform approval.
        let pendingOwnerRole = await tx.role.findFirst({
          where: { code: 'PENDING_OWNER', isSystem: true, clubId: null },
        });

        if (!pendingOwnerRole) {
          pendingOwnerRole = await tx.role.create({
            data: {
              code: 'PENDING_OWNER',
              name: 'Pending Owner',
              description: 'Owner awaiting platform verification',
              isSystem: true,
            },
          });
        }

        if (pendingOwnerRole) {
          await tx.membershipRole.create({
            data: {
              membershipId: ownerMembership.id,
              roleId: pendingOwnerRole.id,
              scope: 'CLUB',
            },
          });
        }

        const finalizedClub = await tx.club.update({
          where: { id: club.id },
          data: { createdById: ownerMembership.id },
        });

        await this.auditLogs.createLog(
          {
            category: ENFeature.CLUB,
            action: 'club-created-pending-verification',
            entityType: 'Club',
            entityId: finalizedClub.id,
            doneById: userId,
            metadata: { club_id: finalizedClub.id, membership_id: ownerMembership.id },
          },
          tx,
        );

        return finalizedClub;
      });
    } catch (error) {
      console.error('Club creation error:', error);
      throw error;
    }
  }

  public async updateClub(
    data: UpdateClubDto,
    membership: TActiveMembershipPayload,
    timezone?: string,
  ) {
    // 1. Find the active membership for this user/person and include the club
    if (!membership || !membership.club)
      throw new ResourceNotFoundException(
        'No club found for this user',
        'club',
      );

    const club = membership.club;
    const updatedClub = await this.prisma.club.update({
      where: { id: club.id },
      data: {
        ...data,
        ...(data.timezone === undefined && timezone ? { timezone } : {}),
      },
    });

    // if the club has a logo, and we updated the logo, delete the old one
    if (data.logo && membership.club.logo) {
      this.cloudinaryService.deleteFile(membership.club.logo).catch((err) => {
        this.logger.error(
          `Error deleting Cloudinary asset: oldLogo: ${membership.club.logo} \nNew Logo: ${data.logo} \nError: ${err}`,
        );
      });
    }

    return updatedClub;
  }

  public async myClubs(personId: string) {
    try {
      return await this.prisma.club.findMany({
        where: {
          memberships: {
            some: {
              personId,
              status: ENMembershipStatus.ACTIVE,
            },
          },
        },
      });
    } catch (error) {
      throw new InternalServerErrorException(parsePrismaError(error));
    }
  }

  /**
   * The permission is to club.delete
   * @param membershipId
   * @param clubId
   */
  public async archiveClub(clubId: string, membershipId: string) {}

  public async verifyClub(clubId: string, platformAdminUserId: string) {
    await this.requirePlatformAdmin(platformAdminUserId);

    return this.prisma.$transaction(async (tx) => {
      const club = await tx.club.findUnique({
        where: { id: clubId },
        include: { createdBy: true },
      });
      if (!club) throw new ResourceNotFoundException('Club not found', 'club');
      if (club.status === ENClubStatus.ACTIVE) return club;
      if (club.status !== ENClubStatus.PENDING_VERIFICATION) {
        throw new ConflictException('Only pending clubs can be approved');
      }

      const membership = club.createdBy;
      if (!membership) throw new ConflictException('Club creator membership is missing');

      const adminRole = await tx.role.findFirst({
        where: { code: 'ADMIN', isSystem: true, clubId: null },
      });
      if (!adminRole) throw new InternalServerErrorException('System ADMIN role is missing');

      await tx.membershipRole.deleteMany({
        where: { membershipId: membership.id, role: { code: 'PENDING_OWNER' } },
      });
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: adminRole.id, scope: 'CLUB' },
      });
      await tx.membership.update({
        where: { id: membership.id },
        data: { status: ENMembershipStatus.ACTIVE },
      });
      const features = await tx.feature.findMany({ where: { isActive: true, isCore: true } });
      if (features.length) {
        await tx.clubFeature.createMany({
          data: features.map((feature) => ({
            clubId,
            featureId: feature.id,
            status: ENClubFeatureStatus.ENABLED,
            enabledById: membership.id,
            enabledAt: this.timezoneService.nowUtc(),
          })),
          skipDuplicates: true,
        });
      }
      const approved = await tx.club.update({
        where: { id: clubId },
        data: { status: ENClubStatus.ACTIVE },
      });
      await this.auditLogs.createLog({
        category: ENFeature.CLUB,
        action: 'club-verified',
        entityType: 'Club',
        entityId: clubId,
        doneById: platformAdminUserId,
      }, tx);
      return approved;
    });
  }

  public async rejectClub(clubId: string, platformAdminUserId: string, reason?: string) {
    await this.requirePlatformAdmin(platformAdminUserId);
    return this.prisma.$transaction(async (tx) => {
      const club = await tx.club.findUnique({ where: { id: clubId }, include: { createdBy: true } });
      if (!club) throw new ResourceNotFoundException('Club not found', 'club');
      if (club.status === ENClubStatus.INACTIVE && club.createdBy?.status === ENMembershipStatus.ENDED) return club;
      if (club.status !== ENClubStatus.PENDING_VERIFICATION) throw new ConflictException('Only pending clubs can be rejected');
      if (club.createdBy) {
        await tx.membership.update({
          where: { id: club.createdBy.id },
          data: { status: ENMembershipStatus.ENDED, endedAt: this.timezoneService.nowUtc(), endReason: reason ?? 'Rejected by platform' },
        });
      }
      const rejected = await tx.club.update({ where: { id: clubId }, data: { status: ENClubStatus.INACTIVE } });
      await this.auditLogs.createLog({
        category: ENFeature.CLUB,
        action: 'club-rejected',
        entityType: 'Club',
        entityId: clubId,
        doneById: platformAdminUserId,
        result: ENAuditLogResult.SUCCESS,
        metadata: { reason: reason ?? 'Rejected by platform' },
      }, tx);
      return rejected;
    });
  }

  public async archiveExpiredPendingClubs(now = this.timezoneService.nowUtc()) {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const pending = await this.prisma.club.findMany({
      where: { status: ENClubStatus.PENDING_VERIFICATION, createdAt: { lt: cutoff } },
      select: { id: true, createdById: true },
    });
    let archived = 0;
    for (const club of pending) {
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.club.updateMany({
          where: { id: club.id, status: ENClubStatus.PENDING_VERIFICATION },
          data: { status: ENClubStatus.INACTIVE },
        });
        if (!result.count) return;
        if (club.createdById) {
          await tx.membership.updateMany({
            where: { id: club.createdById, status: ENMembershipStatus.PENDING },
            data: { status: ENMembershipStatus.ENDED, endedAt: now, endReason: 'Verification expired' },
          });
        }
        await this.auditLogs.createLog({
          category: ENFeature.CLUB,
          action: 'club-verification-expired',
          entityType: 'Club',
          entityId: club.id,
          metadata: { cutoff: cutoff.toISOString() },
        }, tx);
        archived += result.count;
      });
    }
    this.logger.log(`Archived ${archived} expired pending club(s).`);
    return archived;
  }

  private async requirePlatformAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
    if (!user) throw new ResourceNotFoundException('User not found', 'user');
    if (!user.isPlatformAdmin) throw new ForbiddenException('Platform administrator access required');
  }

  public async getClub(clubId: string) {
    return this.prisma.club.findUnique({ where: { id: clubId } });
  }
}
