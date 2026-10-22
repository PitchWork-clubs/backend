import { Injectable, Logger } from '@nestjs/common';
import {
  EmailMessage,
  IEmailProvider,
} from './email-provider.interface';

@Injectable()
export class LogEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(LogEmailProvider.name);

  async sendEmail(message: EmailMessage): Promise<void> {
    this.logger.log(
      `EMAIL MOCK | to=${message.to} | subject=${message.subject}`,
    );
  }
}
