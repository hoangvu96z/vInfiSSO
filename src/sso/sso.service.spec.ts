import type { Repository } from 'typeorm';
import { SsoService } from './sso.service';
import type { UsersService } from '../users/users.service';
import type { AuditLog } from '../users/audit-log.entity';

describe('SsoService logout', () => {
  it('revokes only the presented session token and audits the user', async () => {
    const usersService = {
      resolveSessionByToken: jest.fn().mockResolvedValue({ id: 'user-1' }),
      deleteSessionByToken: jest.fn().mockResolvedValue(undefined),
      deleteAllSessionsForUser: jest.fn().mockResolvedValue(undefined),
    };
    const auditLogRepo = {
      save: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SsoService(
      usersService as unknown as UsersService,
      auditLogRepo as unknown as Repository<AuditLog>,
    );

    await service.logout('presented-session-token');

    expect(usersService.deleteSessionByToken).toHaveBeenCalledTimes(1);
    expect(usersService.deleteSessionByToken).toHaveBeenCalledWith(
      'presented-session-token',
    );
    expect(usersService.deleteAllSessionsForUser).not.toHaveBeenCalled();
    expect(auditLogRepo.save).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'logout',
      app: 'sso',
    });
  });

  it('still revokes the presented token when it no longer resolves to a user', async () => {
    const usersService = {
      resolveSessionByToken: jest.fn().mockResolvedValue(null),
      deleteSessionByToken: jest.fn().mockResolvedValue(undefined),
      deleteAllSessionsForUser: jest.fn().mockResolvedValue(undefined),
    };
    const auditLogRepo = { save: jest.fn() };
    const service = new SsoService(
      usersService as unknown as UsersService,
      auditLogRepo as unknown as Repository<AuditLog>,
    );

    await service.logout('expired-session-token');

    expect(usersService.deleteSessionByToken).toHaveBeenCalledWith(
      'expired-session-token',
    );
    expect(usersService.deleteAllSessionsForUser).not.toHaveBeenCalled();
    expect(auditLogRepo.save).not.toHaveBeenCalled();
  });
});
