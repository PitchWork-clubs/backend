import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const TWO_FACTOR_KEY = Buffer.alloc(32, 7).toString('base64');
const TOKEN_HASH_SECRET = 'test-token-hash-secret-that-is-at-least-32-chars';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'TWO_FACTOR_KEY') return TWO_FACTOR_KEY;
              if (key === 'TOKEN_HASH_SECRET') return TOKEN_HASH_SECRET;
              throw new Error(`Unexpected config key: ${key}`);
            },
          },
        },
      ],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('encrypts and decrypts values', () => {
    const encrypted = service.encrypt('secret-value');

    expect(encrypted).not.toContain('secret-value');
    expect(service.decrypt(encrypted)).toBe('secret-value');
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = service.encrypt('secret-value');
    const tampered = `${encrypted.slice(0, -1)}x`;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('computes deterministic HMAC hashes', () => {
    expect(service.computeHash('value')).toBe(service.computeHash('value'));
    expect(service.computeHash('value')).not.toBe(service.computeHash('other'));
  });

  it('generates six-digit OTPs that match their hashes', () => {
    const generated = service.generateOtp('user-id', 'EMAIL_VERIFICATION');

    expect(generated.otp).toMatch(/^\d{6}$/);
    expect(generated.hash).toBe(
      service.hashOtp(generated.otp, 'user-id', 'EMAIL_VERIFICATION'),
    );
  });

  it('generates recovery codes that match their hashes', () => {
    const generated = service.generateRecoveryCodes('user-id');

    expect(generated.plainCodes).toHaveLength(10);
    expect(generated.hashedCodes).toHaveLength(10);
    expect(generated.hashedCodes[0]).toBe(
      service.hashRecoveryCode('user-id', generated.plainCodes[0]),
    );
  });

  it('compares equal-length values in constant time', () => {
    expect(service.timingSafeEqual('same', 'same')).toBe(true);
    expect(service.timingSafeEqual('same', 'different')).toBe(false);
  });
});
