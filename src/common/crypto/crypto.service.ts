import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import type { TEnv } from '../../config/env';

/**
 * Handles AES-256-GCM encryption for 2FA TOTP secrets and
 * HMAC-SHA256 hashing for application tokens, OTPs, refresh tokens, and recovery codes.
 */
@Injectable()
export class CryptoService {
  private readonly twoFactorKey: Buffer;
  private readonly hmacSecret: string;

  constructor(private readonly config: ConfigService<TEnv, true>) {
    const raw2faKey = this.config.getOrThrow<string>('TWO_FACTOR_KEY', {
      infer: true,
    });
    this.twoFactorKey = Buffer.from(raw2faKey, 'base64');
    this.hmacSecret = this.config.getOrThrow<string>('TOKEN_HASH_SECRET', {
      infer: true,
    });

    if (this.twoFactorKey.length !== 32) {
      throw new Error('TWO_FACTOR_KEY must decode to exactly 32 bytes');
    }
  }

  // --- AES-256-GCM ---

  /** Returns "iv:authTag:ciphertext", each part base64. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.twoFactorKey, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data]
      .map((b) => b.toString('base64'))
      .join(':');
  }

  /** Throws if the value was tampered with or encrypted under a different key. */
  decrypt(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Malformed encrypted value');
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.twoFactorKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  // --- HMAC-SHA256 Token & OTP Hashing ---

  /** Compute HMAC-SHA256 hash of a raw string */
  computeHash(raw: string): string {
    return createHmac('sha256', this.hmacSecret).update(raw).digest('hex');
  }

  /** Generate random opaque application token (e.g. for email links, password reset) */
  generateApplicationToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    const hash = this.computeHash(token);
    return { token, hash };
  }

  /** Generate 6-digit OTP and its HMAC hash (bound to userId and type if provided) */
  generateOtp(
    userId?: string,
    type?: string,
  ): { otp: string; hash: string } {
    // 6-digit numeric OTP (e.g. "123456") using the OS CSPRNG.
    const num = randomInt(100000, 1000000).toString();
    const hashKey = userId && type ? `otp:${userId}:${type}:${num}` : num;
    const hash = this.computeHash(hashKey);
    return { otp: num, hash };
  }

  /** Compute OTP hash for lookup / verification */
  hashOtp(otp: string, userId?: string, type?: string): string {
    const hashKey = userId && type ? `otp:${userId}:${type}:${otp}` : otp;
    return this.computeHash(hashKey);
  }

  /** Generate 10 single-use 2FA recovery codes formatted as 'xxxxx-xxxxx' */
  generateRecoveryCodes(userId: string): {
    plainCodes: string[];
    hashedCodes: string[];
  } {
    const plainCodes: string[] = [];
    const hashedCodes: string[] = [];

    for (let i = 0; i < 10; i++) {
      const part1 = randomBytes(3).toString('hex').slice(0, 5);
      const part2 = randomBytes(3).toString('hex').slice(0, 5);
      const code = `${part1}-${part2}`;
      plainCodes.push(code);
      hashedCodes.push(this.computeHash(`recovery:${userId}:${code}`));
    }

    return { plainCodes, hashedCodes };
  }

  /** Hash a single recovery code for validation against database */
  hashRecoveryCode(userId: string, code: string): string {
    return this.computeHash(`recovery:${userId}:${code.trim().toLowerCase()}`);
  }

  /** Constant-time comparison */
  timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
