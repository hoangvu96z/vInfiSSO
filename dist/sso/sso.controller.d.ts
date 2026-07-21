import type { Request, Response } from 'express';
import { SsoService } from './sso.service';
import { ConfigService } from '@nestjs/config';
export declare class SsoController {
    private readonly ssoService;
    private readonly configService;
    constructor(ssoService: SsoService, configService: ConfigService);
    private getToken;
    private setSessionCookie;
    me(req: Request): Promise<{
        user: Partial<import("../users/user.entity").User> | null;
        token: string | null | undefined;
    }>;
    register(body: {
        email: string;
        password: string;
        displayName?: string;
    }, res: Response): Promise<{
        success: boolean;
        token: string;
        user: Partial<import("../users/user.entity").User>;
    }>;
    login(body: {
        email: string;
        password: string;
    }, req: Request, res: Response): Promise<{
        success: boolean;
        token: string;
        user: Partial<import("../users/user.entity").User>;
    }>;
    logout(req: Request, res: Response): Promise<{
        success: boolean;
    }>;
    googleLogin(): void;
    googleCallback(req: Request & {
        user?: any;
    }, res: Response): Promise<void>;
    facebookLogin(): void;
    facebookCallback(req: Request & {
        user?: any;
    }, res: Response): Promise<void>;
    verifyEmail(body: {
        token: string;
    }): Promise<{
        success: boolean;
        message: string;
        user: Partial<import("../users/user.entity").User> | null;
    }>;
    resendVerificationEmail(body: {
        email: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    forgotPassword(body: {
        email: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    resetPassword(body: {
        token: string;
        password: string;
    }, res: Response): Promise<{
        success: boolean;
        message: string;
        token: string;
        user: Partial<import("../users/user.entity").User>;
    }>;
}
