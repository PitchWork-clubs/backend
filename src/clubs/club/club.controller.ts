import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ClubService } from './club.service';
import { CreateClubDto, RejectClubDto, UpdateClubDto } from './club.dto';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';
import { ActiveMembershipGuard, TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { ClientTimezone, CurrentMembership, CurrentUser } from '@common/decorators/current-user';
import { TUserJWTPayload } from '@iam/auth/strategy/jwt.strategy';

@Controller('clubs')
@UseGuards(PassportJwtGuard, EmailVerifiedGuard)
export class ClubController {
  constructor(private readonly clubService: ClubService) {}

  @Get('mine')
  getMyClubs(@CurrentUser() user: TUserJWTPayload) {
    return this.clubService.myClubs(user.person_id);
  }

  @Post()
  createClub(
    @Body() input: CreateClubDto,
    @CurrentUser() user: TUserJWTPayload,
    @ClientTimezone() timezone: string | null,
  ) {
    return this.clubService.createClub(input, user.user_id, timezone ?? undefined);
  }

  @Get(':clubId')
  @UseGuards(ActiveMembershipGuard)
  getClub(@CurrentMembership() membership: TActiveMembershipPayload) {
    return membership.club;
  }

  @Patch(':clubId')
  @UseGuards(ActiveMembershipGuard, PermissionsGuard)
  @RequirePermissions(true, ['CLUB_WRITE'])
  updateClub(
    @Body() input: UpdateClubDto,
    @CurrentMembership() membership: TActiveMembershipPayload,
    @ClientTimezone() timezone: string | null,
  ) {
    return this.clubService.updateClub(input, membership, timezone ?? undefined);
  }

  @Post(':clubId/verify')
  verifyClub(@Param('clubId') clubId: string, @CurrentUser() user: TUserJWTPayload) {
    return this.clubService.verifyClub(clubId, user.user_id);
  }

  @Post(':clubId/reject')
  rejectClub(
    @Param('clubId') clubId: string,
    @Body() input: RejectClubDto,
    @CurrentUser() user: TUserJWTPayload,
  ) {
    return this.clubService.rejectClub(clubId, user.user_id, input.reason);
  }
}
