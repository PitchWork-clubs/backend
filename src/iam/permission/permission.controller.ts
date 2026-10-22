import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { GrantPermissionDto, RevokePermissionDto } from './permission.dto';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';
import { ActiveMembershipGuard, TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { CurrentMembership, CurrentUser } from '@common/decorators/current-user';
import { TUserJWTPayload } from '@iam/auth/strategy/jwt.strategy';

@Controller('permissions')
@UseGuards(PassportJwtGuard, EmailVerifiedGuard, ActiveMembershipGuard, PermissionsGuard)
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get('mine')
  getMine(@CurrentMembership() membership: TActiveMembershipPayload) {
    return membership.membershipPermissions;
  }

  @Post('memberships/:membershipId/grant')
  @RequirePermissions(true, ['PERMISSION_ASSIGN'])
  grant(@Param('membershipId') membershipId: string, @Body() input: GrantPermissionDto, @CurrentMembership() membership: TActiveMembershipPayload) {
    return this.permissionService.grantDirectPermission(membershipId, input.permissionCode, undefined, undefined, membership);
  }

  @Post('memberships/:membershipId/revoke')
  @RequirePermissions(true, ['PERMISSION_REVOKE'])
  revoke(@Param('membershipId') membershipId: string, @Body() input: RevokePermissionDto, @CurrentMembership() membership: TActiveMembershipPayload, @CurrentUser() user: TUserJWTPayload) {
    return this.permissionService.revokeDirectPermission(membershipId, input.permissionCode, user.user_id, undefined, undefined, membership);
  }
}
