export declare class SsoService {
    private readonly sessions;
    login({ username, password }: {
        username: string;
        password: string;
    }): {
        token: string;
        user: {
            username: string;
        };
        expiresAt: number;
    };
    resolveSession(token: string | undefined): {
        user: {
            username: string;
        };
        expiresAt: number;
    } | null;
    logout(token: string | undefined): void;
}
