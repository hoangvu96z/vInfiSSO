import { Injectable } from '@nestjs/common';
import { CreateMemberAppDto } from './dto/create-member-app.dto';

@Injectable()
export class MemberAppService {
  private readonly memberApps: Array<{
    id: string;
    appName: string;
    appId?: string | null;
    memberName: string;
    email: string;
    role: string;
    status: string;
    createdAt: string;
  }> = [];

  createMember(dto: CreateMemberAppDto) {
    const memberApp = {
      id: `${Date.now()}`,
      appName: dto.appName,
      appId: dto.appId ?? null,
      memberName: dto.memberName,
      email: dto.email,
      role: dto.role ?? 'member',
      status: dto.status ?? 'active',
      createdAt: new Date().toISOString(),
    };

    this.memberApps.push(memberApp);
    return { success: true, memberApp };
  }

  listMembers() {
    return { memberApps: this.memberApps };
  }
}
