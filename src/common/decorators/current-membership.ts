import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getRequestFromContext } from '@common/utils/request-context.util';
import { AccessContext } from '@common/guards/access-context';

export const CurrentMembership = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const req = getRequestFromContext(ctx);
    return req.activeMembership;
  },
);

export const CurrentAccessContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AccessContext | undefined => {
    return getRequestFromContext(ctx).accessContext;
  },
);
