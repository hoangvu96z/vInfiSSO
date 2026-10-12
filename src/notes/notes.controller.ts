import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { NotesService } from './notes.service';
import type { CreateNoteDto, UpdateNoteDto, ShareSettingsDto } from './notes.service';
import { SsoService } from '../sso/sso.service';

const COOKIE_NAME = 'sso_token';
const GUEST_TOKEN_HEADER = 'x-guest-token';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB raw (will be compressed to 720p)

@Controller('notes')
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    private readonly ssoService: SsoService,
  ) {}

  // ─── Auth Helpers ──────────────────────────────────────────────────────────

  private getSsoToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
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

  private getGuestToken(req: Request): string | undefined {
    const raw = req.headers[GUEST_TOKEN_HEADER];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
    return undefined;
  }

  /** Returns userId if logged in, or guestToken from header */
  private async resolveIdentity(req: Request): Promise<{ userId?: string; guestToken?: string }> {
    const ssoToken = this.getSsoToken(req);
    if (ssoToken) {
      const user = await this.ssoService.resolveSession(ssoToken);
      if (user) return { userId: user.id };
    }
    const guestToken = this.getGuestToken(req);
    if (guestToken) return { guestToken };
    return {};
  }

  private async requireUser(req: Request) {
    const ssoToken = this.getSsoToken(req);
    const user = await this.ssoService.resolveSession(ssoToken);
    if (!user) throw new ForbiddenException('Vui lòng đăng nhập để thực hiện thao tác này');
    return user;
  }

  // ─── List / Get ───────────────────────────────────────────────────────────

  // GET /notes  — list all notes for current user/guest
  @Get()
  async list(@Req() req: Request) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    return this.notesService.listNotes(userId, guestToken);
  }

  // GET /notes/share/:shareToken  — view a shared note
  @Get('share/:shareToken')
  async getByShareToken(
    @Req() req: Request,
    @Param('shareToken') shareToken: string,
  ) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    return this.notesService.getNoteByShareToken(shareToken, userId, guestToken);
  }

  // PATCH /notes/share/:shareToken — update note via share link
  @Patch('share/:shareToken')
  async updateByShareToken(
    @Param('shareToken') shareToken: string,
    @Body() body: UpdateNoteDto,
  ) {
    return this.notesService.updateByShareToken(shareToken, body);
  }

  // POST /notes/claim — transfer guest notes to logged in user
  @Post('claim')
  async claimGuestNotes(@Req() req: Request) {
    const user = await this.requireUser(req);
    const guestToken = this.getGuestToken(req);
    return this.notesService.claimGuestNotes(user.id, guestToken);
  }

  // GET /notes/:id
  @Get(':id')
  async getOne(@Req() req: Request, @Param('id') id: string) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    return this.notesService.getNoteById(id, userId, guestToken);
  }

  // ─── Create / Update / Delete ─────────────────────────────────────────────

  // POST /notes
  @Post()
  async create(@Req() req: Request, @Body() body: CreateNoteDto) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    if (!userId && !guestToken) {
      throw new BadRequestException('Cần đăng nhập hoặc cung cấp guest token');
    }
    return this.notesService.createNote(body, userId, guestToken);
  }

  // PATCH /notes/:id
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateNoteDto,
  ) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    return this.notesService.updateNote(id, body, userId, guestToken);
  }

  // DELETE /notes/:id
  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    await this.notesService.deleteNote(id, userId, guestToken);
    return { success: true };
  }

  // ─── Share ────────────────────────────────────────────────────────────────

  // POST /notes/:id/share  — update share mode (none/view/edit)
  @Post(':id/share')
  async updateShare(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ShareSettingsDto,
  ) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    return this.notesService.updateShareSettings(id, body, userId, guestToken);
  }

  // POST /notes/:id/share/invite  — invite SSO user by email
  @Post(':id/share/invite')
  async sendInvite(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { email: string; permission?: 'view' | 'edit' },
  ) {
    if (!body.email) throw new BadRequestException('Cần cung cấp email người được mời');
    const user = await this.requireUser(req);
    return this.notesService.sendShareInvite(
      id,
      user.id,
      body.email,
      body.permission ?? 'view',
    );
  }

  // POST /notes/invite/accept/:token  — accept an invite
  @Post('invite/accept/:token')
  async acceptInvite(@Req() req: Request, @Param('token') token: string) {
    const user = await this.requireUser(req);
    return this.notesService.acceptInvite(token, user.id);
  }

  // DELETE /notes/:id/share/user/:userId  — remove shared user
  @Delete(':id/share/user/:targetUserId')
  async removeSharedUser(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const user = await this.requireUser(req);
    return this.notesService.removeSharedUser(id, targetUserId, user.id);
  }

  // ─── Images ───────────────────────────────────────────────────────────────

  // POST /notes/share/:shareToken/images — upload image via editable share link
  @Post('share/:shareToken/images')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Chỉ hỗ trợ ảnh JPEG, PNG, WebP, GIF'), false);
        }
      },
    }),
  )
  async uploadImageByShareToken(
    @Param('shareToken') shareToken: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Không có file ảnh được gửi lên');
    return this.notesService.uploadImageByShareToken(shareToken, file);
  }

  // DELETE /notes/share/:shareToken/images/:index — delete image via editable share link
  @Delete('share/:shareToken/images/:index')
  async deleteImageByShareToken(
    @Param('shareToken') shareToken: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.notesService.deleteImageByShareToken(shareToken, index);
  }

  // POST /notes/:id/images  — upload image
  @Post(':id/images')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Chỉ hỗ trợ ảnh JPEG, PNG, WebP, GIF'), false);
        }
      },
    }),
  )
  async uploadImage(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Không có file ảnh được gửi lên');
    const { userId, guestToken } = await this.resolveIdentity(req);
    return this.notesService.uploadImage(id, file, userId, guestToken);
  }

  // DELETE /notes/:id/images/:index  — delete image
  @Delete(':id/images/:index')
  async deleteImage(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    const { userId, guestToken } = await this.resolveIdentity(req);
    return this.notesService.deleteImage(id, index, userId, guestToken);
  }
}
