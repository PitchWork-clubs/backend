import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import {
  EmailMessage,
  IEmailProvider,
} from './email-provider.interface';

@Injectable()
export class MailerEmailProvider implements IEmailProvider {
  constructor(private readonly mailerService: MailerService) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to send email');
    }
  }
}
