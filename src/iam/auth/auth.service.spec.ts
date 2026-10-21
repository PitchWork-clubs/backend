import { ENGender, ENIdentifierType, ENUserTokenType } from '@prisma/client';
import { AuthService } from './auth.service';
import { hashPassword } from '@common/utils/password.util';
import { computeTokenHash } from '@common/utils/token-hash.util';

describe('AuthService authentication lifecycle', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const phone = '+31612345678';
  const user = {
    id: 'user-1',
    personId: 'person-1',
    passwordHash: null,
    isDeleted: false,
    isEmailVerified: false,
    isTwoFactorEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    person: {
      id: 'person-1',
      firstName: 'Test',
      lastName: 'User',
    },
  };

  function createService() {
    const sentSms: string[] = [];
    const tx = {
      invitation: { findUnique: jest.fn() },
      user: {
        create: jest.fn().mockResolvedValue({ ...user, identifiers: [{ id: 'identifier-1' }], person: user.person }),
        update: jest.fn(),
      },
      userToken: { create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userIdentifier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      session: { create: jest.fn().mockResolvedValue({ id: 'session-1' }) },
      refreshToken: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
      userIdentifier: { findUnique: jest.fn() },
      userToken: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    const communication = {
      sendSms: jest.fn(async (_to: string, message: string) => sentSms.push(message)),
      sendEmail: jest.fn(),
    };
    const service = new AuthService(
      prisma as any,
      { signAsync: jest.fn().mockResolvedValue('access-token') } as any,
      { nowUtc: jest.fn().mockReturnValue(now) } as any,
      { getOrThrow: jest.fn().mockReturnValue('test-secret') } as any,
      communication as any,
      { createLog: jest.fn() } as any,
      {} as any,
    );
    return { service, prisma, tx, communication, sentSms };
  }

  it('registers a phone user, stores a verification token, and sends an OTP', async () => {
    const { service, tx, communication, sentSms } = createService();

    const result = await service.registerUserPerson({
      firstName: 'Test',
      lastName: 'User',
      dob: new Date('1990-01-01'),
      nationality: 'NL',
      gender: ENGender.MALE,
      phone,
      password: 'correct-password',
    } as any);

    expect(result).toMatchObject({
      user_id: 'user-1',
      person_id: 'person-1',
      verificationRequired: true,
      verificationChannel: 'phone',
    });
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.userToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: ENUserTokenType.PHONE_VERIFICATION,
          userId: 'user-1',
        }),
      }),
    );
    expect(communication.sendSms).toHaveBeenCalledWith(phone, expect.any(String));
    expect(sentSms[0]).toMatch(/verification code/);
  });

  it('verifies the latest phone OTP atomically and marks the identifier verified', async () => {
    const { service, prisma, tx } = createService();
    const secret = 'test-secret';
    const code = 'D77BA0';
    const identifier = {
      id: 'identifier-1',
      userId: 'user-1',
      type: ENIdentifierType.PHONE,
      value: phone,
      verifiedAt: null,
    };
    prisma.userIdentifier.findUnique.mockResolvedValue(identifier);
    prisma.userToken.findFirst.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      identifier,
      type: ENUserTokenType.PHONE_VERIFICATION,
      hash: computeTokenHash(secret, code),
      status: 'PENDING',
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await expect(service.verifyIdentifier({ identifier: phone, code })).resolves.toEqual({
      message: 'Identifier verified successfully.',
    });
    expect(prisma.userToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { attempts: { increment: 1 } } }));
    expect(tx.userToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { usedAt: now } }));
    expect(tx.userIdentifier.updateMany).toHaveBeenCalledWith({
      where: { id: 'identifier-1', verifiedAt: null },
      data: { verifiedAt: now },
    });
  });

  it('issues a session only after a verified identifier and valid password', async () => {
    const { service, prisma, tx } = createService();
    const passwordHash = await hashPassword('correct-password');
    prisma.userIdentifier.findUnique.mockResolvedValue({
      type: ENIdentifierType.PHONE,
      value: phone,
      verifiedAt: now,
      user: { ...user, passwordHash, person: user.person },
    });

    const result = await service.validateCredentials({ phone, password: 'correct-password' } as any, {
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });

    expect(result).toMatchObject({
      accessToken: 'access-token',
      user: { user_id: 'user-1', person_id: 'person-1', email: phone },
    });
    expect(tx.session.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', ip: '127.0.0.1' }) }));
    expect(tx.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sessionId: 'session-1' }) }));
  });

  it('accepts a verified phone identifier for protected access', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      isEmailVerified: false,
      identifiers: [{ id: 'phone-id' }],
    });

    await expect(service.userVerified('user-1')).resolves.toBe(true);
  });

  it('rejects a user with no verified email or phone identifier', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      isEmailVerified: false,
      identifiers: [],
    });

    await expect(service.userVerified('user-1')).resolves.toBe(false);
  });
});
