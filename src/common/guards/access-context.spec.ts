import { ENScopeType } from '@prisma/client';
import { AccessContext } from './access-context';

describe('AccessContext scoped permissions', () => {
  it('allows a permission only on the team scope that grants it', () => {
    const context = new AccessContext(
      'club-1',
      'membership-1',
      'person-1',
      new Map([
        [
          'PLAYER_READ',
          [
            { scope: ENScopeType.TEAM, scopeId: 'team-a' },
            { scope: ENScopeType.TEAM, scopeId: 'team-b' },
          ],
        ],
      ]),
      [],
    );

    expect(context.allows('PLAYER_READ', { teamId: 'team-a' })).toBe(true);
    expect(context.allows('PLAYER_READ', { teamId: 'team-b' })).toBe(true);
    expect(context.allows('PLAYER_READ', { teamId: 'team-c' })).toBe(false);
  });

  it('keeps team-specific access separate in permission summaries', () => {
    const context = new AccessContext(
      'club-1',
      'membership-1',
      'person-1',
      new Map([
        ['PLAYER_READ', [{ scope: ENScopeType.TEAM, scopeId: 'team-a' }]],
        ['PLAYER_WRITE', [{ scope: ENScopeType.TEAM, scopeId: 'team-b' }]],
      ]),
      [],
    );

    expect(context.summary('PLAYER_READ')).toEqual({
      hasClubWide: false,
      teamIds: ['team-a'],
      allowOwn: false,
      relatedPersonIds: [],
    });
    expect(context.summary('PLAYER_WRITE')).toEqual({
      hasClubWide: false,
      teamIds: ['team-b'],
      allowOwn: false,
      relatedPersonIds: [],
    });
  });
});
