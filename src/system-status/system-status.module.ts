import { Module } from '@nestjs/common';
import { SsoModule } from '../sso/sso.module';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusService } from './system-status.service';

@Module({
  imports: [SsoModule],
  controllers: [SystemStatusController],
  providers: [SystemStatusService],
})
export class SystemStatusModule {}
