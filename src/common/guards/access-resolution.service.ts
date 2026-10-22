import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  ENClubFeatureStatus,
  ENFeature,
  ENMembershipPermissionAction,
  ENScopeType,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { AccessContext, IPermissionScope } from './access-context';

export interface IAccessResolutionMembership {
  id: string;
  clubId: string;
  personId: string;
  club: { status: string };
  membershipRoles: Array<{
    scope: ENScopeType;
    scopeId: string | null;
    role: { permissions: Array<{ permission: { code: string } }> };
  }>;
  membershipPermissions: Array<{
    action: ENMembershipPermissionAction;
    scope: ENScopeType;
    scopeId: string;
    permission: { code: string };
  }>;
  person: { relatedPersonLinks?: Array<{ personId: string }> };
}

export interface IResolvedAccess {
  effectivePermissions: string[];
  permissionScopes: Map<string, IPermissionScope[]>;
  accessContext: AccessContext;
  enabledFeatures: ENFeature[];
}

@Injectable()
export class AccessResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(membership: IAccessResolutionMembership): Promise<IResolvedAccess> {
    if (membership.club.status !== 'ACTIVE') {
      throw new ForbiddenException('Club is not active.');
    }

    const permissionScopes = new Map<string, IPermissionScope[]>();
    for (const assignment of membership.membershipRoles) {
      for (const rolePermission of assignment.role.permissions) {
        this.addScope(permissionScopes, rolePermission.permission.code, {
          scope: assignment.scope,
          scopeId: assignment.scopeId,
        });
      }
    }

    for (const override of membership.membershipPermissions) {
      const code = override.permission.code;
      if (override.action === ENMembershipPermissionAction.REVOKE) {
        // Direct revocation is membership-wide. Role scopes cannot restore it.
        permissionScopes.delete(code);
      } else {
        // Direct grants are membership-wide until scoped overrides are enabled.
        permissionScopes.set(code, [{ scope: ENScopeType.CLUB, scopeId: '' }]);
      }
    }

    const relatedPersonIds = membership.person.relatedPersonLinks?.map((link) => link.personId) ?? [];
    const enabledFeatures = await this.getEnabledFeatures(membership.clubId);
    return {
      effectivePermissions: Array.from(permissionScopes.keys()),
      permissionScopes,
      accessContext: new AccessContext(
        membership.clubId,
        membership.id,
        membership.personId,
        permissionScopes,
        relatedPersonIds,
      ),
      enabledFeatures,
    };
  }

  async getEnabledFeatures(clubId: string): Promise<ENFeature[]> {
    const rows = await this.prisma.clubFeature.findMany({
      where: { clubId, status: ENClubFeatureStatus.ENABLED, feature: { isActive: true } },
      select: { feature: { select: { code: true } } },
    });
    return rows.map((row) => row.feature.code);
  }

  private addScope(map: Map<string, IPermissionScope[]>, code: string, scope: IPermissionScope) {
    const scopes = map.get(code) ?? [];
    if (!scopes.some((item) => item.scope === scope.scope && item.scopeId === scope.scopeId)) {
      scopes.push(scope);
    }
    map.set(code, scopes);
  }
}
