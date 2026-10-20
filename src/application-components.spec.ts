import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { AppResolver } from './app.resolver';
import { AthleteModule } from './athletes/athlete/athlete.module';
import { AthleteResolver } from './athletes/athlete/athlete.resolver';
import { AthleteService } from './athletes/athlete/athlete.service';
import { CryptoModule } from './common/crypto/crypto.module';
import { ClubModule } from './clubs/club/club.module';
import { ClubResolver } from './clubs/club/club.resolver';
import { ClubService } from './clubs/club/club.service';
import { FeatureModule } from './clubs/feature/feature.module';
import { FeatureResolver } from './clubs/feature/feature.resolver';
import { FeatureService } from './clubs/feature/feature.service';
import { TimezoneModule } from './common/timezone/timezone.module';
import { TimezoneService } from './common/timezone/timezone.service';
import { AuthModule } from './iam/auth/auth.module';
import { AuthController } from './iam/auth/auth.controller';
import { AuthService } from './iam/auth/auth.service';
import { InvitationModule } from './iam/invitation/invitation.module';
import { InvitationController } from './iam/invitation/invitation.controller';
import { InvitationService } from './iam/invitation/invitation.service';
import { MembershipModule } from './iam/membership/membership.module';
import { MembershipResolver } from './iam/membership/membership.resolver';
import { MembershipService } from './iam/membership/membership.service';
import { PermissionModule } from './iam/permission/permission.module';
import { PermissionResolver } from './iam/permission/permission.resolver';
import { PermissionService } from './iam/permission/permission.service';
import { RoleModule } from './iam/role/role.module';
import { RoleResolver } from './iam/role/role.resolver';
import { RoleService } from './iam/role/role.service';
import { UserTokenModule } from './iam/user-token/user-token.module';
import { UserTokenService } from './iam/user-token/user-token.service';
import { AuditLogsModule } from './infrastructure/audit-logs/audit-logs.module';
import { AuditLogsService } from './infrastructure/audit-logs/audit-logs.service';
import { CommunicationModule } from './infrastructure/communication/communication.module';
import { CommunicationService } from './infrastructure/communication/communication.service';
import { LogEmailProvider } from './infrastructure/communication/email/log-email.provider';
import { LogSmsProvider } from './infrastructure/communication/sms/log-sms.provider';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { MediaModule } from './media/media.module';
import { CloudinaryService } from './media/cloudinary/cloudinary.service';
import { TasksService } from './tasks/tasks.service';
import { TeamModule } from './teams/team/team.module';
import { TeamResolver } from './teams/team/team.resolver';
import { TeamService } from './teams/team/team.service';

const mock = {} as any;

describe('application modules', () => {
  const modules = [
    AppModule,
    AthleteModule,
    ClubModule,
    FeatureModule,
    CryptoModule,
    TimezoneModule,
    AuthModule,
    InvitationModule,
    MembershipModule,
    PermissionModule,
    RoleModule,
    UserTokenModule,
    AuditLogsModule,
    CommunicationModule,
    PrismaModule,
    MediaModule,
    TeamModule,
  ];

  it.each(modules)('%p has Nest module metadata', (moduleClass) => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? []).toBeInstanceOf(Array);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleClass) ?? []).toBeInstanceOf(Array);
  });
});

describe('application services', () => {
  it.each([
    ['AthleteService', () => new AthleteService()],
    ['ClubService', () => new ClubService(mock, mock, mock)],
    ['FeatureService', () => new FeatureService(mock, mock)],
    ['TimezoneService', () => new TimezoneService()],
    ['AuthService', () => new AuthService(mock, mock, mock, mock, mock, mock, mock)],
    ['InvitationService', () => new InvitationService(mock, mock, mock, mock, mock)],
    ['MembershipService', () => new MembershipService(mock, mock)],
    ['PermissionService', () => new PermissionService(mock)],
    ['RoleService', () => new RoleService(mock)],
    ['UserTokenService', () => new UserTokenService(mock, mock, mock, mock)],
    ['AuditLogsService', () => new AuditLogsService(mock)],
    ['CommunicationService', () => new CommunicationService(mock, mock)],
    ['CloudinaryService', () => new CloudinaryService(mock)],
    ['TasksService', () => new TasksService(mock, mock)],
    ['TeamService', () => new TeamService(mock)],
  ])('%s can be constructed', (_name, factory) => {
    expect(factory()).toBeDefined();
  });
});

describe('application controllers and resolvers', () => {
  it.each([
    ['AuthController', () => new AuthController(mock, mock)],
    ['InvitationController', () => new InvitationController(mock)],
    ['AthleteResolver', () => new AthleteResolver(mock)],
    ['ClubResolver', () => new ClubResolver(mock)],
    ['FeatureResolver', () => new FeatureResolver(mock)],
    ['MembershipResolver', () => new MembershipResolver(mock)],
    ['PermissionResolver', () => new PermissionResolver(mock)],
    ['RoleResolver', () => new RoleResolver(mock)],
    ['TeamResolver', () => new TeamResolver(mock)],
  ])('%s can be constructed', (_name, factory) => {
    expect(factory()).toBeDefined();
  });

  it('returns the health-check response', () => {
    expect(new AppResolver().healthCheck()).toBe('OK');
  });
});

describe('development communication providers', () => {
  it('logs email messages without requiring SMTP', async () => {
    const provider = new LogEmailProvider();
    await expect(
      provider.sendEmail({
        to: 'person@example.com',
        subject: 'Verification',
        text: '123456',
      }),
    ).resolves.toBeUndefined();
  });

  it('logs SMS messages without requiring an SMS account', async () => {
    await expect(
      new LogSmsProvider().sendSms('+31612345678', '123456'),
    ).resolves.toBeUndefined();
  });
});
