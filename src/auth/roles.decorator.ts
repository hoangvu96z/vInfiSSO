import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { SsoAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { REQUIRED_ROLES } from './roles.metadata';

export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);

export function AdminOnly() {
  return applyDecorators(UseGuards(SsoAuthGuard, RolesGuard), Roles('admin'));
}
