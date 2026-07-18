import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { UsersModule } from '../users/users.module';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';

@Module({
  imports: [PassportModule, UsersModule],
  controllers: [SsoController],
  providers: [SsoService, GoogleStrategy, FacebookStrategy],
  exports: [SsoService],
})
export class SsoModule {}
