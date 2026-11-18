import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ParseIntPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { NotesService } from './notes.service';
import {
  CreateNoteDto,
  UpdateNoteDto,
  ShareSettingsDto,
  CreateNoteInviteDto,
  SetNotePasswordDto,
  VerifyNotePasswordDto,
} from './dto/note-write.dto';
import {
  ForbiddenSsoAuthGuard,
  OptionalSsoAuthGuard,
} from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { User } from '../users/user.entity';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

const GUEST_TOKEN_HEADER = 'x-guest-token';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB raw (will be compressed to 720p)

const ALLOWED_AUDIO_MIME = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mpga',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/ogg',
  'application/ogg',
  'audio/opus',
  'audio/mp4',
  'video/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/aacp',
  'audio/webm',
  'video/webm',
  'audio/flac',
  'audio/x-flac',
  'audio/3gpp',
  'audio/3gpp2',
  'audio/amr',
];
const ALLOWED_AUDIO_EXT_PATTERN =
  /\.(mp3|wav|ogg|opus|m4a|mp4|aac|webm|flac|3gp|amr)$/i;
const MAX_AUDIO_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function isAllowedAudioFile(file: {
  mimetype?: string;
  originalname?: string;
}): boolean {
  const baseMime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_AUDIO_MIME.includes(baseMime)) return true;
  if (baseMime === 'application/octet-stream' || !baseMime) {
    return ALLOWED_AUDIO_EXT_PATTERN.test(file.originalname || '');
  }
  return false;
}

