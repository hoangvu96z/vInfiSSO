import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ContactService } from './contact.service';
import { SsoService } from '../sso/sso.service';

/** Max image size in base64 bytes (~1.5MB raw ≈ ~2MB base64) */
const MAX_IMAGE_B64_LENGTH = 2 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 5000;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const COOKIE_NAME = 'sso_token';

@Controller('contact')
export class ContactController {
  constructor(
    private readonly contactService: ContactService,
    private readonly ssoService: SsoService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // PUBLIC endpoints (no auth required)
  // ────────────────────────────────────────────────────────────────

  /**
   * POST /contact/messages — Create a new contact message (public)
   */
  @Post('messages')
  async createMessage(
    @Req() req: Request,
    @Body()
    body: {
      sessionId: string;
      name: string;
      email?: string;
      title?: string;
      message: string;
      imageData?: string;
      imageMime?: string;
    },
  ) {
    // Validate required fields
    if (!body.sessionId || typeof body.sessionId !== 'string' || body.sessionId.length > 64) {
      throw new BadRequestException('sessionId is required (max 64 chars)');
    }
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 100) {
      throw new BadRequestException('name is required (1–100 chars)');
    }
    if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0 || body.message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`message is required (1–${MAX_MESSAGE_LENGTH} chars)`);
    }

    // Validate optional email
    if (body.email && (typeof body.email !== 'string' || body.email.length > 200 || !body.email.includes('@'))) {
      throw new BadRequestException('Invalid email format');
    }

    // Validate optional title
    if (body.title && (typeof body.title !== 'string' || body.title.length > 300)) {
      throw new BadRequestException('title max 300 chars');
    }

    // Validate optional image
    if (body.imageData) {
      if (typeof body.imageData !== 'string' || body.imageData.length > MAX_IMAGE_B64_LENGTH) {
        throw new BadRequestException(`Image too large (max ~1.5MB)`);
      }
      if (!body.imageMime || !ALLOWED_MIME_TYPES.includes(body.imageMime)) {
        throw new BadRequestException(`Image type must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`);
      }
    }

    // Get sender IP
    const senderIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress || null;

    const message = await this.contactService.createMessage({
      sessionId: body.sessionId.trim(),
      name: body.name.trim(),
      email: body.email?.trim(),
      title: body.title?.trim(),
      message: body.message.trim(),
      imageData: body.imageData,
      imageMime: body.imageMime,
      senderIp,
    });

    // Return without imageData to keep response small
    return {
      message: {
        id: message.id,
        sessionId: message.sessionId,
        name: message.name,
        email: message.email,
        title: message.title,
        message: message.message,
        hasImage: !!message.imageData,
        createdAt: message.createdAt,
      },
    };
  }

  /**
   * GET /contact/session/:sessionId — Get all messages for a session (public)
   */
  @Get('session/:sessionId')
  async getSessionMessages(@Param('sessionId') sessionId: string) {
    if (!sessionId || sessionId.length > 64) {
      throw new BadRequestException('Invalid sessionId');
    }
    const messages = await this.contactService.getMessagesBySession(sessionId);
    return {
      messages: messages.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        name: m.name,
        email: m.email,
        title: m.title,
        message: m.message,
        hasImage: !!m.imageData,
        createdAt: m.createdAt,
      })),
    };
  }

  // ────────────────────────────────────────────────────────────────
  // ADMIN endpoints (auth required)
  // ────────────────────────────────────────────────────────────────

  private getToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.substring(7).trim();
    }
    const raw = req.headers.cookie ?? '';
    const entry = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE_NAME}=`));
    if (!entry) return undefined;
    const [, val] = entry.split('=');
    return val ? decodeURIComponent(val) : undefined;
  }

  private async requireAdmin(req: Request) {
    const token = this.getToken(req);
    const user = await this.ssoService.resolveSession(token);
    if (!user || user.role !== 'admin') {
      throw new UnauthorizedException('Admin access required');
    }
    return user;
  }

  /**
   * GET /contact/admin/messages — List all messages (admin)
   */
  @Get('admin/messages')
  async adminListMessages(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.requireAdmin(req);
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const result = await this.contactService.getAllMessages(p, l);
    return {
      messages: result.messages.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        app: m.app,
        name: m.name,
        email: m.email,
        title: m.title,
        message: m.message,
        hasImage: !!m.imageData,
        imageMime: m.imageMime,
        isRead: m.isRead,
        senderIp: m.senderIp,
        createdAt: m.createdAt,
      })),
      total: result.total,
      page: p,
      limit: l,
    };
  }

  /**
   * GET /contact/admin/messages/:id — Get single message with image (admin)
   */
  @Get('admin/messages/:id')
  async adminGetMessage(@Req() req: Request, @Param('id') id: string) {
    await this.requireAdmin(req);
    const msg = await this.contactService.getMessageById(id);
    if (!msg) throw new BadRequestException('Message not found');
    return { message: msg };
  }

  /**
   * PATCH /contact/admin/messages/:id/read — Mark message as read (admin)
   */
  @Patch('admin/messages/:id/read')
  async adminMarkRead(@Req() req: Request, @Param('id') id: string) {
    await this.requireAdmin(req);
    await this.contactService.markAsRead(id);
    return { success: true };
  }

  /**
   * PATCH /contact/admin/read-all — Mark all messages as read (admin)
   */
  @Patch('admin/read-all')
  async adminMarkAllRead(@Req() req: Request) {
    await this.requireAdmin(req);
    await this.contactService.markAllAsRead();
    return { success: true };
  }

  /**
   * DELETE /contact/admin/messages/:id — Delete a message (admin)
   */
  @Delete('admin/messages/:id')
  async adminDeleteMessage(@Req() req: Request, @Param('id') id: string) {
    await this.requireAdmin(req);
    await this.contactService.deleteMessage(id);
    return { success: true };
  }

  /**
   * GET /contact/admin/unread-count — Get unread message count (admin)
   */
  @Get('admin/unread-count')
  async adminUnreadCount(@Req() req: Request) {
    await this.requireAdmin(req);
    const count = await this.contactService.getUnreadCount();
    return { count };
  }
}
