import { BadRequestException, Injectable } from '@nestjs/common';
import { ENScopeType, Membership } from '@prisma/client';
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
    scope: ENScopeType = ENScopeType.CLUB,
    scopeId?: string,
    adminMembership?: Membership,
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

    await this.validateScope(targetMembershipId, scope, scopeId, adminMembership);
    return (this.prisma.membershipPermission.upsert as any)({
      where: {
        membershipId_permissionId_scope_scopeId: {
          membershipId: targetMembershipId,
          permissionId: permission.id,
          scope,
          scopeId: scopeId ?? '',
        },
      },
      create: {
        membershipId: targetMembershipId,
        permissionId: permission.id,
        action: 'GRANT',
        scope,
        scopeId: scopeId ?? '',
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
    scope: ENScopeType = ENScopeType.CLUB,
    scopeId?: string,
    adminMembership?: Membership,
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

    await this.validateScope(targetMembershipId, scope, scopeId, adminMembership);
    return (this.prisma.membershipPermission.upsert as any)({
      where: {
        membershipId_permissionId_scope_scopeId: {
          membershipId: targetMembershipId,
          permissionId: permission.id,
          scope,
          scopeId: scopeId ?? '',
        },
      },
      create: {
        membershipId: targetMembershipId,
        permissionId: permission.id,
        action: 'REVOKE',
        scope,
        scopeId: scopeId ?? '',
      },
      update: {
        action: 'REVOKE',
      },
    });
  }

  public async clearPermissionOverride(
    targetMembershipId: string,
    permissionCode: string,
    scope: ENScopeType = ENScopeType.CLUB,
    scopeId?: string,
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

    return (this.prisma.membershipPermission.deleteMany as any)({
      where: {
        membershipId: targetMembershipId,
        permissionId: permission.id,
        scope,
        scopeId: scopeId ?? '',
      },
    });
  }

  private async validateScope(
    targetMembershipId: string,
    scope: ENScopeType,
    scopeId?: string,
    adminMembership?: Membership,
  ) {
    if (scope === ENScopeType.TEAM && !scopeId) {
      throw new BadRequestException('A team is required for a TEAM-scoped override');
    }
    if (scope !== ENScopeType.TEAM && scopeId) {
      throw new BadRequestException('scopeId is only valid for a TEAM-scoped override');
    }
    if (!adminMembership || scope !== ENScopeType.TEAM) return;
    const target = await this.prisma.membership.findUnique({ where: { id: targetMembershipId } });
    if (!target || target.clubId !== adminMembership.clubId) {
      throw new BadRequestException('Target membership does not belong to the same club');
    }
    const team = await this.prisma.team.findFirst({ where: { id: scopeId, clubId: adminMembership.clubId } });
    if (!team) throw new BadRequestException('Team does not belong to the same club');
  }
}
