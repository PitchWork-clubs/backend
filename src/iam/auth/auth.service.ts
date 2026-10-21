import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  ChangePasswordDto,
  DisableTwoFactorDto,
  LoginDto,
  PasswordForgotDto,
  PasswordResetDto,
  RegisterUserPersonDto,
  ResendVerificationDto,
  TwoFactorCodeDto,
  VerifyIdentifierDto,
} from './auth.dto';
import * as argon2 from 'argon2';
import {
  ENIdentifierType,
  ENAuditLogResult,
  ENFeature,
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
import { AuditLogsService } from '@infrastructure/audit-logs/audit-logs.service';
import { CryptoService } from '@common/crypto/crypto.service';
import { burnPasswordCheck, verifyPassword } from '@common/utils/password.util';
import { hashPassword } from '@common/utils/password.util';
import { randomBytes } from 'node:crypto';
import {
  generateApplicationToken,
  generateOtp,
  computeTokenHash,
} from '@common/utils/token-hash.util';

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
    private readonly auditLogsService: AuditLogsService,
    private readonly cryptoService: CryptoService,
  ) {}

  public returnSanitizedUserData(user: TUserWithPerson): TUserData {
    return {
      user_id: user.id,
      person_id: user.person.id,
      name: `${user.person.firstName} ${user.person.lastName}`,
      email: '',
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
      throw new BadRequestException(
        'You must be at least 18 years old to register.',
      );
    }

    const hashedPassword = await argon2.hash(registerDto.password);
    const tokenSecret =
      this.configService.getOrThrow<string>('TOKEN_HASH_SECRET');
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
          | (Prisma.InvitationGetPayload<{}> & {
              email: string | null;
              phone: string | null;
            })
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
            isEmailVerified:
              primaryType === ENIdentifierType.EMAIL && isVerified,
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
              expiresAt: new Date(
                now.getTime() + (email ? 30 : 10) * 60 * 1000,
              ),
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
          await this.sendDuplicateRegistrationNotice(email).catch(
            () => undefined,
          );
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

  private readonly verificationFailureMessage = 'Invalid or expired code';
  private readonly resendMessage =
    'If the identifier is unverified, verification instructions will be sent.';

  private verificationFailure(): never {
    throw new BadRequestException(this.verificationFailureMessage);
  }

  private identifierType(value: string): ENIdentifierType {
    return value.includes('@')
      ? ENIdentifierType.EMAIL
      : ENIdentifierType.PHONE;
  }

  public async verifyIdentifier(dto: VerifyIdentifierDto) {
    const secret = this.configService.getOrThrow<string>('TOKEN_HASH_SECRET');
    const submittedToken = dto.token?.trim();
    const submittedCode = dto.code?.trim().toUpperCase();
    let token: any;

    if (submittedToken) {
      token = await this.prisma.userToken.findUnique({
        where: { hash: computeTokenHash(secret, submittedToken) },
        include: { identifier: true },
      });
    } else if (dto.identifier && submittedCode) {
      const identifier = await this.prisma.userIdentifier.findUnique({
        where: {
          type_value: {
            type: this.identifierType(dto.identifier),
            value: dto.identifier,
          },
        },
      });

      if (identifier) {
        token = await this.prisma.userToken.findFirst({
          where: {
            identifierId: identifier.id,
            type:
              identifier.type === ENIdentifierType.EMAIL
                ? ENUserTokenType.EMAIL_VERIFICATION
                : ENUserTokenType.PHONE_VERIFICATION,
            status: 'PENDING',
            usedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          include: { identifier: true },
        });

        if (token) {
          // Count the attempt before comparing the submitted code.
          await this.prisma.userToken.updateMany({
            where: {
              id: token.id,
              status: 'PENDING',
              usedAt: null,
            },
            data: {
              attempts: { increment: 1 },
            },
          });
          token.attempts += 1;
        }
      }
    }

    const codeMatches =
      Boolean(submittedToken) ||
      (Boolean(submittedCode) &&
        computeTokenHash(secret, submittedCode!) === token?.hash);

    if (
      !token ||
      !token.identifier ||
      token.type === ENUserTokenType.CHANGE_PASSWORD ||
      token.type === ENUserTokenType.LOGIN_OTP ||
      token.status !== 'PENDING' ||
      token.usedAt ||
      token.expiresAt <= new Date() ||
      (submittedToken && token.attempts >= 5) ||
      !codeMatches
    ) {
      if (token && !submittedToken && token.attempts >= 5) {
        await this.prisma.userToken.updateMany({
          where: { id: token.id, status: 'PENDING', usedAt: null },
          data: { status: 'DISRUPTED' },
        });
      }
      this.verificationFailure();
    }

    const now = this.timezoneService.nowUtc();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.userToken.updateMany({
        where: {
          id: token.id,
          status: 'PENDING',
          usedAt: null,
          expiresAt: { gt: now },
          // A correct code may be accepted on the fifth attempt. Failed
          // attempt five is disrupted before reaching this transaction.
          attempts: { lt: 6 },
        },
        data: { usedAt: now },
      });

      if (claimed.count !== 1) return false;

      const verified = await tx.userIdentifier.updateMany({
        where: { id: token.identifier.id, verifiedAt: null },
        data: { verifiedAt: now },
      });

      if (token.identifier.type === ENIdentifierType.EMAIL) {
        await tx.user.update({
          where: { id: token.userId },
          data: { isEmailVerified: true },
        });
      }

      return verified.count === 1;
    });

    if (!result) this.verificationFailure();

    return { message: 'Identifier verified successfully.' };
  }

  public async resendVerification(dto: ResendVerificationDto) {
    const identifierValue = dto.identifier?.trim();
    if (!identifierValue) return { message: this.resendMessage };

    const type = this.identifierType(identifierValue);
    const now = this.timezoneService.nowUtc();
    const secret = this.configService.getOrThrow<string>('TOKEN_HASH_SECRET');
    let delivery:
      | {
          type: ENIdentifierType;
          value: string;
          firstName: string;
          token: string;
        }
      | undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const identifier = await tx.userIdentifier.findUnique({
        where: { type_value: { type, value: identifierValue } },
        include: { user: { include: { person: true } } },
      });

      if (!identifier || identifier.verifiedAt) return false;

      const latest = await tx.userToken.findFirst({
        where: {
          identifierId: identifier.id,
          type:
            type === ENIdentifierType.EMAIL
              ? ENUserTokenType.EMAIL_VERIFICATION
              : ENUserTokenType.PHONE_VERIFICATION,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (latest && now.getTime() - latest.createdAt.getTime() < 60_000) {
        return false;
      }

      const generated =
        type === ENIdentifierType.EMAIL
          ? generateApplicationToken(secret)
          : generateOtp(secret);
      const tokenType =
        type === ENIdentifierType.EMAIL
          ? ENUserTokenType.EMAIL_VERIFICATION
          : ENUserTokenType.PHONE_VERIFICATION;

      await tx.userToken.updateMany({
        where: {
          identifierId: identifier.id,
          type: tokenType,
          status: 'PENDING',
        },
        data: { status: 'DISRUPTED' },
      });
      await tx.userToken.create({
        data: {
          type: tokenType,
          hash: generated.hash,
          userId: identifier.userId,
          identifierId: identifier.id,
          expiresAt: new Date(
            now.getTime() +
              (type === ENIdentifierType.EMAIL ? 30 : 10) * 60_000,
          ),
        },
      });

      delivery = {
        type,
        value: identifierValue,
        firstName: identifier.user.person.firstName,
        token: 'token' in generated ? generated.token : generated.otp,
      };
      return true;
    });

    if (created && delivery) {
      if (delivery.type === ENIdentifierType.EMAIL) {
        await this.sendRegistrationVerificationEmail(
          delivery.value,
          delivery.firstName,
          delivery.token,
        );
      } else {
        await this.communicationService.sendSms(
          delivery.value,
          `Your Pitchwork verification code is ${delivery.token}. It expires in 10 minutes.`,
        );
      }
    }

    return { message: this.resendMessage };
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

  public async validateCredentials(
    loginDto: LoginDto,
    request?: { ip?: string; userAgent?: string },
  ) {
    const identifierValue =
      loginDto.email?.trim().toLowerCase() ?? loginDto.phone?.trim();
    const identifierType = loginDto.email
      ? ENIdentifierType.EMAIL
      : ENIdentifierType.PHONE;
    const invalidCredentials = async (userId?: string) => {
      await this.auditLogsService.createLog({
        category: ENFeature.ACCESS,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: userId,
        result: ENAuditLogResult.DENIED,
        metadata: { identifier: identifierValue },
      });
      throw new UnauthorizedException('Invalid credentials');
    };

    if (!identifierValue) {
      await burnPasswordCheck(loginDto.password);
      return invalidCredentials();
    }

    const identifier = await this.prisma.userIdentifier.findUnique({
      where: {
        type_value: { type: identifierType, value: identifierValue },
      },
      include: { user: { include: { person: true } } },
    });
    const user = identifier?.user;

    if (!user || user.isDeleted || !user.passwordHash) {
      await burnPasswordCheck(loginDto.password);
      return invalidCredentials(user?.id);
    }

    const now = this.timezoneService.nowUtc();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new HttpException(
        'Too many attempts, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordMatches = await verifyPassword(
      user.passwordHash,
      loginDto.password,
    );
    if (!passwordMatches) {
      const nextAttempts = user.failedLoginAttempts + 1;
      const lockedUntil =
        nextAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts >= 5 ? 0 : nextAttempts,
          lockedUntil,
        },
      });
      await this.auditLogsService.createLog({
        category: ENFeature.ACCESS,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        result: ENAuditLogResult.DENIED,
        metadata: { identifier: identifierValue, locked: nextAttempts >= 5 },
      });
      if (nextAttempts >= 5) {
        throw new HttpException(
          'Too many attempts, try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!identifier.verifiedAt) {
      throw new ForbiddenException('Identifier is not verified');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    if (user.isTwoFactorEnabled) {
      const challengeToken = await this.jwtService.signAsync(
        { sub: user.id, person_id: user.personId },
        { expiresIn: '5m', audience: '2fa-challenge' },
      );
      return { status: '2fa_required' as const, challengeToken };
    }

    return this.issueSession(user, identifierValue, request);
  }

  private async issueSession(
    user: TUserWithPerson,
    identifier: string,
    request?: { ip?: string; userAgent?: string },
  ) {
    const now = this.timezoneService.nowUtc();
    const sessionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshHash = computeTokenHash(
      this.configService.getOrThrow<string>('TOKEN_HASH_SECRET'),
      refreshToken,
    );

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: user.id,
          ip: request?.ip,
          userAgent: request?.userAgent,
          expiresAt: sessionExpiresAt,
        },
      });
      await tx.refreshToken.create({
        data: {
          hash: refreshHash,
          sessionId: created.id,
          expiresAt: sessionExpiresAt,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { lastLogin: now },
      });
      return created;
    });

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      sid: session.id,
      person_id: user.personId,
    });
    await this.auditLogsService.createLog({
      category: ENFeature.ACCESS,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      metadata: { identifier },
      doneById: user.id,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        user_id: user.id,
        person_id: user.personId,
        name: `${user.person.firstName} ${user.person.lastName}`,
        email: identifier,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }

  private async signAccessToken(
    userId: string,
    personId: string,
    sessionId: string,
  ) {
    return this.jwtService.signAsync({
      sub: userId,
      sid: sessionId,
      person_id: personId,
    });
  }

  public async refreshSession(refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = computeTokenHash(
      this.configService.getOrThrow<string>('TOKEN_HASH_SECRET'),
      refreshToken,
    );
    const token = await this.prisma.refreshToken.findUnique({
      where: { hash: tokenHash },
      include: {
        session: { include: { user: { include: { person: true } } } },
      },
    });
    const now = this.timezoneService.nowUtc();

    if (
      !token ||
      !token.session ||
      token.expiresAt <= now ||
      token.session.expiresAt <= now ||
      token.session.revokedAt
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (token.usedAt) {
      const reuseWindow = now.getTime() - token.usedAt.getTime();
      if (reuseWindow > 10_000) {
        await this.prisma.session.updateMany({
          where: { id: token.sessionId, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.auditLogsService.createLog({
          category: ENFeature.ACCESS,
          action: 'REFRESH_TOKEN_REUSE',
          entityType: 'Session',
          entityId: token.sessionId,
          result: ENAuditLogResult.DENIED,
          doneById: token.session.userId,
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const nextRefreshToken = randomBytes(32).toString('base64url');
    const nextHash = computeTokenHash(
      this.configService.getOrThrow<string>('TOKEN_HASH_SECRET'),
      nextRefreshToken,
    );
    const rotated = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return false;

      await tx.refreshToken.create({
        data: {
          hash: nextHash,
          sessionId: token.sessionId,
          expiresAt: token.session.expiresAt,
        },
      });
      await tx.session.update({
        where: { id: token.sessionId },
        data: { lastUsedAt: now },
      });
      return true;
    });

    if (!rotated) throw new UnauthorizedException('Invalid refresh token');

    return {
      accessToken: await this.signAccessToken(
        token.session.userId,
        token.session.user.personId,
        token.sessionId,
      ),
      refreshToken: nextRefreshToken,
    };
  }

  public async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.prisma.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: this.timezoneService.nowUtc() },
      });
    }
    await this.auditLogsService.createLog({
      category: ENFeature.ACCESS,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: userId,
      doneById: userId,
    });
    return { message: 'Logged out successfully' };
  }

  public async logoutAll(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.timezoneService.nowUtc() },
    });
    await this.auditLogsService.createLog({
      category: ENFeature.ACCESS,
      action: 'LOGOUT_ALL',
      entityType: 'User',
      entityId: userId,
      doneById: userId,
    });
    return { message: 'All sessions logged out successfully' };
  }

  public async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: this.timezoneService.nowUtc() },
    });
    if (result.count !== 1) {
      throw new ResourceNotFoundException('Session not found', 'Session');
    }
    return { message: 'Session revoked successfully' };
  }

  private readonly passwordFlowResponse = {
    message:
      'If the account is eligible, password reset instructions will be sent.',
  };

  private getIdentifierInput(dto: { email?: string; phone?: string }) {
    if (dto.email)
      return {
        type: ENIdentifierType.EMAIL,
        value: dto.email.trim().toLowerCase(),
      };
    if (dto.phone)
      return { type: ENIdentifierType.PHONE, value: dto.phone.trim() };
    return undefined;
  }

  private async sendPasswordResetEmail(
    email: string,
    firstName: string,
    token: string,
  ) {
    const appUrl = this.configService.getOrThrow<string>('APP_URL');
    const link = `${appUrl}/api/auth/password/reset?token=${encodeURIComponent(token)}`;
    await this.communicationService.sendEmail(
      email,
      'Reset your Pitchwork password',
      `Hello ${firstName},\n\nUse this link to reset your Pitchwork password:\n${link}\n\nThis link expires in 30 minutes.`,
      `<p>Hello ${firstName},</p><p><a href="${link}">Reset your Pitchwork password</a></p><p>This link expires in 30 minutes.</p>`,
    );
  }

  public async forgotPassword(dto: PasswordForgotDto) {
    const input = this.getIdentifierInput(dto);
    if (!input) return this.passwordFlowResponse;
    const now = this.timezoneService.nowUtc();
    const secret = this.configService.getOrThrow<string>('TOKEN_HASH_SECRET');
    let delivery:
      | {
          type: ENIdentifierType;
          value: string;
          firstName: string;
          token: string;
        }
      | undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const identifier = await tx.userIdentifier.findUnique({
        where: { type_value: input },
        include: { user: { include: { person: true } } },
      });
      if (
        !identifier ||
        !identifier.verifiedAt ||
        !identifier.user.passwordHash
      )
        return false;
      const latest = await tx.userToken.findFirst({
        where: {
          identifierId: identifier.id,
          type: ENUserTokenType.CHANGE_PASSWORD,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && now.getTime() - latest.createdAt.getTime() < 60_000)
        return false;
      const generated =
        identifier.type === ENIdentifierType.EMAIL
          ? generateApplicationToken(secret)
          : generateOtp(secret);
      const rawToken = 'token' in generated ? generated.token : generated.otp;
      await tx.userToken.updateMany({
        where: {
          identifierId: identifier.id,
          type: ENUserTokenType.CHANGE_PASSWORD,
          status: 'PENDING',
        },
        data: { status: 'DISRUPTED' },
      });
      await tx.userToken.create({
        data: {
          type: ENUserTokenType.CHANGE_PASSWORD,
          hash: generated.hash,
          userId: identifier.userId,
          identifierId: identifier.id,
          expiresAt: new Date(
            now.getTime() +
              (identifier.type === ENIdentifierType.EMAIL ? 30 : 10) * 60_000,
          ),
        },
      });
      delivery = {
        type: identifier.type,
        value: identifier.value,
        firstName: identifier.user.person.firstName,
        token: rawToken,
      };
      return true;
    });

    if (created && delivery) {
      if (delivery.type === ENIdentifierType.EMAIL) {
        await this.sendPasswordResetEmail(
          delivery.value,
          delivery.firstName,
          delivery.token,
        );
      } else {
        await this.communicationService.sendSms(
          delivery.value,
          `Your Pitchwork password reset code is ${delivery.token}. It expires in 10 minutes.`,
        );
      }
    }
    return this.passwordFlowResponse;
  }

  public async resetPassword(dto: PasswordResetDto) {
    const input = this.getIdentifierInput(dto);
    const secret = this.configService.getOrThrow<string>('TOKEN_HASH_SECRET');
    let token: any;
    if (input) {
      const identifier = await this.prisma.userIdentifier.findUnique({
        where: { type_value: input },
      });
      if (identifier) {
        token = await this.prisma.userToken.findFirst({
          where: {
            identifierId: identifier.id,
            type: ENUserTokenType.CHANGE_PASSWORD,
            status: 'PENDING',
            usedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          include: { identifier: true },
        });
      }
      if (token) {
        await this.prisma.userToken.updateMany({
          where: { id: token.id, status: 'PENDING', usedAt: null },
          data: { attempts: { increment: 1 } },
        });
        token.attempts += 1;
      }
    } else {
      token = await this.prisma.userToken.findUnique({
        where: { hash: computeTokenHash(secret, dto.token) },
        include: { identifier: true },
      });
    }

    const valid =
      token &&
      token.type === ENUserTokenType.CHANGE_PASSWORD &&
      token.status === 'PENDING' &&
      !token.usedAt &&
      token.expiresAt > new Date() &&
      token.attempts <= 5 &&
      computeTokenHash(secret, dto.token) === token.hash;
    if (!valid) {
      if (token && token.attempts >= 5) {
        await this.prisma.userToken.updateMany({
          where: { id: token.id, status: 'PENDING', usedAt: null },
          data: { status: 'DISRUPTED' },
        });
      }
      throw new BadRequestException('Invalid or expired code');
    }

    const now = this.timezoneService.nowUtc();
    const passwordHash = await hashPassword(dto.newPassword);
    const completed = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.userToken.updateMany({
        where: {
          id: token.id,
          status: 'PENDING',
          usedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: 6 },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return false;
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
    if (!completed) throw new BadRequestException('Invalid or expired code');
    await this.auditLogsService.createLog({
      category: ENFeature.ACCESS,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: token.userId,
      doneById: token.userId,
    });
    return { message: 'Password reset successfully' };
  }

  public async changePassword(
    userId: string,
    sessionId: string | undefined,
    dto: ChangePasswordDto,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user?.passwordHash ||
      !(await verifyPassword(user.passwordHash, dto.currentPassword))
    ) {
      throw new UnauthorizedException('Invalid current password');
    }
    if (await verifyPassword(user.passwordHash, dto.newPassword)) {
      throw new BadRequestException('New password must be different');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    const now = this.timezoneService.nowUtc();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: {
          userId,
          ...(sessionId ? { id: { not: sessionId } } : {}),
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    });
    await this.auditLogsService.createLog({
      category: ENFeature.ACCESS,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: userId,
      doneById: userId,
    });
    return { message: 'Password changed successfully' };
  }

  public async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identifiers: true },
    });
    if (!user) throw new ResourceNotFoundException('User not found', 'User');
    if (user.isTwoFactorEnabled)
      throw new BadRequestException(
        'Two-factor authentication is already enabled',
      );
    const account =
      user.identifiers.find((item) => item.type === ENIdentifierType.EMAIL)
        ?.value ?? user.id;
    const secret = this.cryptoService.generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: this.cryptoService.encrypt(secret) },
    });
    return {
      secret,
      otpauthUrl: this.cryptoService.createTotpUri(secret, account),
    };
  }

  private async getTwoFactorSecret(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { person: true },
    });
    if (!user?.twoFactorSecret)
      throw new BadRequestException(
        'Two-factor authentication is not configured',
      );
    return { user, secret: this.cryptoService.decrypt(user.twoFactorSecret) };
  }

  public async enableTwoFactor(userId: string, dto: TwoFactorCodeDto) {
    const { secret } = await this.getTwoFactorSecret(userId);
    if (!this.cryptoService.verifyTotp(secret, dto.code))
      throw new BadRequestException('Invalid authentication code');
    const { plainCodes, hashedCodes } =
      this.cryptoService.generateRecoveryCodes(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isTwoFactorEnabled: true },
      });
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.recoveryCode.createMany({
        data: hashedCodes.map((codeHash) => ({ userId, codeHash })),
      });
    });
    return {
      message: 'Two-factor authentication enabled',
      recoveryCodes: plainCodes,
    };
  }

  public async finishTwoFactorLogin(
    challengeToken: string,
    dto: TwoFactorCodeDto,
    request?: { ip?: string; userAgent?: string },
  ) {
    let payload: { sub: string; person_id: string };
    try {
      payload = await this.jwtService.verifyAsync(challengeToken, {
        audience: '2fa-challenge',
      });
    } catch {
      throw new UnauthorizedException('Invalid two-factor challenge');
    }
    const { user, secret } = await this.getTwoFactorSecret(payload.sub);
    let verified =
      user.isTwoFactorEnabled &&
      this.cryptoService.verifyTotp(secret, dto.code);
    if (!verified && user.isTwoFactorEnabled) {
      const recoveryHash = this.cryptoService.hashRecoveryCode(
        user.id,
        dto.code,
      );
      const recoveryCode = await this.prisma.recoveryCode.findFirst({
        where: { userId: user.id, codeHash: recoveryHash, usedAt: null },
      });
      if (recoveryCode) {
        const consumed = await this.prisma.recoveryCode.updateMany({
          where: { id: recoveryCode.id, usedAt: null },
          data: { usedAt: this.timezoneService.nowUtc() },
        });
        verified = consumed.count === 1;
      }
    }
    if (!verified) {
      throw new UnauthorizedException('Invalid authentication code');
    }
    return this.issueSession(user as TUserWithPerson, '2fa', request);
  }

  public async disableTwoFactor(userId: string, dto: DisableTwoFactorDto) {
    const { user, secret } = await this.getTwoFactorSecret(userId);
    if (
      !user.passwordHash ||
      !(await verifyPassword(user.passwordHash, dto.password)) ||
      !this.cryptoService.verifyTotp(secret, dto.code)
    ) {
      throw new UnauthorizedException('Invalid authentication credentials');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isTwoFactorEnabled: false, twoFactorSecret: null },
      });
      await tx.recoveryCode.deleteMany({ where: { userId } });
    });
    return { message: 'Two-factor authentication disabled' };
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
      include: {
        person: true,
        identifiers: {
          where: { verifiedAt: { not: null } },
          select: { id: true },
        },
      },
    });

    if (!user) throw new ResourceNotFoundException('User not found', 'User');

    // Email verification is retained for compatibility, while phone-only
    // accounts are also allowed once their identifier has been verified.
    return user.isEmailVerified || user.identifiers.length > 0;
  }
}
