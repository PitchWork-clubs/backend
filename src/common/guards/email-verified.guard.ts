// identifier-verified.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '@iam/auth/auth.service';
import { getRequestFromContext } from '@common/utils/request-context.util';

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = this.getRequest(context);
    const user = request.user;

    if (!user || !user.user_id)
      throw new UnauthorizedException('User session not found.');

    const isVerified = await this.authService.userVerified(user.user_id);

    if (!isVerified)
      throw new ForbiddenException('Your email or phone number is not verified.');

    return true;
  }

  private getRequest(context: ExecutionContext) {
    return getRequestFromContext(context);
  }
}
