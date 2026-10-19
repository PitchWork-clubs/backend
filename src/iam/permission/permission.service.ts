import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ENFeature,
  ENMembershipStatus,
  Membership,
} from '@prisma/client';
import { ResourceNotFoundException } from '@common/exceptions/resource-not-found';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { TActiveMembershipPayload } from '@common/guards/active-membership.guard';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private async membershipAllData(membershipId: string) {}

  public async SyncMembershipWithRolePermissions(
    membershipId: string,
    adminMembership: Membership,
  ) {}

  public async grantDirectPermission(
    targetMembershipId: string,
    permissionCode: string,
  ) {
    const permission = await this.prisma.permission.findUnique({
      where: { code: permissionCode },
    });

    if (!permission) {
      throw new ResourceNotFoundException(
        `Permission '${permissionCode}' not found`,
        'Permission',
      );
    }

    return this.prisma.membershipPermission.upsert({
      where: {
        membershipId_permissionId: {
          membershipId: targetMembershipId,
          permissionId: permission.id,
        },
      },
      create: {
        membershipId: targetMembershipId,
        permissionId: permission.id,
        action: 'GRANT',
      },
      update: {
        action: 'GRANT',
      },
    });
  }

  public async revokeDirectPermission(
    targetMembershipId: string,
    permissionCode: string,
    user_id?: string,
  ) {
    const permission = await this.prisma.permission.findUnique({
      where: { code: permissionCode },
    });

    if (!permission) {
      throw new ResourceNotFoundException(
        `Permission '${permissionCode}' not found`,
        'Permission',
      );
    }

    // Set action to REVOKE (explicit deny override)
    return this.prisma.membershipPermission.upsert({
      where: {
        membershipId_permissionId: {
          membershipId: targetMembershipId,
          permissionId: permission.id,
        },
      },
      create: {
        membershipId: targetMembershipId,
        permissionId: permission.id,
        action: 'REVOKE',
      },
      update: {
        action: 'REVOKE',
      },
    });
  }

  public async clearPermissionOverride(
    targetMembershipId: string,
    permissionCode: string,
  ) {
    const permission = await this.prisma.permission.findUnique({
      where: { code: permissionCode },
    });

    if (!permission) {
      throw new ResourceNotFoundException(
        `Permission '${permissionCode}' not found`,
        'Permission',
      );
    }

    return this.prisma.membershipPermission.deleteMany({
      where: {
        membershipId: targetMembershipId,
        permissionId: permission.id,
      },
    });
  }
}
