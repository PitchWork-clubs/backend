import {
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  EMAIL_PROVIDER,
  IEmailProvider,
} from './email/email-provider.interface';
import {
  ISmsProvider,
  SMS_PROVIDER,
} from './sms/sms-provider.interface';

@Injectable()
export class CommunicationService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: IEmailProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: ISmsProvider,
  ) {}

  public async sendEmail(
    to: string,
    subject: string,
    body: string,
    htmlBody?: string,
  ) {
    await this.emailProvider.sendEmail({
      to,
      subject,
      text: body,
      html: htmlBody,
    });
  }

  public async sendSms(to: string, body: string): Promise<void> {
    await this.smsProvider.sendSms(to, body);
  }
}
