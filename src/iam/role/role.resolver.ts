import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { RoleService } from './role.service';
import { Role } from '@generated/prisma-nestjs-graphql/role/role.model';
import { MembershipRole } from '@generated/prisma-nestjs-graphql/membership-role/membership-role.model';
import { AssignRoleInput, CreateRoleInput, UpdateRoleInput } from './role.dto';
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

@Resolver(() => Role)
@UseGuards(
  PassportJwtGuard,
  EmailVerifiedGuard,
  ActiveMembershipGuard,
  PermissionsGuard,
)
export class RoleResolver {
  constructor(private readonly roleService: RoleService) {}

  @Query(() => [MembershipRole], { name: 'myRoles' })
  getMyRoles(@CurrentMembership() currentMembership: TActiveMembershipPayload) {
    return currentMembership?.membershipRoles || [];
  }

  @Query(() => [Role], { name: 'clubRoles' })
  @RequirePermissions(true, ['ROLE_READ'])
  async getClubRoles(
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
  ) {
    return this.roleService.getRolesInClub(currentMembership.clubId);
  }

  @Query(() => Role, { name: 'role' })
  async getRole(
    @Args('roleId') roleId: string,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
  ) {
    return this.roleService.getRole(
      roleId,
      currentMembership.clubId,
      currentMembership.id,
    );
  }

  @Mutation(() => Role, { name: 'createRole' })
  @RequirePermissions(true, ['ROLE_WRITE'])
  async createRole(
    @Args('input') input: CreateRoleInput,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.roleService.createRole(
      input,
      currentMembership.clubId,
      currentUser.user_id,
    );
  }

  @Mutation(() => Role, { name: 'updateRole' })
  @RequirePermissions(true, ['ROLE_WRITE'])
  async updateRole(
    @Args('roleId') roleId: string,
    @Args('input') input: UpdateRoleInput,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.roleService.updatedClubRole(
      roleId,
      input,
      currentMembership.clubId,
      currentUser.user_id,
    );
  }

  @Mutation(() => Role, { name: 'deleteRole' })
  @RequirePermissions(true, ['ROLE_DELETE'])
  async deleteRole(
    @Args('roleId') roleId: string,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.roleService.deleteRole(
      roleId,
      currentMembership.clubId,
      currentUser.user_id,
    );
  }

  @Mutation(() => Boolean, { name: 'assignRole' })
  @RequirePermissions(true, ['ROLE_ASSIGN'])
  async assignRole(
    @Args('membershipId') targetMembershipId: string,
    @Args('input') input: AssignRoleInput,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.roleService.assignRole(
      currentMembership,
      targetMembershipId,
      input.roleCode,
      currentUser.user_id,
    );
  }

  @Mutation(() => Boolean, { name: 'revokeRole' })
  @RequirePermissions(true, ['ROLE_REVOKE'])
  async revokeRole(
    @Args('membershipId') targetMembershipId: string,
    @Args('input') input: AssignRoleInput,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.roleService.revokeRole(
      currentMembership,
      targetMembershipId,
      input.roleCode,
      currentUser.user_id,
    );
  }
}
