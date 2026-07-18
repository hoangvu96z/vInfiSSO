import { CreateLoginDto } from './dto/create-login.dto';
export declare class AuthService {
    private readonly logins;
    createLogin(dto: CreateLoginDto): {
        success: boolean;
        login: {
            id: string;
            username: string;
            passwordHash: string;
            appId: string | null;
            appName: string | null;
            notes: string;
            createdAt: string;
        };
    };
    listLogins(): {
        logins: {
            id: string;
            username: string;
            passwordHash: string;
            appId?: string | null;
            appName?: string | null;
            notes?: string;
            createdAt: string;
        }[];
    };
}
