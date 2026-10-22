import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { IsCuid2 } from '@common/validators/is-cuid.validator';
import { ENMembershipStatus, ENMembershipType } from '@prisma/client';
import { Expose, Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsPhoneNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Club } from '@generated/prisma-nestjs-graphql/club/club.model';
import { ENMembershipStatus as GqlENMembershipStatus } from '@generated/prisma-nestjs-graphql/prisma/en-membership-status.enum';
import { ENMembershipType as GqlENMembershipType } from '@generated/prisma-nestjs-graphql/prisma/en-membership-type.enum';

@InputType()
export class AcceptInvitationInput {
  @Field(() => String)
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  @MinLength(5, { message: 'Invalid token' })
  token!: string;
}

export { AcceptInvitationInput as AcceptInvitationDto };

@InputType()
export class InviteUserInput {
  @Field(() => String, { nullable: true })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @ValidateIf((o) => !o.invitee_phone)
  @IsEmail()
  @IsOptional()
  invitee_email!: string;

  @Field(() => String, { nullable: true })
  @Transform(({ value }) => value?.trim())
  @ValidateIf((o) => !o.invitee_email)
  @IsPhoneNumber(undefined, { message: 'Invalid phone number' })
  @IsOptional()
  invitee_phone?: string;

  @Field(() => GqlENMembershipType)
  @IsEnum(ENMembershipType)
  type!: ENMembershipType;

  @Field(() => String, { nullable: true })
  @ValidateIf((o) => o.type === ENMembershipType.ATHLETE)
  @IsNotEmpty({ message: 'teamId is required when inviting an athlete' })
  @IsCuid2()
  teamId?: string;
}

export { InviteUserInput as InviteUserDto };

@InputType()
export class CreateMembershipInput {
  @Field(() => [GqlENMembershipType])
  @IsEnum(ENMembershipType, { each: true })
  @IsNotEmpty()
  types!: ENMembershipType[];

  @Field(() => String)
  @IsNotEmpty()
  @IsCuid2()
  personId!: string;
}

export { CreateMembershipInput as CreateMembershipDto };

@InputType()
export class UpdateMembershipInput {
  @Field(() => [GqlENMembershipType], { nullable: true })
  @IsEnum(ENMembershipType, { each: true })
  @IsOptional()
  types?: ENMembershipType[];

  @Field(() => GqlENMembershipStatus, { nullable: true })
  @IsEnum(ENMembershipStatus)
  @IsOptional()
  status?: ENMembershipStatus;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  endReason?: string;
}

export { UpdateMembershipInput as UpdateMembershipDto };

@ObjectType()
export class InvitationResponse {
  @Field(() => Boolean)
  success!: boolean;

  @Field(() => String)
  message!: string;
}

@ObjectType()
export class MyMembershipOutput {
  @Field(() => String)
  @Expose()
  id!: string;

  @Field(() => GqlENMembershipStatus)
  @Expose()
  status!: ENMembershipStatus;

  @Field(() => Date)
  @Expose()
  joinedAt!: Date;

  @Field(() => Club, { nullable: true })
  @Expose()
  club?: Club;

  @Field(() => [String])
  @Expose()
  @Transform(({ obj }) => obj.roles?.map((r: any) => r.role?.code ?? r) || [])
  roles!: string[];

  @Field(() => [String])
  @Expose()
  permissions!: string[];

  constructor(membership: any, effectivePermissions: string[]) {
    Object.assign(this, membership);
    this.roles = membership.roles?.map((r: any) => r.role?.code ?? r) || [];
    this.permissions = effectivePermissions;
  }
}

export { MyMembershipOutput as MyMembershipResponseDto };