@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  // ─── Auth Helpers ──────────────────────────────────────────────────────────

  private getGuestToken(req: Request): string | undefined {
    const raw = req.headers[GUEST_TOKEN_HEADER];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
    return undefined;
  }

  /** Returns userId if logged in, or guestToken from header */
  private resolveIdentity(req: Request): {
    userId?: string;
    guestToken?: string;
  } {
    const user = (req as Request & AuthenticatedRequest).user;
    if (user) return { userId: user.id };
    const guestToken = this.getGuestToken(req);
    if (guestToken) return { guestToken };
    return {};
  }

  private sendNoteImage(response: Response, image: Buffer): void {
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Length', image.length);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(image);
  }

  private sendNoteAudio(
    response: Response,
    audio: { buffer: Buffer; mimeType: string },
  ): void {
    response.setHeader('Content-Type', audio.mimeType);
    response.setHeader('Content-Length', audio.buffer.length);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(audio.buffer);
  }

  // ─── List / Get ───────────────────────────────────────────────────────────

  // GET /notes  — list all notes for current user/guest
  @Get()
  @UseGuards(OptionalSsoAuthGuard)
  async list(@Req() req: Request) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.listNotes(userId, guestToken);
  }

  // GET /notes/share/:shareToken  — view a shared note
  @Get('share/:shareToken')
  @UseGuards(OptionalSsoAuthGuard)
  async getByShareToken(
    @Req() req: Request,
    @Param('shareToken') shareToken: string,
  ) {
    const { userId } = this.resolveIdentity(req);
    return this.notesService.getNoteByShareToken(shareToken, userId);
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
  @UseGuards(ForbiddenSsoAuthGuard)
  async claimGuestNotes(@Req() req: Request, @CurrentUser() user: User) {
    const guestToken = this.getGuestToken(req);
    return this.notesService.claimGuestNotes(user.id, guestToken);
  }

  // GET /notes/:id
  @Get(':id')
  @UseGuards(OptionalSsoAuthGuard)
  async getOne(@Req() req: Request, @Param('id') id: string) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.getNoteById(id, userId, guestToken);
  }

  // ─── Create / Update / Delete ─────────────────────────────────────────────

  // POST /notes
  @Post()
  @UseGuards(OptionalSsoAuthGuard)
  async create(@Req() req: Request, @Body() body: CreateNoteDto) {
    const { userId, guestToken } = this.resolveIdentity(req);
    if (!userId && !guestToken) {
      throw new BadRequestException('Cần đăng nhập hoặc cung cấp guest token');
    }
    return this.notesService.createNote(body, userId, guestToken);
  }

  // PATCH /notes/:id
  @Patch(':id')
  @UseGuards(OptionalSsoAuthGuard)
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateNoteDto,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.updateNote(id, body, userId, guestToken);
  }

  // DELETE /notes/:id
  @Delete(':id')
  @UseGuards(OptionalSsoAuthGuard)
  async delete(@Req() req: Request, @Param('id') id: string) {
    const { userId, guestToken } = this.resolveIdentity(req);
    await this.notesService.deleteNote(id, userId, guestToken);
    return { success: true };
  }

  // POST /notes/:id/password — set, change, or remove direct note password
  @Post(':id/password')
  @UseGuards(OptionalSsoAuthGuard)
  async setNotePassword(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SetNotePasswordDto,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.setNotePassword(id, body, userId, guestToken);
  }

  // POST /notes/:id/verify-password — verify direct note password before unlock/edit/delete
  @Post(':id/verify-password')
  @UseGuards(OptionalSsoAuthGuard)
  async verifyNotePassword(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: VerifyNotePasswordDto,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.verifyNotePassword(id, body, userId, guestToken);
  }

  // ─── Share ────────────────────────────────────────────────────────────────

  // POST /notes/:id/share  — update share mode (none/view/edit)
  @Post(':id/share')
  @UseGuards(OptionalSsoAuthGuard)
  async updateShare(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ShareSettingsDto,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.updateShareSettings(id, body, userId, guestToken);
  }

  // POST /notes/:id/share/invite  — invite SSO user by email
  @Post(':id/share/invite')
  @UseGuards(ForbiddenSsoAuthGuard)
  async sendInvite(
    @Param('id') id: string,
    @Body() body: CreateNoteInviteDto,
    @CurrentUser() user: User,
  ) {
    if (!body.email)
      throw new BadRequestException('Cần cung cấp email người được mời');
    return this.notesService.sendShareInvite(
      id,
      user.id,
      body.email,
      body.permission ?? 'view',
    );
  }

  // POST /notes/invite/accept/:token  — accept an invite
  @Post('invite/accept/:token')
  @UseGuards(ForbiddenSsoAuthGuard)
  async acceptInvite(@Param('token') token: string, @CurrentUser() user: User) {
    return this.notesService.acceptInvite(token, user.id);
  }

  // DELETE /notes/:id/share/user/:userId  — remove shared user
  @Delete(':id/share/user/:targetUserId')
  @UseGuards(ForbiddenSsoAuthGuard)
  async removeSharedUser(
    @Param('id') id: string,
    @Param('targetUserId') targetUserId: string,
    @CurrentUser() user: User,
  ) {
    return this.notesService.removeSharedUser(id, targetUserId, user.id);
  }

  // ─── Images ───────────────────────────────────────────────────────────────

  // GET /notes/share/:shareToken/images/:filename — image from active share
  @Get('share/:shareToken/images/:filename')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getImageByShareToken(
    @Param('shareToken') shareToken: string,
    @Param('filename') filename: string,
    @Res() response: Response,
  ) {
    const image = await this.notesService.getImageByShareToken(
      shareToken,
      filename,
    );
    this.sendNoteImage(response, image);
  }

  // GET /notes/:id/images/:filename — image for owner, guest, or invitee
  @Get(':id/images/:filename')
  @UseGuards(ThrottlerGuard, OptionalSsoAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getImage(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() response: Response,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    const image = await this.notesService.getImage(
      id,
      filename,
      userId,
      guestToken,
    );
    this.sendNoteImage(response, image);
  }

  // POST /notes/share/:shareToken/images — upload image via editable share link
  @Post('share/:shareToken/images')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException('Chỉ hỗ trợ ảnh JPEG, PNG, WebP, GIF'),
            false,
          );
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
  @UseGuards(ThrottlerGuard, OptionalSsoAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException('Chỉ hỗ trợ ảnh JPEG, PNG, WebP, GIF'),
            false,
          );
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
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.uploadImage(id, file, userId, guestToken);
  }

  // DELETE /notes/:id/images/:index  — delete image
  @Delete(':id/images/:index')
  @UseGuards(OptionalSsoAuthGuard)
  async deleteImage(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.deleteImage(id, index, userId, guestToken);
  }

  // ─── Audios ───────────────────────────────────────────────────────────────

  // GET /notes/share/:shareToken/audios/:filename — audio from active share
  @Get('share/:shareToken/audios/:filename')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getAudioByShareToken(
    @Param('shareToken') shareToken: string,
    @Param('filename') filename: string,
    @Res() response: Response,
  ) {
    const audio = await this.notesService.getAudioByShareToken(
      shareToken,
      filename,
    );
    this.sendNoteAudio(response, audio);
  }

  // GET /notes/:id/audios/:filename — audio for owner, guest, or invitee
  @Get(':id/audios/:filename')
  @UseGuards(ThrottlerGuard, OptionalSsoAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getAudio(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() response: Response,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    const audio = await this.notesService.getAudio(
      id,
      filename,
      userId,
      guestToken,
    );
    this.sendNoteAudio(response, audio);
  }

  // POST /notes/share/:shareToken/audios — upload audio via editable share link
  @Post('share/:shareToken/audios')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AUDIO_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (isAllowedAudioFile(file)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Chỉ hỗ trợ tệp âm thanh MP3, WAV, OGG, M4A, AAC, WebM, FLAC',
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadAudioByShareToken(
    @Param('shareToken') shareToken: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file)
      throw new BadRequestException('Không có tệp âm thanh được gửi lên');
    return this.notesService.uploadAudioByShareToken(shareToken, file);
  }

  // DELETE /notes/share/:shareToken/audios/:index — delete audio via editable share link
  @Delete('share/:shareToken/audios/:index')
  async deleteAudioByShareToken(
    @Param('shareToken') shareToken: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.notesService.deleteAudioByShareToken(shareToken, index);
  }

  // POST /notes/:id/audios — upload audio
  @Post(':id/audios')
  @UseGuards(ThrottlerGuard, OptionalSsoAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AUDIO_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (isAllowedAudioFile(file)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Chỉ hỗ trợ tệp âm thanh MP3, WAV, OGG, M4A, AAC, WebM, FLAC',
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadAudio(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file)
      throw new BadRequestException('Không có tệp âm thanh được gửi lên');
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.uploadAudio(id, file, userId, guestToken);
  }

  // DELETE /notes/:id/audios/:index — delete audio
  @Delete(':id/audios/:index')
  @UseGuards(OptionalSsoAuthGuard)
  async deleteAudio(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    const { userId, guestToken } = this.resolveIdentity(req);
    return this.notesService.deleteAudio(id, index, userId, guestToken);
  }
}
