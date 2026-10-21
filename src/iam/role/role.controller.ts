import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RoleService } from './role.service';
import { AssignRoleDto, CreateRoleDto, UpdateRoleDto } from './role.dto';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';
import { ActiveMembershipGuard, TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { CurrentMembership, CurrentUser } from '@common/decorators/current-user';
import { TUserJWTPayload } from '@iam/auth/strategy/jwt.strategy';

@Controller('roles')
@UseGuards(PassportJwtGuard, EmailVerifiedGuard, ActiveMembershipGuard, PermissionsGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermissions(true, ['ROLE_READ'])
  list(@CurrentMembership() membership: TActiveMembershipPayload) {
    return this.roleService.getRolesInClub(membership.clubId);
  }

  @Get(':roleId')
  @RequirePermissions(true, ['ROLE_READ'])
  get(@Param('roleId') roleId: string, @CurrentMembership() membership: TActiveMembershipPayload) {
    return this.roleService.getRole(roleId, membership.clubId, membership.id);
  }

  @Post()
  @RequirePermissions(true, ['ROLE_WRITE'])
  create(@Body() input: CreateRoleDto, @CurrentMembership() membership: TActiveMembershipPayload, @CurrentUser() user: TUserJWTPayload) {
    return this.roleService.createRole(input, membership.clubId, user.user_id);
  }

  @Patch(':roleId')
  @RequirePermissions(true, ['ROLE_WRITE'])
  update(@Param('roleId') roleId: string, @Body() input: UpdateRoleDto, @CurrentMembership() membership: TActiveMembershipPayload, @CurrentUser() user: TUserJWTPayload) {
    return this.roleService.updatedClubRole(roleId, input, membership.clubId, user.user_id);
  }

  @Delete(':roleId')
  @RequirePermissions(true, ['ROLE_DELETE'])
  remove(@Param('roleId') roleId: string, @CurrentMembership() membership: TActiveMembershipPayload, @CurrentUser() user: TUserJWTPayload) {
    return this.roleService.deleteRole(roleId, membership.clubId, user.user_id);
  }

  @Post('/memberships/:membershipId/assign')
  @RequirePermissions(true, ['ROLE_ASSIGN'])
  assign(@Param('membershipId') membershipId: string, @Body() input: AssignRoleDto, @CurrentMembership() membership: TActiveMembershipPayload, @CurrentUser() user: TUserJWTPayload) {
    return this.roleService.assignRole(membership, membershipId, input.roleCode, user.user_id, input.scope, input.scopeId);
  }

  @Post('/memberships/:membershipId/revoke')
  @RequirePermissions(true, ['ROLE_REVOKE'])
  revoke(@Param('membershipId') membershipId: string, @Body() input: AssignRoleDto, @CurrentMembership() membership: TActiveMembershipPayload, @CurrentUser() user: TUserJWTPayload) {
    return this.roleService.revokeRole(membership, membershipId, input.roleCode, user.user_id, input.scope, input.scopeId);
  }
}
