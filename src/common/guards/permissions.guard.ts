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

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = this.reflector.getAllAndOverride<IPermissionsMetadata>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If endpoint has no @RequirePermissions() decorator, allow access
    if (
      !metadata ||
      !metadata.permissions ||
      metadata.permissions.length === 0
    ) {
      return true;
    }

    const { strict, permissions: requiredPermissions } = metadata;
    const req = this.getRequest(context);

    // Make sure ActiveMembershipGuard ran before this guard
    if (!req.activeMembership) {
      throw new ForbiddenException(
        'Active membership context required to perform this action',
      );
    }

    // Read the pre-calculated effective permissions calculated by ActiveMembershipGuard
    const effectivePermissions = new Set<string>(
      req.effectivePermissions || [],
    );

    // Evaluate strict (ALL) vs non-strict (AT LEAST ONE)
    const hasPermission = strict
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
    if (req.accessContext) {
      const teamId = (req.params?.teamId as string) || undefined;
      const personId =
        (req.params?.personId as string) ||
        (req.params?.athleteId as string) ||
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

    return true;
  }

  private getRequest(context: ExecutionContext) {
    return getRequestFromContext(context);
  }
}
