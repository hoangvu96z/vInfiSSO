import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';

export type ShareMode = 'none' | 'view' | 'edit';

export interface NoteImage {
  filename: string;
  url: string;
  width: number;
  height: number;
  size: number;
}

@Entity('notes')
@Index(['userId'])
@Index(['guestToken'])
@Index(['shareToken'], { unique: true, where: '"shareToken" IS NOT NULL' })
@Index(['expiresAt'], { where: '"expiresAt" IS NOT NULL' })
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Owner (one of these will be set) ─────────────────────────────────────
  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ name: 'guest_token', type: 'varchar', length: 64, nullable: true })
  guestToken: string | null;

  // ─── Content ───────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  content: string | null; // Rich text HTML from TipTap

  // ─── Appearance ───────────────────────────────────────────────────────────
  @Column({ name: 'bg_color', type: 'varchar', length: 30, default: 'default' })
  bgColor: string; // 'default' | '#hex' | color name

  @Column({ name: 'bg_pattern', type: 'varchar', length: 30, default: 'none' })
  bgPattern: string; // 'none' | 'dots' | 'grid' | 'lines'

  @Column({ type: 'jsonb', nullable: true })
  images: NoteImage[] | null; // max 2 images

  // ─── Share ────────────────────────────────────────────────────────────────
  @Column({
    name: 'share_mode',
    type: 'varchar',
    length: 10,
    default: 'none',
  })
  shareMode: ShareMode;

  @Column({ name: 'share_token', type: 'varchar', length: 64, nullable: true })
  shareToken: string | null; // unique token for share link

  @Column({ name: 'shared_with', type: 'jsonb', nullable: true })
  sharedWith: Array<{ userId: string; permission: 'view' | 'edit' }> | null;

  // ─── Organization ─────────────────────────────────────────────────────────
  @Column({ name: 'is_pinned', type: 'boolean', default: false })
  isPinned: boolean;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived: boolean;

  // ─── TTL ──────────────────────────────────────────────────────────────────
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  // ─── Timestamps ───────────────────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
