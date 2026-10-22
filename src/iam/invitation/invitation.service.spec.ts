import {
  ENIdentifierType,
  ENMembershipType,
  ENInvitationStatus,
  ENScopeType,
} from '@prisma/client';
import { computeTokenHash } from '@common/utils/token-hash.util';
import { InvitationService } from './invitation.service';

describe('InvitationService invitation lifecycle', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const secret = 'test-secret';
  const club = { id: 'club-1', name: 'Pitchwork FC' };
  const inviter = {
    id: 'membership-owner',
    clubId: club.id,
    club,
    person: {
      firstName: 'Club',
      lastName: 'Owner',
      user: { id: 'user-owner' },
    },
  } as any;

  function createService() {
    const tx = {
      membership: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'membership-new' }),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 'role-staff', code: 'STAFF' }),
        create: jest.fn(),
      },
      membershipRole: { create: jest.fn() },
      athlete: { create: jest.fn() },
      invitation: { update: jest.fn() },
    };
    const prisma = {
      invitation: { create: jest.fn().mockResolvedValue({ id: 'invitation-1' }), findUnique: jest.fn() },
      team: {
        findFirst: jest.fn().mockResolvedValue({ id: 'team-1', name: 'First Team' }),
        findUnique: jest.fn().mockResolvedValue({ name: 'First Team' }),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
    };
    const communication = { sendEmail: jest.fn(), sendSms: jest.fn() };
    const auditLogs = { createLog: jest.fn() };
    const service = new InvitationService(
      prisma as any,
      communication as any,
      { get: jest.fn().mockReturnValue('http://localhost:3000'), getOrThrow: jest.fn().mockReturnValue(secret) } as any,
      { nowUtc: jest.fn().mockReturnValue(now) } as any,
      auditLogs as any,
    );
    return { service, prisma, tx, communication, auditLogs };
  }

  it('creates a seven-day email invitation and sends the invite', async () => {
    const { service, prisma, communication, auditLogs } = createService();

    await expect(service.inviteUser(inviter, {
      invitee_email: 'player@example.com',
      type: ENMembershipType.STAFF,
    } as any)).resolves.toEqual({ message: 'Invitation instructions sent.' });

    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'player@example.com',
        phone: null,
        type: ENMembershipType.STAFF,
        inviterId: inviter.id,
        expiresAt: expect.any(Date),
      }),
    });
    const expiresAt = (prisma.invitation.create.mock.calls[0][0] as any).data.expiresAt as Date;
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 24 * 60 * 60_000 - 5_000);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 24 * 60 * 60_000);
    expect(communication.sendEmail).toHaveBeenCalledWith(
      'player@example.com',
      expect.stringContaining('Pitchwork FC'),
      expect.stringContaining('Invitation code'),
      expect.stringContaining('Pitchwork FC'),
    );
    expect(auditLogs.createLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'INVITATION_SENT' }));
  });

  it('previews a valid invitation while masking its recipient', async () => {
    const { service, prisma } = createService();
    const rawToken = 'preview-token';
    prisma.invitation.findUnique.mockResolvedValue({
      id: 'invitation-1',
      email: 'demo@gmail.com',
      phone: null,
      type: ENMembershipType.ATHLETE,
      status: ENInvitationStatus.PENDING,
      acceptedAt: null,
      expiresAt: new Date('2026-10-28T12:00:00.000Z'),
      inviter: { club },
    });

    await expect(service.previewInvitation(rawToken)).resolves.toEqual({
      clubName: 'Pitchwork FC',
      type: ENMembershipType.ATHLETE,
      expiresAt: new Date('2026-10-28T12:00:00.000Z'),
      recipient: 'd***@gmail.com',
    });
    expect(prisma.invitation.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: computeTokenHash(secret, rawToken) },
      include: { inviter: { include: { club: true } } },
    });
  });

  it('accepts a verified matching account and creates a team-scoped staff role', async () => {
    const { service, prisma, tx, auditLogs } = createService();
    const rawToken = 'accept-token';
    prisma.invitation.findUnique.mockResolvedValue({
      id: 'invitation-1',
      email: 'staff@example.com',
      phone: null,
      type: ENMembershipType.STAFF,
      teamId: 'team-1',
      status: ENInvitationStatus.PENDING,
      acceptedAt: null,
      expiresAt: new Date('2026-10-28T12:00:00.000Z'),
      inviter: { id: inviter.id, clubId: club.id, club },
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-staff',
      personId: 'person-staff',
      identifiers: [{ type: ENIdentifierType.EMAIL, value: 'staff@example.com', verifiedAt: now }],
    });

    await expect(service.acceptInvitation('user-staff', { token: rawToken } as any)).resolves.toEqual({
      membershipId: 'membership-new',
      clubId: 'club-1',
      type: ENMembershipType.STAFF,
    });
    expect(tx.membership.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ personId: 'person-staff', clubId: 'club-1' }),
    }));
    expect(tx.membershipRole.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        membershipId: 'membership-new',
        roleId: 'role-staff',
        scope: ENScopeType.TEAM,
        scopeId: 'team-1',
      }),
    });
    expect(tx.invitation.update).toHaveBeenCalledWith({
      where: { id: 'invitation-1' },
      data: { acceptedAt: now, status: ENInvitationStatus.ACCEPTED },
    });
    expect(auditLogs.createLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'INVITATION_ACCEPTED' }), tx);
  });
});
