import { ForbiddenException } from '@nestjs/common';
import { ENScopeType } from '@prisma/client';

export interface IPermissionScope {
  scope: ENScopeType;
  scopeId: string | null;
}

export class AccessContext {
  constructor(
    public readonly clubId: string,
    public readonly membershipId: string,
    public readonly personId: string,
    private readonly permissionScopes: Map<string, IPermissionScope[]>,
    private readonly relatedPersonIds: string[],
  ) {}

  /**
   * Check if a permission is granted for a specific resource target (teamId or personId).
   */
  public allows(
    permissionCode: string,
    target?: { teamId?: string | null; personId?: string | null },
  ): boolean {
    const scopes = this.permissionScopes.get(permissionCode);
    if (!scopes || scopes.length === 0) return false;

    // Check each granted scope for this permission
    for (const s of scopes) {
      if (s.scope === 'CLUB' || s.scope === 'ANY') {
        return true;
      }
      if (s.scope === 'TEAM') {
        if (target?.teamId && s.scopeId === target.teamId) {
          return true;
        }
      }
      if (s.scope === 'OWN') {
        if (target?.personId && target.personId === this.personId) {
          return true;
        }
      }
      if (s.scope === 'RELATED') {
        if (target?.personId && this.relatedPersonIds.includes(target.personId)) {
          return true;
        }
      }
    }

    // If target was not specified and user has at least one scope (e.g. for general list queries)
    if (!target || (!target.teamId && !target.personId)) {
      return true;
    }

    return false;
  }

  /**
   * Throw ForbiddenException if permission is not allowed on target.
   */
  public ensure(
    permissionCode: string,
    target?: { teamId?: string | null; personId?: string | null },
  ): void {
    if (!this.allows(permissionCode, target)) {
      throw new ForbiddenException(
        `Access denied for permission '${permissionCode}' on the requested resource.`,
      );
    }
  }

  /**
   * Return a summary of granted scopes for building database queries.
   */
  public summary(permissionCode: string): {
    hasClubWide: boolean;
    teamIds: string[];
    allowOwn: boolean;
    relatedPersonIds: string[];
  } {
    const scopes = this.permissionScopes.get(permissionCode) || [];
    let hasClubWide = false;
    const teamIds: string[] = [];
    let allowOwn = false;
    const relatedPersonIds: string[] = [];

    for (const s of scopes) {
      if (s.scope === 'CLUB' || s.scope === 'ANY') {
        hasClubWide = true;
      } else if (s.scope === 'TEAM' && s.scopeId) {
        teamIds.push(s.scopeId);
      } else if (s.scope === 'OWN') {
        allowOwn = true;
      } else if (s.scope === 'RELATED') {
        relatedPersonIds.push(...this.relatedPersonIds);
      }
    }

    return {
      hasClubWide,
      teamIds: Array.from(new Set(teamIds)),
      allowOwn,
      relatedPersonIds: Array.from(new Set(relatedPersonIds)),
    };
  }
}
