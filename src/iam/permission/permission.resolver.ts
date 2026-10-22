import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { MembershipPermission } from '@generated/prisma-nestjs-graphql/membership-permission/membership-permission.model';
import {
  GrantPermissionInput,
  RevokePermissionInput,
  SyncPermissionsOutput,
} from './permission.dto';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';
import {
  ActiveMembershipGuard,
  TActiveMembershipPayload,
} from '@common/guards/active-membership.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import {
  CurrentMembership,
  CurrentUser,
} from '@common/decorators/current-user';
import { TUserJWTPayload } from '../auth/strategy/jwt.strategy';

@Resolver(() => MembershipPermission)
@UseGuards(
  PassportJwtGuard,
  EmailVerifiedGuard,
  ActiveMembershipGuard,
  PermissionsGuard,
)
export class PermissionResolver {
  constructor(private readonly permissionService: PermissionService) {}

  @Query(() => [MembershipPermission], { name: 'myPermissions' })
  getMyPermissions(
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
  ) {
    return currentMembership?.membershipPermissions || [];
  }

  @Mutation(() => MembershipPermission, { name: 'grantPermission' })
  @RequirePermissions(true, ['PERMISSION_ASSIGN'])
  async grantPermission(
    @Args('membershipId') targetMembershipId: string,
    @Args('input') input: GrantPermissionInput,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.permissionService.grantDirectPermission(
      targetMembershipId,
      input.permissionCode,
      undefined,
      undefined,
      currentMembership,
      currentUser.user_id,
    );
  }

  @Mutation(() => SyncPermissionsOutput, {
    name: 'syncMembershipWithRolePermissions',
  })
  @RequirePermissions(true, ['PERMISSION_ASSIGN'])
  async syncMembershipWithRolePermissions(
    @Args('membershipId') targetMembershipId: string,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
  ) {
    return this.permissionService.SyncMembershipWithRolePermissions(
      targetMembershipId,
      currentMembership,
    );
  }

  @Mutation(() => Boolean, { name: 'revokePermission' })
  @RequirePermissions(true, ['PERMISSION_REVOKE'])
  async revokePermission(
    @Args('membershipId') targetMembershipId: string,
    @Args('input') input: RevokePermissionInput,
    @CurrentUser() currentUser: TUserJWTPayload,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
  ) {
    await this.permissionService.revokeDirectPermission(
      targetMembershipId,
      input.permissionCode,
      currentUser.user_id,
      undefined,
      undefined,
      currentMembership,
    );
    return true;
  }
}
