import { Module } from '@nestjs/common';
import { MemberAppController } from './member-app.controller';
import { MemberAppService } from './member-app.service';

@Module({
  controllers: [MemberAppController],
  providers: [MemberAppService],
})
export class MemberAppModule {}
