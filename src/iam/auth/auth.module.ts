import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { LocalStrategy } from './strategy/local.strategy';
import { JwtStrategy } from './strategy/jwt.strategy';
import { AuditLogsModule } from '@infrastructure/audit-logs/audit-logs.module';
import { UserTokenModule } from '../user-token/user-token.module';
import { EmailVerifiedGuard } from '@common/guards/email-verified.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_TTL', '15m') as any,
          audience: 'access',
        },
      }),
    }),
    PassportModule,
    AuditLogsModule,
    UserTokenModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, EmailVerifiedGuard],
  exports: [AuthService],
})
export class AuthModule {}
