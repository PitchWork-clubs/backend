import { ServiceUnavailableException } from '@nestjs/common';
import { ISmsProvider } from './sms-provider.interface';

/**
 * Deliberately prevents accidental SMS delivery in production until a real
 * provider is configured. It must never log OTP values.
 */
export class UnavailableSmsProvider implements ISmsProvider {
  async sendSms(): Promise<void> {
    throw new ServiceUnavailableException(
      'SMS delivery is not configured for this environment.',
    );
  }
}
