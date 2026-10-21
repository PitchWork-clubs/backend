import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, UseInterceptors } from '@nestjs/common';
import { ClubService } from './club.service';
import { Club } from '@generated/prisma-nestjs-graphql/club/club.model';
import { CreateClubInput, UpdateClubInput } from './club.dto';
import { PassportJwtGuard } from '@common/guards/passport.guard';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';
import {
  ActiveMembershipGuard,
  TActiveMembershipPayload,
} from '@common/guards/active-membership.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import {
  ClientTimezone,
  CurrentMembership,
  CurrentUser,
} from '@common/decorators/current-user';
import { TUserJWTPayload } from '@iam/auth/strategy/jwt.strategy';
import { CloudinaryUploadInterceptor } from '../../media/cloudinary/cloudinary.interceptor';

@Resolver(() => Club)
@UseGuards(PassportJwtGuard, EmailVerifiedGuard)
export class ClubResolver {
  constructor(private readonly clubService: ClubService) {}

  @Query(() => Club, { name: 'myClub', nullable: true })
  @UseGuards(ActiveMembershipGuard)
  async getMyClub(
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
  ) {
    return currentMembership?.club;
  }

  @Query(() => [Club], { name: 'myClubs' })
  async getMyClubs(@CurrentUser() currentUser: TUserJWTPayload) {
    return this.clubService.myClubs(currentUser.person_id);
  }

  @Mutation(() => Club, { name: 'createClub' })
  @UseInterceptors(CloudinaryUploadInterceptor)
  async createClub(
    @Args('input') input: CreateClubInput,
    @CurrentUser() currentUser: TUserJWTPayload,
    @ClientTimezone() timezone: string | null,
  ) {
    return this.clubService.createClub(
      input,
      currentUser.user_id,
      timezone ?? undefined,
    );
  }

  @Mutation(() => Club, { name: 'updateClub' })
  @UseInterceptors(CloudinaryUploadInterceptor)
  @UseGuards(ActiveMembershipGuard, PermissionsGuard)
  @RequirePermissions(true, ['CLUB_WRITE'])
  async updateClub(
    @Args('input') input: UpdateClubInput,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
    @ClientTimezone() timezone: string | null,
  ) {
    return this.clubService.updateClub(
      input,
      currentMembership,
      timezone ?? undefined,
    );
  }

  @Mutation(() => Club, { name: 'verifyClub' })
  async verifyClub(
    @Args('clubId') clubId: string,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.clubService.verifyClub(clubId, currentUser.user_id);
  }

  @Mutation(() => Club, { name: 'rejectClub' })
  async rejectClub(
    @Args('clubId') clubId: string,
    @Args('reason', { nullable: true }) reason: string | undefined,
    @CurrentUser() currentUser: TUserJWTPayload,
  ) {
    return this.clubService.rejectClub(clubId, currentUser.user_id, reason);
  }

  @Mutation(() => Boolean, { name: 'archiveClub' })
  @UseGuards(ActiveMembershipGuard, PermissionsGuard)
  @RequirePermissions(true, ['CLUB_DELETE'])
  async archiveClub(
    @Args('clubId') clubId: string,
    @CurrentMembership() currentMembership: TActiveMembershipPayload,
  ) {
    await this.clubService.archiveClub(clubId, currentMembership.id);
    return true;
  }
}
