import { ENGender } from '@prisma/client';
import { IntersectionType } from '@nestjs/mapped-types';
import {
  IsEmail,
  IsString,
  MinLength,
  IsDate,
  MaxDate,
  IsEnum,
  IsISO31661Alpha2,
  ValidateIf,
  IsPhoneNumber,
  IsOptional,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PhoneNumberFormat, PhoneNumberUtil } from 'google-libphonenumber';
import * as nationalities from 'i18n-nationality';
import * as countries from 'i18n-iso-countries';
import * as isoCountry from 'i18n-iso-countries/langs/en.json';
import * as isoLang from 'i18n-nationality/langs/en.json';

nationalities.registerLocale(isoLang);
countries.registerLocale(isoCountry);

const phoneUtil = PhoneNumberUtil.getInstance();

function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  try {
    const parsed = phoneUtil.parseAndKeepRawInput(trimmed);
    return phoneUtil.format(parsed, PhoneNumberFormat.E164);
  } catch {
    // Leave invalid input intact so class-validator can return the validation error.
    return trimmed;
  }
}

export class RegisteringPersonDto {
  @Transform(({ value }: { value: string | undefined }) =>
    value?.trim().toLowerCase(),
  )
  @IsString()
  firstName!: string;

  @Transform(({ value }: { value: string | undefined }) =>
    value?.trim().toLowerCase(),
  )
  @IsString()
  lastName!: string;

  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date(), {
    message: 'Date of birth cannot be in the future',
  })
  dob!: Date;

  @IsString()
  @Transform(({ value }: { value: string | undefined }) =>
    value?.trim().toLowerCase(),
  )
  @Transform(({ value }: { value: string | undefined }) => {
    if (typeof value !== 'string') return value;

    const nationalityCode = nationalities.getAlpha2Code(value, 'en');
    const countryCode = countries.getAlpha2Code(value, 'en');

    if (nationalityCode) return nationalityCode.toUpperCase();
    if (countryCode) return countryCode.toUpperCase();

    return value.toUpperCase();
  })
  @IsISO31661Alpha2({ message: 'Invalid Nationality' })
  nationality!: string;

  @IsEnum(ENGender, { message: 'Gender must be Male or Female' })
  gender!: ENGender;
}

export class RegisterUserDto {
  @ValidateIf((o) => !o.phone || o.email)
  @Transform(({ value }: { value: string }) => value?.trim().toLowerCase())
  @IsString()
  @IsEmail()
  email?: string;

  @ValidateIf((o) => !o.email || o.phone)
  @Transform(({ value }: { value: string }) => normalizePhone(value))
  @IsString()
  @IsPhoneNumber(undefined, { message: 'Invalid Phone Number' })
  phone?: string;

  @IsString()
  @MinLength(5)
  password!: string;

  @IsOptional()
  @Transform(({ value }: { value: string | undefined }) => value?.trim())
  @IsString()
  invitationToken?: string;
}

export class RegisterUserPersonDto extends IntersectionType(
  RegisteringPersonDto,
  RegisterUserDto,
) {}

export class LoginDto {
  @ValidateIf((value) => !value.phone || value.email)
  @IsOptional()
  @Transform(({ value }: { value: string | undefined }) =>
    value?.trim().toLowerCase(),
  )
  @IsEmail()
  email?: string;

  @ValidateIf((value) => !value.email || value.phone)
  @IsOptional()
  @Transform(({ value }: { value: string | undefined }) =>
    normalizePhone(value),
  )
  @IsPhoneNumber(undefined, { message: 'Invalid Phone Number' })
  phone?: string;

  @IsString()
  @MinLength(5)
  password!: string;
}

export class VerifyIdentifierDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  token?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed.includes('@')) return trimmed.toLowerCase();
    return normalizePhone(trimmed);
  })
  @IsString()
  identifier?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  code?: string;
}

export class ResendVerificationDto {
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed.includes('@')) return trimmed.toLowerCase();
    return normalizePhone(trimmed);
  })
  @IsString()
  identifier!: string;
}

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
