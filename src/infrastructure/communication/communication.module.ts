import { Module } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LogSmsProvider } from './sms/log-sms.provider';
import { UnavailableSmsProvider } from './sms/unavailable-sms.provider';
import { SMS_PROVIDER } from './sms/sms-provider.interface';
import { EMAIL_PROVIDER } from './email/email-provider.interface';
import { LogEmailProvider } from './email/log-email.provider';
import { MailerEmailProvider } from './email/mailer-email.provider';

@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get('MAIL_HOST') || '127.0.0.1',
          port: configService.get('MAIL_PORT') || 1025,
          ignoreTLS: true,
          secure: false,
        },
        defaults: { from: `"Pitchwork" <${configService.get('MAIL_FROM')}>` },
      }),
    }),
  ],
  providers: [
    LogSmsProvider,
    LogEmailProvider,
    MailerEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, LogEmailProvider, MailerEmailProvider],
      useFactory: (
        configService: ConfigService,
        logEmailProvider: LogEmailProvider,
        mailerEmailProvider: MailerEmailProvider,
      ) => {
        const environment = configService.get<string>('NODE_ENV', 'development');
        return environment === 'production'
          ? mailerEmailProvider
          : logEmailProvider;
      },
    },
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const environment = configService.get<string>('NODE_ENV', 'development');

        // Local and test environments intentionally use a zero-cost provider.
        if (environment !== 'production') return new LogSmsProvider();

        // Do not silently log verification codes in production.
        return new UnavailableSmsProvider();
      },
    },
    CommunicationService,
  ],
  exports: [CommunicationService, SMS_PROVIDER],
})
export class CommunicationModule {}
