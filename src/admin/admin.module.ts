import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Session } from '../users/session.entity';
import { AuditLog } from '../users/audit-log.entity';
import { Reading } from '../readings/reading.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from '../auth/admin.guard';
import { SsoModule } from '../sso/sso.module';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session, AuditLog, Reading]),
    SsoModule,
    PlansModule,
  ],
  providers: [AdminService, AdminGuard],
  controllers: [AdminController],
  exports: [AdminService],
})
export class AdminModule {}

