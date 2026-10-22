import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  IPermissionsMetadata,
} from '@common/decorators/require-permissions.decorator';
import { getRequestFromContext } from '@common/utils/request-context.util';
import { SCOPES_KEY, IScopesMetadata } from '@common/decorators/require-scopes.decorator';
import { ENScopeType } from '@prisma/client';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = this.reflector.getAllAndOverride<IPermissionsMetadata>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const scopeMetadata = this.reflector.getAllAndOverride<IScopesMetadata>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if ((!metadata || metadata.permissions.length === 0) && !scopeMetadata) {
      return true;
    }

    const req = this.getRequest(context);

    // Make sure ActiveMembershipGuard ran before this guard
    if (!req.activeMembership) {
      throw new ForbiddenException(
        'Active membership context required to perform this action',
      );
    }

    // Read the pre-calculated effective permissions calculated by ActiveMembershipGuard
    const effectivePermissions = new Set<string>(req.effectivePermissions || []);
    const requiredPermissions = metadata?.permissions ?? [];

    const hasPermission = !metadata || metadata.strict
      ? requiredPermissions.every((code) => effectivePermissions.has(code))
      : requiredPermissions.some((code) => effectivePermissions.has(code));

    if (!hasPermission) {
      const missingPerms = requiredPermissions
        .filter((code) => !effectivePermissions.has(code))
        .join(', ');
      throw new ForbiddenException(
        `Missing required permission(s): ${missingPerms}`,
      );
    }

    // If target resource is in route parameters, verify specific scope
    if (req.accessContext && metadata) {
      const gqlArgs = this.getGraphqlArgs(context);
      const teamId =
        (req.params?.teamId as string) || (gqlArgs?.teamId as string) || undefined;
      const personId =
        (req.params?.personId as string) ||
        (req.params?.athleteId as string) ||
        (gqlArgs?.personId as string) ||
        (gqlArgs?.athleteId as string) ||
        undefined;

      if (teamId || personId) {
        const failedScope = requiredPermissions.find(
          (code) => !req.accessContext!.allows(code, { teamId, personId }),
        );
        if (failedScope) {
          throw new ForbiddenException(
            `Access denied for permission '${failedScope}' on this resource scope.`,
          );
        }
      }
    }

    if (scopeMetadata) {
      const gqlArgs = this.getGraphqlArgs(context);
      const teamId =
        (req.params?.teamId as string) || (gqlArgs?.teamId as string) || undefined;
      const personId =
        (req.params?.personId as string) ||
        (req.params?.athleteId as string) ||
        (gqlArgs?.personId as string) ||
        (gqlArgs?.athleteId as string) ||
        undefined;
      const target = { teamId, personId };
      const permissions = requiredPermissions.length
        ? requiredPermissions
        : Array.from(effectivePermissions);
      const hasRequiredScope = permissions.some((permission) =>
        scopeMetadata.scopes.some((scope) =>
          req.accessContext!.allowsScope(permission, scope as ENScopeType, target),
        ),
      );
      if (!hasRequiredScope) {
        throw new ForbiddenException('Access denied for the required resource scope.');
      }
    }

    return true;
  }

  private getRequest(context: ExecutionContext) {
    return getRequestFromContext(context);
  }

  private getGraphqlArgs(context: ExecutionContext): Record<string, unknown> {
    try {
      return GqlExecutionContext.create(context).getArgs() ?? {};
    } catch {
      return {};
    }
  }
}
