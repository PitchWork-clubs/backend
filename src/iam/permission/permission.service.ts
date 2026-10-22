import { BadRequestException, Injectable } from '@nestjs/common';
import { ENScopeType, Membership } from '@prisma/client';
import { ResourceNotFoundException } from '@common/exceptions/resource-not-found';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { AuditLogsService } from '@infrastructure/audit-logs/audit-logs.service';
import { ENFeature } from '@prisma/client';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  public async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
  }

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
    userId?: string,
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
    const override = await (this.prisma.membershipPermission.upsert as any)({
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
    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'permission-granted',
      entityType: 'MembershipPermission',
      entityId: override.id,
      doneById: userId ?? 'system',
      metadata: { membership_id: targetMembershipId, permission_code: permissionCode },
    });
    return override;
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
    const override = await (this.prisma.membershipPermission.upsert as any)({
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
    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'permission-revoked',
      entityType: 'MembershipPermission',
      entityId: override.id,
      doneById: user_id,
      metadata: { membership_id: targetMembershipId, permission_code: permissionCode },
    });
    return override;
  }

  public async clearPermissionOverride(
    targetMembershipId: string,
    permissionCode: string,
    scope: ENScopeType = ENScopeType.CLUB,
    scopeId?: string,
  ) {
    if (scope !== ENScopeType.CLUB || scopeId) {
      throw new BadRequestException(
        'Membership permission overrides are club-wide; use role assignments for scoped access.',
      );
    }

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
    if (scope !== ENScopeType.CLUB || scopeId) {
      throw new BadRequestException(
        'Membership permission overrides are club-wide; use role assignments for scoped access.',
      );
    }
    if (!adminMembership) return;
    const target = await this.prisma.membership.findUnique({ where: { id: targetMembershipId } });
    if (!target || target.clubId !== adminMembership.clubId) {
      throw new BadRequestException('Target membership does not belong to the same club');
    }
  }
}
