import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import {
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './sso-write.dto';

describe('UpdateProfileDto', () => {
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
  });

  async function validateBody<T>(
    value: unknown,
    metatype: new () => T,
  ): Promise<T> {
    return (await validationPipe.transform(value, {
      type: 'body',
      metatype,
      data: '',
    })) as T;
  }

  it('accepts only absolute HTTP(S) avatar URLs while allowing null to clear one', async () => {
    for (const avatarUrl of [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'ftp://cdn.example.test/avatar.png',
      '//cdn.example.test/avatar.png',
      'not a URL',
    ]) {
      await expect(
        validateBody({ avatarUrl }, UpdateProfileDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    await expect(
      validateBody(
        { avatarUrl: 'https://cdn.example.test/avatar.png' },
        UpdateProfileDto,
      ),
    ).resolves.toMatchObject({
      avatarUrl: 'https://cdn.example.test/avatar.png',
    });
    await expect(
      validateBody(
        { avatarUrl: 'http://cdn.example.test/avatar.png' },
        UpdateProfileDto,
      ),
    ).resolves.toMatchObject({
      avatarUrl: 'http://cdn.example.test/avatar.png',
    });
    await expect(
      validateBody({ avatarUrl: null }, UpdateProfileDto),
    ).resolves.toMatchObject({ avatarUrl: null });
  });

  it('keeps the avatar URL field within the database column limit', async () => {
    const unsafe = Object.assign(new UpdateProfileDto(), {
      avatarUrl: `https://cdn.example.test/${'a'.repeat(600)}`,
    });

    expect(await validate(unsafe)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'avatarUrl' }),
      ]),
    );
  });
});

describe('SSO credential DTOs', () => {
  it('rejects short registration and password-reset passwords at the DTO boundary', async () => {
    const register = Object.assign(new RegisterDto(), {
      email: 'member@example.test',
      password: 'short',
    });
    const reset = Object.assign(new ResetPasswordDto(), {
      token: 'valid-reset-token',
      password: 'short',
    });

    for (const dto of [register, reset]) {
      expect(await validate(dto)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'password' }),
        ]),
      );
    }
  });

  it('rejects empty credentials and action tokens', async () => {
    const login = Object.assign(new LoginDto(), {
      email: 'member@example.test',
      password: '',
    });
    const reset = Object.assign(new ResetPasswordDto(), {
      token: '',
      password: 'long-enough-password',
    });

    expect(await validate(login)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'password' }),
      ]),
    );
    expect(await validate(reset)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'token' })]),
    );
  });
});
