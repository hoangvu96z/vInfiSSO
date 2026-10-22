import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { UsersModule } from '../users/users.module';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import {
  ForbiddenSsoAuthGuard,
  OptionalSsoAuthGuard,
  SsoAuthGuard,
} from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  imports: [PassportModule, UsersModule],
  controllers: [SsoController],
  providers: [
    SsoService,
    GoogleStrategy,
    FacebookStrategy,
    SsoAuthGuard,
    OptionalSsoAuthGuard,
    ForbiddenSsoAuthGuard,
    RolesGuard,
  ],
  exports: [
    SsoService,
    SsoAuthGuard,
    OptionalSsoAuthGuard,
    ForbiddenSsoAuthGuard,
    RolesGuard,
  ],
})
export class SsoModule {}
