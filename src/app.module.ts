import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { MemberAppModule } from './member-app/member-app.module';
import { SsoModule } from './sso/sso.module';

@Module({
  imports: [AuthModule, MemberAppModule, SsoModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
