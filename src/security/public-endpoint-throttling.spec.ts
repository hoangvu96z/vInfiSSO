import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
  THROTTLER_BLOCK_DURATION,
} from '@nestjs/throttler/dist/throttler.constants';
import { ContactController } from '../contact/contact.controller';
import { SsoController } from '../sso/sso.controller';

describe('public endpoint throttling', () => {
  const handler = (controller: object, name: string): object => {
    const descriptor = Object.getOwnPropertyDescriptor(controller, name);
    if (typeof descriptor?.value !== 'function') {
      throw new Error(`Missing handler: ${name}`);
    }
    return descriptor.value as object;
  };

  it.each([
    ['login', 5, 60_000, 15 * 60_000],
    ['register', 5, 60_000, undefined],
    ['forgotPassword', 3, 60 * 60_000, undefined],
  ])(
    'throttles SSO %s using Express req.ip',
    (name, limit, ttl, blockDuration) => {
      const route = handler(SsoController.prototype, name);
      expect(Reflect.getMetadata(GUARDS_METADATA, route)).toContain(
        ThrottlerGuard,
      );
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, route)).toBe(
        limit,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, route)).toBe(ttl);
      if (blockDuration !== undefined) {
        expect(
          Reflect.getMetadata(`${THROTTLER_BLOCK_DURATION}default`, route),
        ).toBe(blockDuration);
      }
    },
  );

  it('throttles public contact submissions using Express req.ip', () => {
    const route = handler(ContactController.prototype, 'createMessage');
    expect(Reflect.getMetadata(GUARDS_METADATA, route)).toContain(
      ThrottlerGuard,
    );
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, route)).toBe(5);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, route)).toBe(60_000);
  });

  it('uses Express req.ip as the throttle identity', async () => {
    const guard = Object.create(ThrottlerGuard.prototype) as ThrottlerGuard;
    Object.assign(guard, { ipv6SubnetPrefix: 64 });
    const getTracker = (
      guard as unknown as {
        getTracker: (request: { ip: string }) => Promise<string>;
      }
    ).getTracker;
    await expect(getTracker.call(guard, { ip: '203.0.113.7' })).resolves.toBe(
      '203.0.113.7',
    );
  });
});
