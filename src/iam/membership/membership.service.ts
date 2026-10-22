import { ResourceNotFoundException } from '@common/exceptions/resource-not-found';
import { parsePrismaError } from '@common/utils/error-handler';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ENMembershipStatus,
  ENMembershipType,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { TimezoneService } from '@common/timezone/timezone.service';
import { AuditLogsService } from '@infrastructure/audit-logs/audit-logs.service';
import { ENFeature } from '@prisma/client';
import { UpdateMembershipDto } from './membership.dto';

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  public async listMemberships(clubId: string) {
    return this.prisma.membership.findMany({
      where: { clubId },
      include: { person: true, types: true, membershipRoles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async listMyMemberships(personId: string) {
    return this.prisma.membership.findMany({
      where: { personId },
      include: {
        club: true,
        types: true,
        membershipRoles: { include: { role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async getMembership(membershipId: string, clubId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, clubId },
      include: {
        person: true,
        types: true,
        membershipRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        membershipPermissions: { include: { permission: true } },
      },
    });
    if (!membership) throw new ResourceNotFoundException('Membership not found', 'membership');
    return membership;
  }

  public async createMembership(
    personId: string,
    clubId: string,
    types: ENMembershipType[],
    actorUserId = 'system',
  ) {
    const uniqueTypes = [...new Set(types)];
    if (uniqueTypes.length === 0) {
      throw new ConflictException('A membership must have at least one type.');
    }
    if (uniqueTypes.length !== types.length) {
      throw new ConflictException('Membership types must be unique.');
    }

    const personExists = await this.prisma.person.findUnique({
      where: { id: personId },
    });
    if (!personExists)
      throw new ResourceNotFoundException(
        `Person '${personId}' not found`,
        'Person',
      );

    const clubExists = await this.prisma.club.findUnique({
      where: { id: clubId },
    });
    if (!clubExists)
      throw new ResourceNotFoundException(`Club '${clubId}' not found`, 'Club');

    const existingActiveMembership = await this.prisma.membership.findFirst({
      where: {
        personId,
        clubId,
        status: ENMembershipStatus.ACTIVE,
      },
    });
    if (existingActiveMembership) {
      throw new ConflictException(
        `Person '${personId}' already has an active membership in this club.`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const createdMembership = await tx.membership.create({
          data: {
            personId,
            clubId,
            joinedAt: this.timezoneService.nowUtc(),
            types: {
              create: uniqueTypes.map((type) => ({ type })),
            },
          },
          include: { types: true },
        });

        await this.auditLogs.createLog(
          {
            category: ENFeature.ACCESS,
            action: 'membership-created',
            entityType: 'Membership',
            entityId: createdMembership.id,
            doneById: actorUserId,
            metadata: { club_id: clubId, person_id: personId, types: uniqueTypes },
          },
          tx,
        );
        return createdMembership;
      });
    } catch (error) {
      throw new InternalServerErrorException(parsePrismaError(error));
    }
  }

  public async updateMembership(
    membershipId: string,
    clubId: string,
    input: UpdateMembershipDto,
    actorUserId: string,
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, clubId },
      include: { types: true },
    });
    if (!membership) {
      throw new ResourceNotFoundException('Membership not found', 'Membership');
    }

    const uniqueTypes = input.types ? [...new Set(input.types)] : undefined;
    if (uniqueTypes && (uniqueTypes.length === 0 || uniqueTypes.length !== input.types!.length)) {
      throw new ConflictException('Membership types must be unique and non-empty.');
    }

    if (input.status === ENMembershipStatus.ACTIVE && membership.status === ENMembershipStatus.ENDED) {
      throw new ConflictException('Ended memberships cannot be reactivated.');
    }
    if (input.status === membership.status && input.types === undefined && input.endReason === undefined) {
      throw new ConflictException('Membership has no changes.');
    }

    const now = this.timezoneService.nowUtc();
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.membership.update({
          where: { id: membershipId },
          data: {
            ...(input.status ? {
              status: input.status,
              endedAt: input.status === ENMembershipStatus.ENDED ? now : null,
            } : {}),
            ...(input.endReason !== undefined ? { endReason: input.endReason } : {}),
            ...(uniqueTypes ? {
              types: {
                deleteMany: {},
                create: uniqueTypes.map((type) => ({ type })),
              },
            } : {}),
          },
          include: { types: true },
        });
        await this.auditLogs.createLog(
          {
            category: ENFeature.ACCESS,
            action: 'membership-updated',
            entityType: 'Membership',
            entityId: membershipId,
            doneById: actorUserId,
            metadata: {
              club_id: clubId,
              previous_status: membership.status,
              status: input.status,
              types: uniqueTypes,
            },
          },
          tx,
        );
        return result;
      });
      return updated;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException(parsePrismaError(error));
    }
  }

  public async endMembership(
    membershipId: string,
    actingMembership: TActiveMembershipPayload,
    actorUserId = 'system',
  ) {
    const targetMembership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
    });
    if (!targetMembership) {
      throw new ResourceNotFoundException(
        `Membership '${membershipId}' not found`,
        'Membership',
      );
    }

    if (targetMembership.clubId !== actingMembership.clubId) {
      throw new ForbiddenException(
        'Acting admin has no authority over a membership in a different club.',
      );
    }

    if (targetMembership.status === ENMembershipStatus.ENDED) {
      throw new ConflictException('Membership has already ended.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const endedMembership = await tx.membership.update({
          where: { id: membershipId },
          data: {
            status: ENMembershipStatus.ENDED,
            endedAt: this.timezoneService.nowUtc(),
          },
          include: { types: true },
        });

        await this.auditLogs.createLog(
          {
            category: ENFeature.ACCESS,
            action: 'membership-ended',
            entityType: 'Membership',
            entityId: membershipId,
            doneById: actorUserId,
            metadata: { club_id: actingMembership.clubId },
          },
          tx,
        );

        return endedMembership;
      });
    } catch (error) {
      throw new InternalServerErrorException(parsePrismaError(error));
    }
  }
}
