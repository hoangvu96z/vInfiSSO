import type { Request, Response } from 'express';
import { SsoService } from './sso.service';
export declare class SsoController {
    private readonly ssoService;
    constructor(ssoService: SsoService);
    private getTokenFromCookie;
    me(req: Request): {
        user: {
            username: string;
        } | null;
    };
    login(body: {
        username: string;
        password: string;
    }, res: Response): {
        success: boolean;
        user: {
            username: string;
        };
    };
    logout(req: Request, res: Response): {
        success: boolean;
    };
}
