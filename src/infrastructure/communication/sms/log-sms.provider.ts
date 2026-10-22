import { Injectable, Logger } from '@nestjs/common';
import { ISmsProvider } from './sms-provider.interface';

@Injectable()
export class LogSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(LogSmsProvider.name);

  async sendSms(to: string, body: string): Promise<void> {
    this.logger.log(`SMS MOCK | to=${to}`);
  }
}
