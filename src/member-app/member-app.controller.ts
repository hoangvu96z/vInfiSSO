import { Body, Controller, Get, Post } from '@nestjs/common';
import { MemberAppService } from './member-app.service';
import { CreateMemberAppDto } from './dto/create-member-app.dto';

@Controller('apps/members')
export class MemberAppController {
  constructor(private readonly memberAppService: MemberAppService) {}

  @Post()
  createMember(@Body() dto: CreateMemberAppDto) {
    return this.memberAppService.createMember(dto);
  }

  @Get()
  listMembers() {
    return this.memberAppService.listMembers();
  }
}
