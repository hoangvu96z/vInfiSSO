import {
  Controller,
  Get,
  Post,
  Delete,
  Req,
  Body,
  Param,
  Query,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReadingsService } from './readings.service';
import { SsoService } from '../sso/sso.service';

const COOKIE_NAME = 'sso_token';

@Controller('readings')
export class ReadingsController {
  constructor(
    private readonly readingsService: ReadingsService,
    private readonly ssoService: SsoService,
  ) {}

  private getToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.substring(7).trim();
    }
    const raw = req.headers.cookie ?? '';
    const entry = raw
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`));
    if (!entry) return undefined;
    const [, val] = entry.split('=');
    return val ? decodeURIComponent(val) : undefined;
  }

  private async requireUser(req: Request) {
    const token = this.getToken(req);
    const user = await this.ssoService.resolveSession(token);
    if (!user) throw new UnauthorizedException('Vui lòng đăng nhập');
    return user;
  }

  // GET /readings?app=iching
  @Get()
  async list(@Req() req: Request, @Query('app') app?: string) {
    const user = await this.requireUser(req);
    const readings = await this.readingsService.getReadings(user.id, app);
    return { readings };
  }

  // POST /readings
  @Post()
  async create(
    @Req() req: Request,
    @Body() body: {
      app: string;
      type: string;
      question?: string;
      title: string;
      data: Record<string, any>;
    },
  ) {
    if (!body.app || !body.type || !body.title || !body.data) {
      throw new BadRequestException('Thiếu trường bắt buộc: app, type, title, data');
    }
    const user = await this.requireUser(req);
    const reading = await this.readingsService.createReading(user.id, body);
    return { reading };
  }

  // DELETE /readings/all?app=iching  (xoá hết)
  @Delete('all')
  async deleteAll(@Req() req: Request, @Query('app') app?: string) {
    const user = await this.requireUser(req);
    await this.readingsService.deleteAllReadings(user.id, app);
    return { success: true };
  }

  // DELETE /readings/:id  (xoá 1)
  @Delete(':id')
  async deleteOne(@Req() req: Request, @Param('id') id: string) {
    const user = await this.requireUser(req);
    await this.readingsService.deleteReading(user.id, id);
    return { success: true };
  }
}
