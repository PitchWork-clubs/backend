import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { InvitationService } from './invitation.service';
import {
  AcceptInvitationDto,
  InviteUserDto,
} from '../membership/membership.dto';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';
import {
  ActiveMembershipGuard,
  TActiveMembershipPayload,
} from '@common/guards/active-membership.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { CurrentMembership, CurrentUser } from '@common/decorators/current-user';

@Controller()
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Post(['invitation/send', 'clubs/:clubId/invitations'])
  @UseGuards(
    PassportJwtGuard,
    EmailVerifiedGuard,
    ActiveMembershipGuard,
    PermissionsGuard,
  )
  @RequirePermissions(true, ['MEMBERSHIP_WRITE'])
  async sendInvitation(
    @CurrentMembership() activeMembership: TActiveMembershipPayload,
    @Body() inviteData: InviteUserDto,
  ) {
    return this.invitationService.inviteUser(activeMembership, inviteData);
  }

  @Get('invitations/preview')
  async previewInvitation(@Query('token') token: string) {
    return this.invitationService.previewInvitation(token);
  }

  @Post('invitations/accept')
  @UseGuards(PassportJwtGuard)
  async acceptInvitation(
    @CurrentUser() user: { user_id: string },
    @Body() acceptData: AcceptInvitationDto,
  ) {
    return this.invitationService.acceptInvitation(user.user_id, acceptData);
  }
}
