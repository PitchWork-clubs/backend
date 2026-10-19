import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config'; // 1. Import ConfigService
import { TPayload } from '../auth.types';

export type TUserJWTPayload = {
  user_id: string;
  person_id: string;
};

declare global {
  namespace Express {
    interface User extends TUserJWTPayload {}
  }
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly configService: ConfigService) {
    const jwtSecret = configService.getOrThrow<string>('JWT_ACCESS_SECRET');

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => {
          let token = null;
          if (request && request.cookies)
            token = request.cookies['accessToken'];
          return token;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  public async validate(payload: TPayload) {
    return {
      user_id: payload.sub,
      person_id: payload.person_id,
    };
  }
}
