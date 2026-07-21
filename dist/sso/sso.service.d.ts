import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
export declare class SsoService {
    private readonly usersService;
    constructor(usersService: UsersService);
    register(dto: {
        email: string;
        password: string;
        displayName?: string;
    }): Promise<{
        message: string;
        email: string;
    }>;
    login(dto: {
        email: string;
        password: string;
        appOrigin?: string;
    }): Promise<{
        token: string;
        user: Partial<User>;
    }>;
    oauthLogin(user: User, appOrigin?: string): Promise<{
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
