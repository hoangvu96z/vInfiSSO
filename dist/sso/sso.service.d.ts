import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { AuditLog } from '../users/audit-log.entity';
export declare class SsoService {
    private readonly usersService;
    private readonly auditLogRepo;
    constructor(usersService: UsersService, auditLogRepo: Repository<AuditLog>);
    register(dto: {
        email: string;
        password: string;
        displayName?: string;
    }, reqMeta?: {
        ipAddress?: string;
        userAgent?: string;
        metadata?: any;
    }): Promise<{
        message: string;
        email: string;
    }>;
    login(dto: {
        email: string;
        password: string;
        appOrigin?: string;
    }, reqMeta?: {
        ipAddress?: string;
        userAgent?: string;
        metadata?: any;
    }): Promise<{
        token: string;
        user: Partial<User>;
    }>;
    oauthLogin(user: User, appOrigin?: string, reqMeta?: {
        ipAddress?: string;
        userAgent?: string;
        metadata?: any;
    }): Promise<{
        token: string;
        user: Partial<User>;
    }>;
    resolveSession(rawToken: string | undefined): Promise<User | null>;
    logout(rawToken: string | undefined): Promise<void>;
    sanitizeUser(user: User): Partial<User>;
    verifyEmail(token: string): Promise<User | null>;
    resendVerificationEmail(email: string): Promise<void>;
    requestPasswordReset(email: string): Promise<void>;
    resetPassword(token: string, newPassword: string): Promise<User>;
    createSessionForUser(userId: string): Promise<string>;
}
