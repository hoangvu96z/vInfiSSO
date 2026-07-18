import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CreateLoginDto } from './dto/create-login.dto';

@Injectable()
export class AuthService {
  private readonly logins: Array<{
    id: string;
    username: string;
    passwordHash: string;
    appId?: string | null;
    appName?: string | null;
    notes?: string;
    createdAt: string;
  }> = [];

  createLogin(dto: CreateLoginDto) {
    const login = {
      id: `${Date.now()}`,
      username: dto.username,
      passwordHash: createHash('sha256').update(dto.password).digest('hex'),
      appId: dto.appId ?? null,
      appName: dto.appName ?? null,
      notes: dto.notes ?? '',
      createdAt: new Date().toISOString(),
    };

    this.logins.push(login);
    return { success: true, login };
  }

  listLogins() {
    return { logins: this.logins };
  }
}
