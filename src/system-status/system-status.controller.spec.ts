import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { REQUIRED_ROLES } from '../auth/roles.metadata';
import { RolesGuard } from '../auth/roles.guard';
import { SsoAuthGuard } from '../auth/auth.guard';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusModule } from './system-status.module';
import { SystemStatusService } from './system-status.service';
import { SsoModule } from '../sso/sso.module';

describe('SystemStatusController', () => {
  it('protects the status endpoint with the admin-only SSO guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SystemStatusController)).toBe(
      'admin/system-status',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SystemStatusController),
    ).toEqual([SsoAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(REQUIRED_ROLES, SystemStatusController)).toEqual(
      ['admin'],
    );
  });

  it('imports the module that exports the AdminOnly guard dependencies', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SystemStatusModule),
    ).toContain(SsoModule);
  });

  it('returns the system-status service contract without adding controller data', async () => {
    const response = {
      app: { status: 'ready', checkedAtUtc: '2026-10-23T04:00:00.000Z' },
      database: { status: 'available' },
      backup: {
        status: 'unknown',
        freshness: 'missing',
        updatedAtUtc: null,
        localBackupReady: false,
        offsiteBackupReady: false,
      },
    };
    const service = { getSystemStatus: jest.fn().mockResolvedValue(response) };
    const controller = new SystemStatusController(
      service as unknown as SystemStatusService,
    );

    await expect(controller.getSystemStatus()).resolves.toEqual(response);
    expect(service.getSystemStatus).toHaveBeenCalledTimes(1);
  });
});
