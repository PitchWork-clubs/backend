import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { LoginDto, RegisterUserPersonDto } from './auth.dto';
import * as argon2 from 'argon2';
import {
  ENIdentifierType,
  ENInvitationStatus,
  ENUserTokenType,
  Prisma,
  User,
} from '@prisma/client';
import { parsePrismaError } from '@common/utils/error-handler';
import { JwtService } from '@nestjs/jwt';
import { TPayload, TUserData } from './auth.types';
import { Response } from 'express';
import { ResourceNotFoundException } from '@common/exceptions/resource-not-found';
import { TimezoneService } from '@common/timezone/timezone.service';
import { ConfigService } from '@nestjs/config';
import { CommunicationService } from '@infrastructure/communication/communication.service';
import { generateApplicationToken, generateOtp, computeTokenHash } from '@common/utils/token-hash.util';

export type TUserWithPerson = Prisma.UserGetPayload<{
  include: { person: true };
}>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly timezoneService: TimezoneService,
    private readonly configService: ConfigService,
    private readonly communicationService: CommunicationService,
  ) {}

  public returnSanitizedUserData(user: TUserWithPerson): TUserData {
    return {
      user_id: user.id,
      person_id: user.person.id,
      name: `${user.person.firstName} ${user.person.lastName}`,
      email: "",
      isEmailVerified: user.isEmailVerified,
    };
  }

  /**
   * A completely new user is going to register, we creae person - user records
   *
   * @param registerDto
   * @returns
   */
  public async registerUserPerson(registerDto: RegisterUserPersonDto) {
    const email = registerDto.email?.trim().toLowerCase();
    const phone = registerDto.phone?.trim();

    if (!email && !phone) {
      throw new BadRequestException('An email or phone number is required.');
    }

    const dob = new Date(registerDto.dob);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('A valid date of birth is required.');
    }

    const now = this.timezoneService.nowUtc();
    const adultCutoff = new Date(now);
    adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
    if (dob > adultCutoff) {
      throw new BadRequestException('You must be at least 18 years old to register.');
    }

    const hashedPassword = await argon2.hash(registerDto.password);
    const tokenSecret = this.configService.getOrThrow<string>('TOKEN_HASH_SECRET');
    const invitationHash = registerDto.invitationToken
      ? computeTokenHash(tokenSecret, registerDto.invitationToken)
      : undefined;

    const primaryType = email ? ENIdentifierType.EMAIL : ENIdentifierType.PHONE;
    const primaryValue = email ?? phone!;
    const tokenType = email
      ? ENUserTokenType.EMAIL_VERIFICATION
      : ENUserTokenType.PHONE_VERIFICATION;

    let verificationToken: string | undefined;
    let verificationHash: string | undefined;
    let userId: string;
    let personId: string;
    let isVerified = false;

    try {
      await this.prisma.$transaction(async (tx) => {
        let invitation:
          | (Prisma.InvitationGetPayload<{}> & { email: string | null; phone: string | null })
          | null = null;

        if (invitationHash) {
          invitation = await tx.invitation.findUnique({
            where: { tokenHash: invitationHash },
          });

          const invitationMatches =
            invitation &&
            invitation.status === ENInvitationStatus.PENDING &&
            invitation.expiresAt > now &&
            ((email && invitation.email?.toLowerCase() === email) ||
              (phone && invitation.phone === phone));

          if (!invitationMatches) {
            throw new BadRequestException('Invalid or expired invitation.');
          }
        }

        const verifiedAt = invitation ? now : null;
        isVerified = Boolean(verifiedAt);

        const newUser = await tx.user.create({
          data: {
            passwordHash: hashedPassword,
            isEmailVerified: primaryType === ENIdentifierType.EMAIL && isVerified,
            person: {
              create: {
                firstName: registerDto.firstName,
                lastName: registerDto.lastName,
                dob,
                nationality: registerDto.nationality,
                gender: registerDto.gender,
              },
            },
            identifiers: {
              create: {
                type: primaryType,
                value: primaryValue,
                isPrimary: true,
                verifiedAt,
              },
            },
          },
          include: { person: true, identifiers: true },
        });

        userId = newUser.id;
        personId = newUser.person.id;

        if (!isVerified) {
          if (primaryType === ENIdentifierType.EMAIL) {
            const generated = generateApplicationToken(tokenSecret);
            verificationToken = generated.token;
            verificationHash = generated.hash;
          } else {
            const generated = generateOtp(tokenSecret);
            verificationToken = generated.otp;
            verificationHash = generated.hash;
          }

          await tx.userToken.create({
            data: {
              type: tokenType,
              hash: verificationHash,
              userId: newUser.id,
              identifierId: newUser.identifiers[0].id,
              expiresAt: new Date(now.getTime() + (email ? 30 : 10) * 60 * 1000),
            },
          });
        }
      });

      if (!userId! || !personId!) {
        throw new BadRequestException('Registration failed.');
      }

      if (!isVerified && email && verificationToken) {
        await this.sendRegistrationVerificationEmail(
          email,
          registerDto.firstName,
          verificationToken,
        );
      }

      if (!isVerified && !email && phone && verificationToken) {
        await this.communicationService.sendSms(
          phone,
          `Your Pitchwork verification code is ${verificationToken}. It expires in 10 minutes.`,
        );
      }

      return {
        user_id: userId!,
        person_id: personId!,
        name: `${registerDto.firstName} ${registerDto.lastName}`,
        isEmailVerified: primaryType === ENIdentifierType.EMAIL && isVerified,
        verificationRequired: !isVerified,
        verificationChannel: email ? ('email' as const) : ('phone' as const),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Password hashing above intentionally happens before the transaction, so
        // duplicate registrations do not have a noticeably cheaper code path.
        if (email) {
          await this.sendDuplicateRegistrationNotice(email).catch(() => undefined);
        }
        return {
          duplicate: true as const,
          verificationRequired: true,
          verificationChannel: email ? ('email' as const) : ('phone' as const),
        };
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(parsePrismaError(error));
      }

      throw error;
    }
  }

  private async sendRegistrationVerificationEmail(
    email: string,
    firstName: string,
    token: string,
  ) {
    const appUrl = this.configService.getOrThrow<string>('APP_URL');
    const link = `${appUrl}/api/auth/email/verify-link?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
    await this.communicationService.sendEmail(
      email,
      'Verify your Pitchwork account',
      `Hello ${firstName},\n\nVerify your Pitchwork account by opening this link:\n${link}\n\nThis link expires in 30 minutes.`,
      `<p>Hello ${firstName},</p><p><a href="${link}">Verify your Pitchwork account</a></p><p>This link expires in 30 minutes.</p>`,
    );
  }

  private async sendDuplicateRegistrationNotice(email: string) {
    await this.communicationService.sendEmail(
      email,
      'Pitchwork registration request',
      'A registration attempt was made using this email address. If this was you, sign in or use the password recovery flow. If it was not you, no action is required.',
    );
  }

  public async getUserData(user_id: string, person_id: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: user_id,
        person: { id: person_id },
      },
      include: { person: true },
    });

    if (!user) throw new ResourceNotFoundException('User not found', 'User');

    return this.returnSanitizedUserData(user);
  }

  public async validateCredentials(loginDto: LoginDto) {
    try {
    } catch (error) {
      // If it's already an UnauthorizedException, rethrow it
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // For any other error from argon2, treat as invalid credentials
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  private async updateLastLogin(user: User) {
    return await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: this.timezoneService.nowUtc() },
    });
  }

  private async generateAccessToken(payload: TPayload) {
    return await this.jwtService.signAsync(payload);
  }

  public async assignCookie(payload: TPayload, res: Response) {
    const accessToken = await this.generateAccessToken(payload);

    res.cookie('accessToken', accessToken, {
      httpOnly: true, // Prevents client-side JS from reading the cookie (protects against XSS)
      secure: process.env.NODE_ENV === 'production', // Send over HTTPS only in production
      sameSite: 'strict', // Protects against CSRF attacks
      maxAge: 24 * 60 * 60 * 1000,
    });
  }

  public async userVerified(user_id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: user_id },
      include: { person: true },
    });

    if (!user) throw new ResourceNotFoundException('User not found', 'User');

    return user.isEmailVerified;
  }
}
