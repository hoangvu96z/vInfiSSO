import type { User } from '../users/user.entity';

export interface AuthenticatedRequest {
  user?: User;
}
