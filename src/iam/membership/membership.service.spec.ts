import {
  ENMembershipStatus,
  ENMembershipType,
} from '@prisma/client';
import { MembershipService } from './membership.service';

describe('MembershipService lifecycle', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const actingMembership = { id: 'acting-membership', clubId: 'club-1' } as any;

  function createService() {
    const tx = {
      membership: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: 'membership-1',
          status: ENMembershipStatus.ENDED,
          endedAt: now,
          types: [{ type: ENMembershipType.STAFF }],
        }),
      },
    };
    const prisma = {
      person: { findUnique: jest.fn() },
      club: { findUnique: jest.fn() },
      membership: { findFirst: jest.fn(), findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
    };
    const timezone = { nowUtc: jest.fn().mockReturnValue(now) };
    const service = new MembershipService(prisma as any, timezone as any);
    return { service, prisma, tx, timezone };
  }

  it('ends an active membership and records the end timestamp', async () => {
    const { service, prisma, tx, timezone } = createService();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      clubId: 'club-1',
      status: ENMembershipStatus.ACTIVE,
    });

    await expect(
      service.endMembership('membership-1', actingMembership),
    ).resolves.toEqual(expect.objectContaining({
      status: ENMembershipStatus.ENDED,
      endedAt: now,
    }));

    expect(timezone.nowUtc).toHaveBeenCalledTimes(1);
    expect(tx.membership.update).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
      data: {
        status: ENMembershipStatus.ENDED,
        endedAt: now,
      },
      include: { types: true },
    });
  });

  it('rejects ending a membership from another club', async () => {
    const { service, prisma } = createService();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      clubId: 'club-2',
      status: ENMembershipStatus.ACTIVE,
    });

    await expect(
      service.endMembership('membership-1', actingMembership),
    ).rejects.toThrow('different club');
  });

  it('rejects duplicate membership types before querying the database', async () => {
    const { service, prisma } = createService();

    await expect(
      service.createMembership(
        'person-1',
        'club-1',
        [ENMembershipType.STAFF, ENMembershipType.STAFF],
      ),
    ).rejects.toThrow('types must be unique');
    expect(prisma.person.findUnique).not.toHaveBeenCalled();
  });
});
