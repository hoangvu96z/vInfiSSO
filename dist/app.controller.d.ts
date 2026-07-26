import type { Request, Response } from 'express';
import { AppService } from './app.service';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getHello(res: Response): void;
    redirectToLogin(req: Request, res: Response): void;
    redirectToRegister(req: Request, res: Response): void;
    getReactApp(res: Response): Response<any, Record<string, any>> | undefined;
    getReactAsset(file: string, res: Response): void | Response<any, Record<string, any>>;
    getAppAPage(res: Response): void;
    getAppBPage(res: Response): void;
    getFavicon(res: Response): void;
}
