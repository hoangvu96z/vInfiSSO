import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import type { Profile, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID', 'placeholder'),
      clientSecret: configService.get<string>(
        'GOOGLE_CLIENT_SECRET',
        'placeholder',
      ),
      callbackURL: configService.get<string>(
        'GOOGLE_CALLBACK_URL',
        'http://localhost:3000/sso/oauth/google/callback',
      ),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const { id, emails, displayName, photos } = profile;
    const email = emails?.[0]?.value;
    const avatarUrl = photos?.[0]?.value;

    if (!email) {
      done(new Error('Google profile did not include an email address'));
      return;
    }

    try {
      const user = await this.usersService.findOrCreateOAuthUser({
        provider: 'google',
        providerId: id,
        email,
        displayName,
        avatarUrl,
        accessToken,
      });
      done(null, user);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
}
