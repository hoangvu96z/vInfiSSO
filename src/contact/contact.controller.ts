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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ContactService,
  summarizeContactMessageImages,
} from './contact.service';
import { AdminOnly } from '../auth/roles.decorator';
import { CreateContactMessageDto } from './dto/contact-write.dto';
import { BatchIdsDto } from '../admin/dto/admin-write.dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

/** Max encoded length per image (~1.5MB raw ≈ ~2MB base64). */
const MAX_IMAGE_B64_LENGTH = 2 * 1024 * 1024;
/** Keep combined image data below the global 5 MiB JSON body limit. */
const MAX_TOTAL_IMAGE_B64_LENGTH = 4 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 5000;
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  // ────────────────────────────────────────────────────────────────
  // PUBLIC endpoints (no auth required)
  // ────────────────────────────────────────────────────────────────

  /**
   * POST /contact/messages — Create a new contact message (public)
   */
  @Post('messages')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async createMessage(
    @Req() req: Request,
    @Body() body: CreateContactMessageDto,
  ) {
    // Validate required fields
    if (
      !body.sessionId ||
      typeof body.sessionId !== 'string' ||
      body.sessionId.length > 64
    ) {
      throw new BadRequestException('sessionId is required (max 64 chars)');
    }
    if (
      !body.name ||
      typeof body.name !== 'string' ||
      body.name.trim().length === 0 ||
      body.name.length > 100
    ) {
      throw new BadRequestException('name is required (1–100 chars)');
    }
    if (
      !body.message ||
      typeof body.message !== 'string' ||
      body.message.trim().length === 0 ||
      body.message.length > MAX_MESSAGE_LENGTH
    ) {
      throw new BadRequestException(
        `message is required (1–${MAX_MESSAGE_LENGTH} chars)`,
      );
    }

    // Validate optional email
    if (
      body.email &&
      (typeof body.email !== 'string' ||
        body.email.length > 200 ||
        !body.email.includes('@'))
    ) {
      throw new BadRequestException('Invalid email format');
    }

    // Validate optional title
    if (
      body.title &&
      (typeof body.title !== 'string' || body.title.length > 300)
    ) {
      throw new BadRequestException('title max 300 chars');
    }

    // Validate optional images array (up to 3 images)
    if (body.images) {
      if (!Array.isArray(body.images)) {
        throw new BadRequestException('images must be an array');
      }
      if (body.images.length > 3) {
        throw new BadRequestException('Tối đa 3 ảnh đính kèm mỗi tin nhắn');
      }
      for (let i = 0; i < body.images.length; i++) {
        const img = body.images[i];
        if (
          !img ||
          typeof img.data !== 'string' ||
          img.data.length > MAX_IMAGE_B64_LENGTH
        ) {
          throw new BadRequestException(`Ảnh ${i + 1} quá lớn (tối đa ~1.5MB)`);
        }
        if (!img.mime || !ALLOWED_MIME_TYPES.includes(img.mime)) {
          throw new BadRequestException(
            `Ảnh ${i + 1} định dạng không hợp lệ (hỗ trợ JPG, PNG, GIF, WebP)`,
          );
        }
      }
    }

    // Validate optional legacy single image
    if (body.imageData) {
      if (
        typeof body.imageData !== 'string' ||
        body.imageData.length > MAX_IMAGE_B64_LENGTH
      ) {
        throw new BadRequestException(`Image too large (max ~1.5MB)`);
      }
      if (!body.imageMime || !ALLOWED_MIME_TYPES.includes(body.imageMime)) {
        throw new BadRequestException(
          `Image type must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`,
        );
      }
    }

    const totalImageB64Length =
      (body.images?.reduce((total, image) => total + image.data.length, 0) ??
        0) + (body.imageData?.length ?? 0);
    if (totalImageB64Length > MAX_TOTAL_IMAGE_B64_LENGTH) {
      throw new BadRequestException(
        'Tổng dung lượng ảnh vượt quá giới hạn cho một tin nhắn',
      );
    }

    const suppliedGuestToken = req.headers['x-guest-token'];
    const guestToken = Array.isArray(suppliedGuestToken)
      ? suppliedGuestToken[0]
      : suppliedGuestToken;
    const normalizedSessionId = body.sessionId.trim();
    const guestTokenValid = this.contactService.isValidGuestSessionToken(
      normalizedSessionId,
      guestToken,
    );
    if (
      !guestTokenValid &&
      (await this.contactService.hasMessagesBySession(normalizedSessionId))
    ) {
      throw new UnauthorizedException(
        'Session token is invalid or expired. Start a new contact session.',
      );
    }

    // Get sender IP and User-Agent
    const senderIp = req.ip || req.socket?.remoteAddress || null;
    const userAgent = (req.headers['user-agent'] as string) || null;

    const message = await this.contactService.createMessage({
      sessionId: body.sessionId.trim(),
      name: body.name.trim(),
      email: body.email?.trim(),
      title: body.title?.trim(),
      message: body.message.trim(),
      imageData: body.imageData,
      imageMime: body.imageMime,
      images: body.images,
      senderIp,
      userAgent,
      clientMeta: body.clientMeta,
    });

    const { hasImage, imageCount } = summarizeContactMessageImages(message);

    // Return without imageData to keep response small
    return {
      message: {
        id: message.id,
        sessionId: message.sessionId,
        name: message.name,
        email: message.email,
        title: message.title,
        message: message.message,
        hasImage,
        imageCount,
        createdAt: message.createdAt,
      },
      guestToken: this.contactService.createGuestSessionToken(
        message.sessionId,
      ),
    };
  }

  /**
   * GET /contact/session/:sessionId — Require signed guest token for history
   */
  @Get('session/:sessionId')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async getSessionMessages(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ) {
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId || normalizedSessionId.length > 64) {
      throw new BadRequestException('Invalid sessionId');
    }
    const guestToken = req.headers['x-guest-token'];
    if (
      !this.contactService.isValidGuestSessionToken(
        normalizedSessionId,
        Array.isArray(guestToken) ? guestToken[0] : guestToken,
      )
    ) {
      throw new UnauthorizedException(
        'Guest session access token is invalid or missing',
      );
    }
    const messages =
      await this.contactService.getMessagesBySession(normalizedSessionId);
    return {
      messages: messages.map((m) => {
        const { hasImage, imageCount } = summarizeContactMessageImages(m);
        return {
          id: m.id,
          sessionId: m.sessionId,
          name: m.name,
          email: m.email,
          title: m.title,
          message: m.message,
          hasImage,
          imageCount,
          createdAt: m.createdAt,
        };
      }),
    };
  }

  // ────────────────────────────────────────────────────────────────
  // ADMIN endpoints (auth required)
  // ────────────────────────────────────────────────────────────────

  /**
   * GET /contact/admin/messages — List all messages (admin)
   */
  @Get('admin/messages')
  @AdminOnly()
  async adminListMessages(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const result = await this.contactService.getAllMessages(p, l, {
      search,
      status,
      dateFrom,
      dateTo,
    });
    return {
      messages: result.messages.map((m) => {
        const { hasImage, imageCount } = summarizeContactMessageImages(m);
        return {
          id: m.id,
          sessionId: m.sessionId,
          app: m.app,
          name: m.name,
          email: m.email,
          title: m.title,
          message: m.message,
          hasImage,
          imageCount,
          imageMime: m.imageMime,
          isRead: m.isRead,
          senderIp: m.senderIp,
          device: m.device,
          browser: m.browser,
          os: m.os,
          location: m.location,
          isp: m.isp,
          metadata: m.metadata,
          createdAt: m.createdAt,
        };
      }),
      total: result.total,
      page: p,
      limit: l,
    };
  }

  /**
   * GET /contact/admin/messages/:id — Get single message with image (admin)
   */
  @Get('admin/messages/:id')
  @AdminOnly()
  async adminGetMessage(@Param('id') id: string) {
    const msg = await this.contactService.getMessageById(id);
    if (!msg) throw new BadRequestException('Message not found');
    return {
      message: {
        ...msg,
        // Preserve the legacy single-image field for existing admin API clients.
        imageData: msg.imageData ?? msg.images?.[0]?.data ?? null,
      },
    };
  }

  /**
   * PATCH /contact/admin/messages/:id/read — Mark message as read (admin)
   */
  @Patch('admin/messages/:id/read')
  @AdminOnly()
  async adminMarkRead(@Param('id') id: string) {
    await this.contactService.markAsRead(id);
    return { success: true };
  }

  /**
   * PATCH /contact/admin/read-all — Mark all messages as read (admin)
   */
  @Patch('admin/read-all')
  @AdminOnly()
  async adminMarkAllRead() {
    await this.contactService.markAllAsRead();
    return { success: true };
  }

  /**
   * DELETE /contact/admin/messages/:id — Delete a message (admin)
   */
  @Delete('admin/messages/:id')
  @AdminOnly()
  async adminDeleteMessage(@Param('id') id: string) {
    await this.contactService.deleteMessage(id);
    return { success: true };
  }

  /**
   * POST /contact/admin/messages/batch-delete — Delete multiple messages (admin)
   */
  @Post('admin/messages/batch-delete')
  @AdminOnly()
  async adminBatchDeleteMessages(@Body() body: BatchIdsDto) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids must be a non-empty array');
    }
    await this.contactService.deleteMessages(body.ids);
    return { success: true, count: body.ids.length };
  }

  /**
   * POST /contact/admin/messages/batch-read — Mark multiple messages as read (admin)
   */
  @Post('admin/messages/batch-read')
  @AdminOnly()
  async adminBatchMarkRead(@Body() body: BatchIdsDto) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids must be a non-empty array');
    }
    await this.contactService.markMessagesAsRead(body.ids);
    return { success: true, count: body.ids.length };
  }

  /**
   * GET /contact/admin/unread-count — Get unread message count (admin)
   */
  @Get('admin/unread-count')
  @AdminOnly()
  async adminUnreadCount() {
    const count = await this.contactService.getUnreadCount();
    return { count };
  }
}
