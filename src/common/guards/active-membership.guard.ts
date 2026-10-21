import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  ENMembershipPermissionAction,
  ENMembershipStatus,
  Prisma,
} from '@prisma/client';
import { getRequestFromContext } from '@common/utils/request-context.util';
import { TimezoneService } from '@common/timezone/timezone.service';
import { AccessContext, IPermissionScope } from './access-context';

export type TActiveMembershipPayload = Prisma.MembershipGetPayload<{
  include: {
    club: true;
    types: true;
    person: {
      include: {
        user: true;
        relatedPersonLinks: {
          select: { personId: true };
        };
      };
    };
    membershipRoles: {
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true;
              };
            };
          };
        };
      };
    };
    membershipPermissions: {
      include: {
        permission: true;
      };
    };
  };
}>;

declare global {
  namespace Express {
    interface Request {
      activeMembership?: TActiveMembershipPayload;
      effectivePermissions?: string[];
      permissionScopes?: Map<string, IPermissionScope[]>;
      accessContext?: AccessContext;
      club?: {
        clubId: string;
        membershipId: string;
        personId: string;
        types: string[];
      };
      timezone?: string | null;
    }
  }
}

@Injectable()
export class ActiveMembershipGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = this.getRequest(context);

    const personId = req.user?.person_id;
    const userId = req.user?.user_id;
    if (!personId || !userId) {
      throw new UnauthorizedException('User session not found.');
    }

    // Resolve clubId from route param or header
    const clubId =
      (req.params?.clubId as string) ||
      (req.params?.id as string) ||
      (req.headers['x-club-id'] as string);

    if (!clubId) {
      throw new UnauthorizedException('Club context not identified.');
    }

    let activeMembership: TActiveMembershipPayload | null = null;

    try {
      activeMembership = await this.prisma.membership.findFirst({
        where: {
          personId,
          clubId,
          status: ENMembershipStatus.ACTIVE,
        },
        include: {
          club: true,
          types: true,
          person: {
            include: {
              user: true,
              relatedPersonLinks: {
                where: { clubId, endedAt: null },
                select: { personId: true },
              },
            },
          },
          membershipRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
          membershipPermissions: {
            include: {
              permission: true,
            },
          },
        },
      });
    } catch (error) {
      throw new InternalServerErrorException('Validating membership failed');
    }

    if (!activeMembership) {
      throw new ForbiddenException('Active club membership not found.');
    }

    // Timezone resolution
    const clientTz = req.headers['x-timezone'] as string | undefined;
    req.timezone = this.timezoneService.resolve(
      clientTz,
      activeMembership.club.timezone,
    );

    // Compute effective permissions with scopes
    const codeMap = new Map<string, IPermissionScope[]>();

    // 1. Collect permissions from all assigned roles with their scopes
    for (const mr of activeMembership.membershipRoles) {
      for (const rp of mr.role.permissions) {
        const code = rp.permission.code;
        const currentScopes = codeMap.get(code) || [];
        currentScopes.push({
          scope: mr.scope,
          scopeId: mr.scopeId,
        });
        codeMap.set(code, currentScopes);
      }
    }

    // 2. Apply explicit direct overrides
    for (const override of activeMembership.membershipPermissions as any[]) {
      const code = override.permission.code;
      const overrideScope = { scope: override.scope, scopeId: override.scopeId };
      const currentScopes = codeMap.get(code) || [];
      if (override.action === ENMembershipPermissionAction.REVOKE) {
        const remainingScopes = currentScopes.filter(
          (scope) => scope.scope !== override.scope || scope.scopeId !== override.scopeId,
        );
        if (remainingScopes.length > 0) codeMap.set(code, remainingScopes);
        else codeMap.delete(code);
      } else if (override.action === ENMembershipPermissionAction.GRANT) {
        if (!currentScopes.some((scope) => scope.scope === override.scope && scope.scopeId === override.scopeId)) {
          currentScopes.push(overrideScope);
        }
        codeMap.set(code, currentScopes);
      }
    }

    const effectivePermissions = Array.from(codeMap.keys());
    const relatedPersonIds =
      activeMembership.person.relatedPersonLinks?.map((l) => l.personId) || [];

    const accessContext = new AccessContext(
      activeMembership.clubId,
      activeMembership.id,
      activeMembership.personId,
      codeMap,
      relatedPersonIds,
    );

    req.activeMembership = activeMembership;
    req.effectivePermissions = effectivePermissions;
    req.permissionScopes = codeMap;
    req.accessContext = accessContext;
    req.club = {
      clubId: activeMembership.clubId,
      membershipId: activeMembership.id,
      personId: activeMembership.personId,
      types: activeMembership.types.map((t) => t.type),
    };

    return true;
  }

  private getRequest(context: ExecutionContext) {
    return getRequestFromContext(context);
  }
}
