import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ENClubStatus, ENMembershipStatus } from '@prisma/client';
import { ClubService } from './club.service';

describe('ClubService verification lifecycle', () => {
  const auditLogs = { createLog: jest.fn().mockResolvedValue(undefined) };
  const timezone = {
    nowUtc: jest.fn(() => new Date('2026-10-21T00:00:00.000Z')),
    resolve: jest.fn(() => 'UTC'),
  };
  const cloudinary = { deleteFile: jest.fn() };
  const tx = {
    club: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    role: { findFirst: jest.fn(), create: jest.fn() },
    membershipRole: { deleteMany: jest.fn(), create: jest.fn() },
    membership: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    feature: { findMany: jest.fn() },
    clubFeature: { createMany: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    club: { findMany: jest.fn() },
  };
  const service = new ClubService(prisma as any, cloudinary as any, timezone as any, auditLogs as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: true });
    tx.club.create.mockResolvedValue({ id: 'club-1' });
    tx.membership.create.mockResolvedValue({ id: 'membership-1', types: [] });
    tx.role.findFirst.mockResolvedValue(null);
    tx.role.create.mockResolvedValue({ id: 'pending-owner-role' });
    tx.club.update.mockResolvedValue({ id: 'club-1', status: ENClubStatus.PENDING_VERIFICATION });
    tx.club.update.mockResolvedValue({ id: 'club-1', status: ENClubStatus.ACTIVE });
    tx.membership.update.mockResolvedValue({});
    tx.feature.findMany.mockResolvedValue([]);
    tx.membershipRole.deleteMany.mockResolvedValue({ count: 1 });
    tx.membershipRole.create.mockResolvedValue({});
    tx.clubFeature.createMany.mockResolvedValue({ count: 0 });
  });

  it('creates the club and owner membership as pending in one transaction', async () => {
    prisma.user.findUnique.mockResolvedValue({ person: { id: 'person-1' } });
    await service.createClub(
      {
        name: 'Pitchwork FC',
        country: 'NL',
        membershipTypes: [],
      } as any,
      'user-1',
    );

    expect(tx.club.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ENClubStatus.PENDING_VERIFICATION }) }),
    );
    expect(tx.membership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clubId: 'club-1', status: ENMembershipStatus.PENDING }),
      }),
    );
    expect(tx.membershipRole.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roleId: 'pending-owner-role' }) }),
    );
  });

  it('rejects verification for non-platform administrators', async () => {
    prisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: false });

    await expect(service.verifyClub('club-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('approves a pending club and activates its creator membership', async () => {
    tx.club.findUnique.mockResolvedValue({
      id: 'club-1',
      status: ENClubStatus.PENDING_VERIFICATION,
      createdBy: { id: 'membership-1', status: ENMembershipStatus.PENDING },
    });
    tx.role.findFirst.mockResolvedValue({ id: 'admin-role' });

    await service.verifyClub('club-1', 'platform-1');

    expect(tx.membership.update).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
      data: { status: ENMembershipStatus.ACTIVE },
    });
    expect(tx.club.update).toHaveBeenCalledWith({
      where: { id: 'club-1' },
      data: { status: ENClubStatus.ACTIVE },
    });
    expect(auditLogs.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'club-verified', entityId: 'club-1' }),
      tx,
    );
  });

  it('does not repeat a rejection after the club is closed', async () => {
    tx.club.findUnique.mockResolvedValue({
      id: 'club-1',
      status: ENClubStatus.INACTIVE,
      createdBy: { id: 'membership-1', status: ENMembershipStatus.ENDED },
    });

    await service.rejectClub('club-1', 'platform-1', 'Incomplete details');

    expect(tx.club.update).not.toHaveBeenCalled();
    expect(auditLogs.createLog).not.toHaveBeenCalled();
  });

  it('archives expired pending clubs and is safe to run repeatedly', async () => {
    prisma.club.findMany.mockResolvedValue([{ id: 'club-1', createdById: 'membership-1' }]);
    tx.club.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.archiveExpiredPendingClubs()).resolves.toBe(1);
    expect(tx.club.updateMany).toHaveBeenCalledWith({
      where: { id: 'club-1', status: ENClubStatus.PENDING_VERIFICATION },
      data: { status: ENClubStatus.INACTIVE },
    });
    expect(tx.membership.updateMany).toHaveBeenCalled();
  });

  it('rejects approval of a non-pending club', async () => {
    tx.club.findUnique.mockResolvedValue({ id: 'club-1', status: ENClubStatus.SUSPENDED });

    await expect(service.verifyClub('club-1', 'platform-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
