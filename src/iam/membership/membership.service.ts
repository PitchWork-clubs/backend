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

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
  ) {}

  public async createMembership(
    personId: string,
    clubId: string,
    types: ENMembershipType[],
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

        return createdMembership;
      });
    } catch (error) {
      throw new InternalServerErrorException(parsePrismaError(error));
    }
  }

  public async endMembership(
    membershipId: string,
    actingMembership: TActiveMembershipPayload,
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

        return endedMembership;
      });
    } catch (error) {
      throw new InternalServerErrorException(parsePrismaError(error));
    }
  }
}
