import type { Response } from 'express';
import { AppService } from './app.service';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getHello(res: Response): void;
    getSsoPage(res: Response): void;
    getAppAPage(res: Response): void;
    getAppBPage(res: Response): void;
}
