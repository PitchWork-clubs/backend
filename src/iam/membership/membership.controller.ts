import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { CreateMembershipDto } from './membership.dto';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';
import { ActiveMembershipGuard, TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { CurrentMembership } from '@common/decorators/current-user';

@Controller('memberships')
@UseGuards(PassportJwtGuard, EmailVerifiedGuard, ActiveMembershipGuard, PermissionsGuard)
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  @Get('me')
  getMine(@CurrentMembership() membership: TActiveMembershipPayload) {
    return membership;
  }

  @Get()
  @RequirePermissions(true, ['MEMBERSHIP_READ'])
  list(@CurrentMembership() membership: TActiveMembershipPayload) {
    return this.membershipService.listMemberships(membership.clubId);
  }

  @Get(':membershipId')
  @RequirePermissions(true, ['MEMBERSHIP_READ'])
  get(
    @Param('membershipId') membershipId: string,
    @CurrentMembership() membership: TActiveMembershipPayload,
  ) {
    return this.membershipService.getMembership(membershipId, membership.clubId);
  }

  @Post()
  @RequirePermissions(true, ['MEMBERSHIP_WRITE'])
  create(
    @Body() input: CreateMembershipDto,
    @CurrentMembership() membership: TActiveMembershipPayload,
  ) {
    return this.membershipService.createMembership(input.personId, membership.clubId, input.types);
  }

  @Post(':membershipId/end')
  @RequirePermissions(true, ['MEMBERSHIP_SUSPEND', 'MEMBERSHIP_WRITE'])
  end(
    @Param('membershipId') membershipId: string,
    @CurrentMembership() membership: TActiveMembershipPayload,
  ) {
    return this.membershipService.endMembership(membershipId, membership);
  }
}
