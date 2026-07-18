import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { OAuthAccount } from './oauth-account.entity';
import { Session } from './session.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, OAuthAccount, Session])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
