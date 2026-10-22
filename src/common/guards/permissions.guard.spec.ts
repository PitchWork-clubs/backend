import { Reflector } from '@nestjs/core';
import { ENScopeType } from '@prisma/client';
import { AccessContext } from './access-context';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  function context(request: any) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      getArgs: jest.fn(() => []),
      getContext: jest.fn(() => ({})),
      switchToHttp: () => ({ getRequest: () => request }),
      getType: () => 'http',
    } as any;
  }

  it('rejects authentication without an active authorized membership', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue({ strict: true, permissions: ['PLAYER_READ'] }),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(context({}))).toThrow(
      'Active membership context required',
    );
  });

  it('rejects a team resource outside the resolved permission scope', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === 'permissions'
          ? { strict: true, permissions: ['PLAYER_READ'] }
          : { scopes: [ENScopeType.TEAM] },
      ),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const request = {
      activeMembership: {},
      effectivePermissions: ['PLAYER_READ'],
      params: { teamId: 'team-b' },
      accessContext: new AccessContext(
        'club-1',
        'membership-1',
        'person-1',
        new Map([['PLAYER_READ', [{ scope: ENScopeType.TEAM, scopeId: 'team-a' }]]]),
        [],
      ),
    };

    expect(() => guard.canActivate(context(request))).toThrow(
      'resource scope',
    );
  });
});
