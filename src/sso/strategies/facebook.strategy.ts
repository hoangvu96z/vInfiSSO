import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      clientID: configService.get<string>('FACEBOOK_APP_ID', 'placeholder'),
      clientSecret: configService.get<string>('FACEBOOK_APP_SECRET', 'placeholder'),
      callbackURL: configService.get<string>(
        'FACEBOOK_CALLBACK_URL',
        'http://localhost:3000/sso/oauth/facebook/callback',
      ),
      scope: ['email', 'public_profile'],
      profileFields: ['id', 'emails', 'name', 'picture'],
    });
  }

  async validate(
    accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (err: Error | null, user?: any) => void,
  ): Promise<any> {
    const { id, emails, displayName, photos } = profile;
    const email = emails?.[0]?.value;
    const avatarUrl = photos?.[0]?.value;

    if (!email) {
      return done(new Error('Facebook account does not have an email'), undefined);
    }

    try {
      const user = await this.usersService.findOrCreateOAuthUser({
        provider: 'facebook',
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
