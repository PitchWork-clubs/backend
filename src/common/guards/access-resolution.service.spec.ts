import { ENFeature, ENMembershipPermissionAction, ENScopeType } from '@prisma/client';
import { AccessResolutionService } from './access-resolution.service';

describe('AccessResolutionService', () => {
  const prisma = {
    clubFeature: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new AccessResolutionService(prisma as any);

  it('combines role scopes with grants and removes matching revokes', async () => {
    prisma.clubFeature.findMany.mockResolvedValueOnce([
      { feature: { code: ENFeature.ACCESS } },
      { feature: { code: ENFeature.TEAM } },
    ]);
    const result = await service.resolve({
      id: 'membership-1',
      clubId: 'club-1',
      personId: 'person-1',
      club: { status: 'ACTIVE' },
      person: { relatedPersonLinks: [] },
      membershipRoles: [
        {
          scope: ENScopeType.TEAM,
          scopeId: 'team-a',
          role: { permissions: [{ permission: { code: 'PLAYER_READ', module: ENFeature.TEAM } }] },
        },
        {
          scope: ENScopeType.TEAM,
          scopeId: 'team-b',
          role: { permissions: [{ permission: { code: 'PLAYER_READ', module: ENFeature.TEAM } }] },
        },
      ],
      membershipPermissions: [
        {
          action: ENMembershipPermissionAction.REVOKE,
          scope: ENScopeType.CLUB,
          scopeId: '',
          permission: { code: 'PLAYER_READ', module: ENFeature.TEAM },
        },
        {
          action: ENMembershipPermissionAction.GRANT,
          scope: ENScopeType.CLUB,
          scopeId: '',
          permission: { code: 'PLAYER_WRITE', module: ENFeature.TEAM },
        },
      ],
    });

    expect(result.effectivePermissions).toEqual(['PLAYER_WRITE']);
    expect(result.accessContext.allows('PLAYER_READ', { teamId: 'team-a' })).toBe(false);
    expect(result.accessContext.allows('PLAYER_READ', { teamId: 'team-b' })).toBe(false);
    expect(result.accessContext.allows('PLAYER_WRITE', { teamId: 'team-a' })).toBe(true);
  });

  it('rejects access when the club is not active', async () => {
    await expect(
      service.resolve({
        id: 'membership-1',
        clubId: 'club-1',
        personId: 'person-1',
        club: { status: 'PENDING_VERIFICATION' },
        person: { relatedPersonLinks: [] },
        membershipRoles: [],
        membershipPermissions: [],
      }),
    ).rejects.toThrow('Club is not active');
  });

  it('does not expose permissions for disabled features', async () => {
    prisma.clubFeature.findMany.mockResolvedValueOnce([
      { feature: { code: ENFeature.ACCESS } },
    ]);

    const result = await service.resolve({
      id: 'membership-1',
      clubId: 'club-1',
      personId: 'person-1',
      club: { status: 'ACTIVE' },
      person: { relatedPersonLinks: [] },
      membershipRoles: [{
        scope: ENScopeType.CLUB,
        scopeId: null,
        role: {
          permissions: [{
            permission: { code: 'TEAM_READ', module: ENFeature.TEAM },
          }],
        },
      }],
      membershipPermissions: [],
    });

    expect(result.effectivePermissions).toEqual([]);
  });

  it('resolves enabled active features for the active club', async () => {
    prisma.clubFeature.findMany.mockResolvedValueOnce([
      { feature: { code: ENFeature.ACCESS } },
      { feature: { code: ENFeature.TEAM } },
    ]);

    await expect(service.getEnabledFeatures('club-1')).resolves.toEqual([
      ENFeature.ACCESS,
      ENFeature.TEAM,
    ]);
  });
});
