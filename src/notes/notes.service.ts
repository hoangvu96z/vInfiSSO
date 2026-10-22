import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';
import { Note, NoteImage } from './note.entity';
import { NoteInvite } from './note-invite.entity';
import type {
  CreateNoteDto,
  UpdateNoteDto,
  ShareSettingsDto,
} from './dto/note-write.dto';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';

const GUEST_MAX_CHARS = 2048;
const USER_MAX_CHARS = 10_000;
const GUEST_TTL_DAYS = 60;
const USER_EXTRA_TTL_DAYS = 180;
const USER_PERMANENT_LIMIT = 30;
const MAX_IMAGES_PER_NOTE = 2;
const NOTE_IMAGE_FILENAME_PATTERN = /^[a-f0-9]{24}\.webp$/;
const INVITE_TTL_DAYS = 7;

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);
  private readonly uploadDir: string;

  constructor(
    @InjectRepository(Note)
    private readonly notesRepo: Repository<Note>,
    @InjectRepository(NoteInvite)
    private readonly inviteRepo: Repository<NoteInvite>,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    this.uploadDir = path.join(process.cwd(), 'uploads', 'notes');
    // Ensure upload dir exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generateToken(length = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  private extractNoteImageFilename(source: string | undefined): string | null {
    if (!source || source.length > 2048) return null;

    let pathname: string;
    try {
      pathname = new URL(source, 'https://note-image.invalid').pathname;
    } catch {
      return null;
    }

    const match = pathname.match(
      /^\/(?:uploads\/notes\/|notes\/(?:share\/[^/]+|[^/]+)\/images\/)([a-f0-9]{24}\.webp)$/,
    );
    return match?.[1] ?? null;
  }

  private getNoteImageUrl(
    noteId: string,
    filename: string,
    shareToken?: string,
  ): string {
    if (shareToken) {
      return `/notes/share/${encodeURIComponent(shareToken)}/images/${filename}`;
    }
    return `/notes/${encodeURIComponent(noteId)}/images/${filename}`;
  }

  private sanitizeNoteContent(
    content: string | null | undefined,
    imageUrlForFilename?: (filename: string) => string,
  ): string | null | undefined {
    if (content == null) return content;
    return sanitizeHtml(content, {
      allowedTags: [
        'p',
        'br',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'ul',
        'ol',
        'li',
        'blockquote',
        'h1',
        'h2',
        'h3',
        'h4',
        'img',
        'pre',
        'code',
        'hr',
        'a',
      ],
      allowedAttributes: {
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'alt', 'width', 'height'],
      },
      allowedSchemes: ['http', 'https', 'mailto'],
      transformTags: {
        a: (_tagName, attributes) => ({
          tagName: 'a',
          attribs: {
            ...attributes,
            ...(attributes.target === '_blank'
              ? { rel: 'noopener noreferrer' }
              : {}),
          },
        }),
        img: (_tagName, attributes) => {
          const filename = this.extractNoteImageFilename(attributes.src);
          if (!filename) return { tagName: 'img', attribs: {} };
          const attribs: Record<string, string> = {
            src: imageUrlForFilename
              ? imageUrlForFilename(filename)
              : `/uploads/notes/${filename}`,
          };
          if (attributes.alt) attribs.alt = attributes.alt;
          for (const dimension of ['width', 'height']) {
            if (/^\d{1,4}$/.test(attributes[dimension] ?? '')) {
              attribs[dimension] = attributes[dimension];
            }
          }
          return { tagName: 'img', attribs };
        },
      },
      exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
    });
  }

  private validateContentLength(
    content: string | undefined | null,
    isUser: boolean,
  ): void {
    if (!content) return;
    const max = isUser ? USER_MAX_CHARS : GUEST_MAX_CHARS;
    // Strip HTML tags to count plain text characters
    const plain = content.replace(/<[^>]*>/g, '');
    if (plain.length > max) {
      throw new BadRequestException(
        `Nội dung vượt quá ${max.toLocaleString()} ký tự (hiện tại: ${plain.length} ký tự)`,
      );
    }
  }

  /** Determine if a user-owned note should have a TTL (note rank > PERMANENT_LIMIT) */
  private async computeUserExpiresAt(
    userId: string,
    noteId?: string,
  ): Promise<Date | null> {
    const totalNotes = await this.notesRepo.count({ where: { userId } });
    // After saving, if it's a new note totalNotes includes the new one
    const rank = noteId ? totalNotes : totalNotes + 1;
    if (rank <= USER_PERMANENT_LIMIT) return null;
    const d = new Date();
    d.setDate(d.getDate() + USER_EXTRA_TTL_DAYS);
    return d;
  }

  /** Rebalance TTLs for all user notes after create/delete */
  private async rebalanceUserNotes(userId: string): Promise<void> {
    const notes = await this.notesRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
      select: { id: true, createdAt: true, expiresAt: true },
    });

    const updates: Array<{ id: string; expiresAt: Date | null }> = [];
    notes.forEach((note, index) => {
      const rank = index + 1; // 1-based
      const shouldHaveTtl = rank > USER_PERMANENT_LIMIT;
      const currentHasTtl = note.expiresAt !== null;

      if (shouldHaveTtl && !currentHasTtl) {
        const d = new Date();
        d.setDate(d.getDate() + USER_EXTRA_TTL_DAYS);
        updates.push({ id: note.id, expiresAt: d });
      } else if (!shouldHaveTtl && currentHasTtl) {
        updates.push({ id: note.id, expiresAt: null });
      }
    });

    for (const u of updates) {
      await this.notesRepo.update(u.id, { expiresAt: u.expiresAt });
    }
  }

  private verifyNoteOwnership(
    note: Note,
    userId?: string,
    guestToken?: string,
  ): void {
    if (userId && note.userId === userId) return;
    if (guestToken && note.guestToken === guestToken) return;
    throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
  }

  private canViewNote(
    note: Note,
    userId?: string,
    guestToken?: string,
  ): boolean {
    const isOwner =
      (!!userId && note.userId === userId) ||
      (!!guestToken && note.guestToken === guestToken);
    const isShared =
      !!userId && !!note.sharedWith?.some((s) => s.userId === userId);
    return isOwner || isShared;
  }

  private toPublicNote(
    note: Note,
    requestingUserId?: string,
    shareToken?: string,
  ) {
    const isOwner = !!requestingUserId && note.userId === requestingUserId;
    const imageUrlForFilename = (filename: string) =>
      this.getNoteImageUrl(note.id, filename, shareToken);
    return {
      id: note.id,
      title: note.title,
      content: this.sanitizeNoteContent(note.content, imageUrlForFilename),
      bgColor: note.bgColor,
      bgPattern: note.bgPattern,
      images: note.images?.map((image) => ({
        ...image,
        url: NOTE_IMAGE_FILENAME_PATTERN.test(image.filename)
          ? imageUrlForFilename(image.filename)
          : '',
      })),
      isPinned: note.isPinned,
      isArchived: note.isArchived,
      shareMode: note.shareMode,
      shareToken: note.shareToken,
      sharedWith: isOwner ? note.sharedWith : undefined,
      expiresAt: note.expiresAt,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      isOwner,
      isGuest: !!note.guestToken,
    };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async listNotes(userId?: string, guestToken?: string) {
    if (!userId && !guestToken) {
      throw new BadRequestException('Cần xác thực để xem notes');
    }

    const where = userId ? { userId } : { guestToken };
    const notes = await this.notesRepo.find({
      where,
      order: { isPinned: 'DESC', updatedAt: 'DESC' },
    });

    // Also include notes shared with this user
    let sharedNotes: Note[] = [];
    if (userId) {
      // Find notes where sharedWith contains this userId
      const allShared = await this.notesRepo
        .createQueryBuilder('note')
        .where(`note.shared_with @> :filter::jsonb`, {
          filter: JSON.stringify([{ userId }]),
        })
        .andWhere('note.user_id != :userId', { userId })
        .orderBy('note.updated_at', 'DESC')
        .getMany();
      sharedNotes = allShared;
    }

    return {
      notes: notes.map((n) => this.toPublicNote(n, userId)),
      sharedNotes: sharedNotes.map((n) => this.toPublicNote(n, userId)),
    };
  }

  async getNoteById(id: string, userId?: string, guestToken?: string) {
    const note = await this.notesRepo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Không tìm thấy note');

    // Check access: owner, guest token, or shared
    if (!this.canViewNote(note, userId, guestToken)) {
      throw new ForbiddenException('Bạn không có quyền xem note này');
    }

    return this.toPublicNote(note, userId);
  }

  async getNoteByShareToken(shareToken: string, editorUserId?: string) {
    const note = await this.notesRepo.findOne({ where: { shareToken } });
    if (!note)
      throw new NotFoundException('Link chia sẻ không hợp lệ hoặc đã hết hạn');
    if (note.shareMode === 'none')
      throw new ForbiddenException('Note này không được chia sẻ công khai');

    return {
      ...this.toPublicNote(note, editorUserId, shareToken),
      shareMode: note.shareMode,
      canEdit: note.shareMode === 'edit',
    };
  }

  async createNote(dto: CreateNoteDto, userId?: string, guestToken?: string) {
    if (!userId && !guestToken) {
      throw new BadRequestException(
        'Cần guestToken hoặc đăng nhập để tạo note',
      );
    }

    const isUser = !!userId;
    this.validateContentLength(dto.content, isUser);

    // Compute TTL
    let expiresAt: Date | null = null;
    if (!isUser) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + GUEST_TTL_DAYS);
    }

    const note = this.notesRepo.create({
      userId: userId ?? null,
      guestToken: guestToken ?? null,
      title: dto.title ?? null,
      content: this.sanitizeNoteContent(dto.content ?? null),
      bgColor: dto.bgColor ?? 'default',
      bgPattern: dto.bgPattern ?? 'none',
      images: null,
      shareMode: 'none',
      shareToken: null,
      isPinned: false,
      isArchived: false,
      expiresAt,
    });

    const saved = await this.notesRepo.save(note);

    // Rebalance TTLs for user notes
    if (userId) {
      await this.rebalanceUserNotes(userId);
    }

    return this.toPublicNote(saved, userId);
  }

  private canEditNote(
    note: Note,
    userId?: string,
    guestToken?: string,
  ): boolean {
    if (this.isOwner(note, userId, guestToken)) return true;
    if (
      userId &&
      note.sharedWith?.some(
        (s) => s.userId === userId && s.permission === 'edit',
      )
    )
      return true;
    return false;
  }

  async updateNote(
    id: string,
    dto: UpdateNoteDto,
    userId?: string,
    guestToken?: string,
  ) {
    const note = await this.notesRepo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Không tìm thấy note');

    if (!this.canEditNote(note, userId, guestToken)) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa note này');
    }

    const isUser = !!note.userId;
    if (dto.content !== undefined) {
      this.validateContentLength(dto.content, isUser);
    }

    Object.assign(note, {
      title: dto.title !== undefined ? dto.title : note.title,
      content:
        dto.content !== undefined
          ? this.sanitizeNoteContent(dto.content)
          : note.content,
      bgColor: dto.bgColor !== undefined ? dto.bgColor : note.bgColor,
      bgPattern: dto.bgPattern !== undefined ? dto.bgPattern : note.bgPattern,
      isPinned: dto.isPinned !== undefined ? dto.isPinned : note.isPinned,
      isArchived:
        dto.isArchived !== undefined ? dto.isArchived : note.isArchived,
    });

    const saved = await this.notesRepo.save(note);
    return this.toPublicNote(saved, userId);
  }

  async updateByShareToken(shareToken: string, dto: UpdateNoteDto) {
    const note = await this.notesRepo.findOne({ where: { shareToken } });
    if (!note)
      throw new NotFoundException('Không tìm thấy note hoặc link đã hết hạn');
    if (note.shareMode !== 'edit') {
      throw new ForbiddenException(
        'Note này chỉ ở chế độ xem, không thể chỉnh sửa',
      );
    }

    const isUser = !!note.userId;
    if (dto.content !== undefined) {
      this.validateContentLength(dto.content, isUser);
    }

    Object.assign(note, {
      title: dto.title !== undefined ? dto.title : note.title,
      content:
        dto.content !== undefined
          ? this.sanitizeNoteContent(dto.content)
          : note.content,
      bgColor: dto.bgColor !== undefined ? dto.bgColor : note.bgColor,
      bgPattern: dto.bgPattern !== undefined ? dto.bgPattern : note.bgPattern,
    });

    const saved = await this.notesRepo.save(note);
    return {
      ...this.toPublicNote(saved, undefined, shareToken),
      shareMode: note.shareMode,
      canEdit: true,
    };
  }

  private isOwner(note: Note, userId?: string, guestToken?: string): boolean {
    return (
      (!!userId && note.userId === userId) ||
      (!!guestToken && note.guestToken === guestToken)
    );
  }

  async claimGuestNotes(userId: string, guestToken?: string) {
    if (!guestToken) return { claimed: 0 };
    const guestNotes = await this.notesRepo.find({ where: { guestToken } });
    if (!guestNotes.length) return { claimed: 0 };
    for (const note of guestNotes) {
      note.userId = userId;
      note.guestToken = null;
      await this.notesRepo.save(note);
    }
    await this.rebalanceUserNotes(userId);
    return { claimed: guestNotes.length };
  }

  async deleteNote(
    id: string,
    userId?: string,
    guestToken?: string,
  ): Promise<void> {
    const note = await this.notesRepo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Không tìm thấy note');
    this.verifyNoteOwnership(note, userId, guestToken);

    // Delete associated images from disk
    if (note.images?.length) {
      for (const img of note.images) {
        const filepath = path.join(this.uploadDir, img.filename);
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }
    }

    await this.notesRepo.delete(id);

    // Rebalance TTLs after delete
    if (note.userId) {
      await this.rebalanceUserNotes(note.userId);
    }
  }

  // ─── Share ────────────────────────────────────────────────────────────────

  async updateShareSettings(
    id: string,
    dto: ShareSettingsDto,
    userId?: string,
    guestToken?: string,
  ) {
    const note = await this.notesRepo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Không tìm thấy note');
    this.verifyNoteOwnership(note, userId, guestToken);

    note.shareMode = dto.shareMode;
    if (dto.shareMode !== 'none' && !note.shareToken) {
      note.shareToken = this.generateToken(24);
    }
    if (dto.shareMode === 'none') {
      note.shareToken = null;
    }

    const saved = await this.notesRepo.save(note);
    return this.toPublicNote(saved, userId);
  }

  async sendShareInvite(
    noteId: string,
    inviterUserId: string,
    inviteeEmail: string,
    permission: 'view' | 'edit',
  ) {
    const note = await this.notesRepo.findOne({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Không tìm thấy note');
    if (note.userId !== inviterUserId)
      throw new ForbiddenException('Chỉ chủ sở hữu mới có thể chia sẻ');

    // Find invitee user
    const inviteeUser = await this.usersService.findByEmail(inviteeEmail);
    if (!inviteeUser)
      throw new NotFoundException(
        'Không tìm thấy người dùng với email này trong hệ thống',
      );

    // Check if already shared
    const alreadyShared = note.sharedWith?.some(
      (s) => s.userId === inviteeUser.id,
    );
    if (alreadyShared)
      throw new BadRequestException('Đã chia sẻ note này với người dùng này');

    // Check if invite already pending
    const existingInvite = await this.inviteRepo.findOne({
      where: { noteId, inviteeEmail, acceptedAt: IsNull() },
    });
    if (existingInvite && existingInvite.expiresAt > new Date()) {
      throw new BadRequestException(
        'Đã gửi lời mời cho email này, vui lòng đợi người nhận chấp nhận',
      );
    }

    const token = this.generateToken(32);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

    const invite = this.inviteRepo.create({
      noteId,
      inviterUserId,
      inviteeEmail,
      token,
      permission,
      expiresAt,
      acceptedAt: null,
    });
    await this.inviteRepo.save(invite);

    // Send invite email
    await this.sendInviteEmail(
      inviteeEmail,
      inviteeUser.displayName || inviteeEmail,
      token,
      note.title || 'Untitled Note',
      permission,
    );

    return { success: true, message: `Đã gửi lời mời tới ${inviteeEmail}` };
  }

  async acceptInvite(token: string, acceptingUserId: string) {
    const invite = await this.inviteRepo.findOne({ where: { token } });
    if (!invite) throw new NotFoundException('Lời mời không hợp lệ');
    if (invite.acceptedAt)
      throw new BadRequestException('Lời mời này đã được chấp nhận');
    if (invite.expiresAt < new Date())
      throw new BadRequestException('Lời mời đã hết hạn');

    // Verify accepting user matches invitee email
    const acceptingUser = await this.usersService.findById(acceptingUserId);
    if (!acceptingUser || acceptingUser.email !== invite.inviteeEmail) {
      throw new ForbiddenException(
        'Lời mời này không dành cho tài khoản của bạn',
      );
    }

    const note = await this.notesRepo.findOne({ where: { id: invite.noteId } });
    if (!note) throw new NotFoundException('Note không còn tồn tại');

    // Add to sharedWith
    const sharedWith = note.sharedWith ?? [];
    if (!sharedWith.some((s) => s.userId === acceptingUserId)) {
      sharedWith.push({
        userId: acceptingUserId,
        permission: invite.permission,
      });
      note.sharedWith = sharedWith;
      await this.notesRepo.save(note);
    }

    invite.acceptedAt = new Date();
    await this.inviteRepo.save(invite);

    return { success: true, noteId: note.id };
  }

  async removeSharedUser(
    noteId: string,
    targetUserId: string,
    ownerUserId: string,
  ) {
    const note = await this.notesRepo.findOne({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Không tìm thấy note');
    if (note.userId !== ownerUserId)
      throw new ForbiddenException('Chỉ chủ sở hữu mới có thể xoá quyền');

    note.sharedWith = (note.sharedWith ?? []).filter(
      (s) => s.userId !== targetUserId,
    );
    await this.notesRepo.save(note);
    return { success: true };
  }

  // ─── Image Upload ──────────────────────────────────────────────────────────

  private async processImageUpload(
    note: Note,
    file: Express.Multer.File,
    shareToken?: string,
  ): Promise<{ image: NoteImage }> {
    const currentImages = note.images ?? [];
    if (currentImages.length >= MAX_IMAGES_PER_NOTE) {
      throw new BadRequestException(
        `Mỗi note chỉ được tối đa ${MAX_IMAGES_PER_NOTE} hình ảnh`,
      );
    }

    // Compress to 720p using sharp
    const filename = `${crypto.randomBytes(12).toString('hex')}.webp`;
    const outputPath = path.join(this.uploadDir, filename);

    const resized = await sharp(file.buffer)
      .resize({
        width: 1280,
        height: 720,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();

    const metadata = await sharp(resized).metadata();
    fs.writeFileSync(outputPath, resized);

    const image: NoteImage = {
      filename,
      url: this.getNoteImageUrl(note.id, filename),
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      size: resized.length,
    };

    note.images = [...currentImages, image];
    await this.notesRepo.save(note);

    return {
      image: {
        ...image,
        url: this.getNoteImageUrl(note.id, filename, shareToken),
      },
    };
  }

  private async readNoteImage(note: Note, filename: string): Promise<Buffer> {
    if (
      !NOTE_IMAGE_FILENAME_PATTERN.test(filename) ||
      !note.images?.some((image) => image.filename === filename)
    ) {
      throw new NotFoundException('Không tìm thấy hình ảnh');
    }

    try {
      return await fs.promises.readFile(path.join(this.uploadDir, filename));
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new NotFoundException('Không tìm thấy hình ảnh');
      }
      throw error;
    }
  }

  async getImage(
    noteId: string,
    filename: string,
    userId?: string,
    guestToken?: string,
  ): Promise<Buffer> {
    const note = await this.notesRepo.findOne({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Không tìm thấy note');
    if (!this.canViewNote(note, userId, guestToken)) {
      throw new ForbiddenException('Bạn không có quyền xem note này');
    }
    return this.readNoteImage(note, filename);
  }

  async getImageByShareToken(
    shareToken: string,
    filename: string,
  ): Promise<Buffer> {
    const note = await this.notesRepo.findOne({ where: { shareToken } });
    if (!note)
      throw new NotFoundException('Link chia sẻ không hợp lệ hoặc đã hết hạn');
    if (note.shareMode === 'none') {
      throw new ForbiddenException('Note này không được chia sẻ công khai');
    }
    return this.readNoteImage(note, filename);
  }

  private async processImageDelete(
    note: Note,
    imageIndex: number,
  ): Promise<{ success: boolean }> {
    const images = note.images ?? [];
    if (imageIndex < 0 || imageIndex >= images.length) {
      throw new BadRequestException('Index hình ảnh không hợp lệ');
    }

    const [removed] = images.splice(imageIndex, 1);
    const filepath = path.join(this.uploadDir, removed.filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

    note.images = images.length > 0 ? images : null;
    await this.notesRepo.save(note);
    return { success: true };
  }

  async uploadImage(
    noteId: string,
    file: Express.Multer.File,
    userId?: string,
    guestToken?: string,
  ): Promise<{ image: NoteImage }> {
    const note = await this.notesRepo.findOne({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Không tìm thấy note');
    if (!this.canEditNote(note, userId, guestToken)) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
    return this.processImageUpload(note, file);
  }

  async deleteImage(
    noteId: string,
    imageIndex: number,
    userId?: string,
    guestToken?: string,
  ) {
    const note = await this.notesRepo.findOne({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Không tìm thấy note');
    if (!this.canEditNote(note, userId, guestToken)) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
    return this.processImageDelete(note, imageIndex);
  }

  async uploadImageByShareToken(
    shareToken: string,
    file: Express.Multer.File,
  ): Promise<{ image: NoteImage }> {
    const note = await this.notesRepo.findOne({ where: { shareToken } });
    if (!note)
      throw new NotFoundException('Không tìm thấy note hoặc link đã hết hạn');
    if (note.shareMode !== 'edit') {
      throw new ForbiddenException(
        'Note này chỉ ở chế độ xem, không thể upload ảnh',
      );
    }
    return this.processImageUpload(note, file, shareToken);
  }

  async deleteImageByShareToken(
    shareToken: string,
    imageIndex: number,
  ): Promise<{ success: boolean }> {
    const note = await this.notesRepo.findOne({ where: { shareToken } });
    if (!note)
      throw new NotFoundException('Không tìm thấy note hoặc link đã hết hạn');
    if (note.shareMode !== 'edit') {
      throw new ForbiddenException(
        'Note này chỉ ở chế độ xem, không thể xoá ảnh',
      );
    }
    return this.processImageDelete(note, imageIndex);
  }

  // ─── Mail ─────────────────────────────────────────────────────────────────

  private async sendInviteEmail(
    to: string,
    displayName: string,
    token: string,
    noteTitle: string,
    permission: 'view' | 'edit',
  ) {
    const appUrl = this.configService.get<string>(
      'APP_BASE_URL',
      'https://vunph.id.vn',
    );
    const acceptLink = `${appUrl}/note/invite/${token}`;
    const permLabel = permission === 'edit' ? 'chỉnh sửa' : 'xem';
    const fromAddress = this.configService.get<string>(
      'SMTP_FROM',
      '"vInfi SSO" <admin@vunph.id.vn>',
    );

    const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, sans-serif; background-color: #0f0f14; color: #e8e8f0; margin: 0; padding: 40px 20px; }
        .container { max-width: 520px; margin: 0 auto; background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .logo { text-align: center; margin-bottom: 24px; font-size: 28px; font-weight: bold; color: #34d399; }
        h2 { color: #ffffff; font-size: 20px; margin-bottom: 16px; }
        p { color: #a0a0b0; line-height: 1.6; font-size: 15px; margin-bottom: 16px; }
        .note-box { background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.25); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
        .note-box strong { color: #34d399; }
        .btn-container { text-align: center; margin: 32px 0; }
        .btn { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #059669, #34d399); color: #ffffff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; box-shadow: 0 8px 20px rgba(52,211,153,0.3); }
        .expire-notice { font-size: 13px; color: #888899; text-align: center; margin-top: 24px; }
        .footer { text-align: center; font-size: 12px; color: #666677; margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">📝 NoteNow</div>
        <h2>Xin chào ${displayName},</h2>
        <p>Bạn đã được mời <strong>${permLabel}</strong> một ghi chú trên <strong>NoteNow</strong>:</p>
        <div class="note-box">
          <strong>📝 ${noteTitle}</strong>
        </div>
        <p>Bấm vào nút bên dưới để chấp nhận lời mời và xem ghi chú:</p>
        <div class="btn-container">
          <a href="${acceptLink}" class="btn" target="_blank">Chấp nhận lời mời</a>
        </div>
        <p class="expire-notice">⚠️ Lời mời có hiệu lực trong <strong>${INVITE_TTL_DAYS} ngày</strong>. Bạn cần đăng nhập vào tài khoản có email này để chấp nhận.</p>
        <div class="footer">
          <p>© 2026 vInfi — NoteNow</p>
        </div>
      </div>
    </body>
    </html>`;

    try {
      await this.mailService.sendMail({
        from: fromAddress,
        to,
        subject: `📝 [NoteNow] Bạn được mời ${permLabel} ghi chú "${noteTitle}"`,
        html,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown email delivery error';
      this.logger.error(
        `Failed to send invite email to ${to}: ${errorMessage}`,
      );
      // Don't throw — invite is still created, user can resend
    }
  }

  // ─── Cron Cleanup ──────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredNotes() {
    const now = new Date();
    const expiredNotes = await this.notesRepo.find({
      where: { expiresAt: LessThan(now) },
      select: { id: true, images: true },
    });

    for (const note of expiredNotes) {
      if (note.images?.length) {
        for (const img of note.images) {
          const filepath = path.join(this.uploadDir, img.filename);
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        }
      }
    }

    const deleted = await this.notesRepo.delete({ expiresAt: LessThan(now) });
    this.logger.log(`[Cron] Cleaned up ${deleted.affected ?? 0} expired notes`);

    // Cleanup expired invites
    const deletedInvites = await this.inviteRepo.delete({
      expiresAt: LessThan(now),
      acceptedAt: IsNull(),
    });
    this.logger.log(
      `[Cron] Cleaned up ${deletedInvites.affected ?? 0} expired invites`,
    );
  }
}
