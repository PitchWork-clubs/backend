import { SetMetadata } from '@nestjs/common';
import { ENScopeType } from '@prisma/client';

export const SCOPES_KEY = 'required_scopes';

export interface IScopesMetadata {
  scopes: ENScopeType[];
}

export const RequireScopes = (...scopes: ENScopeType[]) =>
  SetMetadata(SCOPES_KEY, { scopes });
