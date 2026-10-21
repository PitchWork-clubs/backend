import { Field, InputType } from '@nestjs/graphql';
import { ENMembershipType } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import * as countries from 'i18n-iso-countries';
import { Transform } from 'class-transformer';
import { IsImageUrl } from '@common/decorators/is-image-url.decorator';
import { IsValidTimezone } from '@common/validators/is-valid-timezone.validator';
import { ENMembershipType as GqlENMembershipType } from '@generated/prisma-nestjs-graphql/prisma/en-membership-type.enum';
import * as isoCountry from 'i18n-iso-countries/langs/en.json';

countries.registerLocale(isoCountry);

@InputType()
export class CreateClubInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 6, { message: 'Short name must be between 3 and 6 characters' })
  shortName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsImageUrl(['jpg', 'jpeg', 'png', 'webp'], {
    message: 'Logo must be a valid web image URL (JPG, JPEG, PNG, or WEBP)',
  })
  logo?: string;

  @Field(() => String)
  @IsString()
  @Transform(({ value }: { value: string | undefined }) => {
    if (!value || typeof value !== 'string') return value;

    const cleaned = value.trim().toLowerCase();
    const countryCode = countries.getAlpha2Code(cleaned, 'en');

    if (countryCode) return countryCode.toUpperCase();

    return cleaned.toUpperCase();
  })
  @IsISO31661Alpha2({ message: 'Invalid Country' })
  country!: string;

  @Field(() => [GqlENMembershipType])
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one membership type must be selected' })
  @IsEnum(ENMembershipType, {
    each: true,
    message: 'Each membership type must be of valid value',
  })
  membershipTypes!: ENMembershipType[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsValidTimezone({
    message: 'timezone must be a valid IANA timezone identifier',
  })
  timezone?: string;
}

export { CreateClubInput as CreateClubDto };

@InputType()
export class UpdateClubInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Length(3, 6, { message: 'Short name must be between 3 and 6 characters' })
  shortName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsImageUrl(['jpg', 'jpeg', 'png', 'webp'], {
    message: 'Logo must be a valid web image URL (JPG, JPEG, PNG, or WEBP)',
  })
  logo?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string | undefined }) => {
    if (typeof value !== 'string') return value;

    const cleaned = value.trim().toLowerCase();
    const countryCode = countries.getAlpha2Code(cleaned, 'en');

    if (countryCode) return countryCode.toUpperCase();

    return cleaned.toUpperCase();
  })
  @IsISO31661Alpha2({ message: 'Invalid Country' })
  country?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsValidTimezone({
    message: 'timezone must be a valid IANA timezone identifier',
  })
  timezone?: string;
}

export { UpdateClubInput as UpdateClubDto };

@InputType()
export class RejectClubInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export { RejectClubInput as RejectClubDto };
