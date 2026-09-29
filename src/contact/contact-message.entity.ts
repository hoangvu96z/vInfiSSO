import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface AttachedImage {
  data: string; // Base64 without data URI prefix
  mime: string; // e.g. "image/jpeg"
  name?: string; // original file name
  size?: number; // compressed size in bytes
  width?: number; // e.g. 1280
  height?: number; // e.g. 720
}

@Entity('contact_messages')
@Index(['sessionId'])
@Index(['createdAt'])
export class ContactMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Client-generated session ID to group messages from the same visitor */
  @Column({ name: 'session_id', type: 'varchar', length: 64 })
  sessionId: string;

  /** Source app identifier, e.g. 'talkwithme' */
  @Column({ type: 'varchar', length: 30, default: 'talkwithme' })
  app: string;

  /** Sender name (required) */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Sender email (optional) */
  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  /** Message title/subject (optional) */
  @Column({ type: 'varchar', length: 300, nullable: true })
  title: string | null;

  /** Message body (required) */
  @Column({ type: 'text' })
  message: string;

  /** Array of attached images (up to 3 images, compressed to 720p) */
  @Column({ type: 'jsonb', nullable: true, name: 'images' })
  images: AttachedImage[] | null;

  /** Base64-encoded image data (legacy single-image field, for backwards compatibility) */
  @Column({ type: 'text', nullable: true, name: 'image_data' })
  imageData: string | null;

  /** MIME type of the attached image (legacy single-image field) */
  @Column({ type: 'varchar', length: 50, nullable: true, name: 'image_mime' })
  imageMime: string | null;

  /** Whether the admin has read this message */
  @Column({ type: 'boolean', default: false, name: 'is_read' })
  isRead: boolean;

  /** IP address of the sender (for rate limiting / spam) */
  @Column({ type: 'varchar', length: 45, nullable: true, name: 'sender_ip' })
  senderIp: string | null;

  /** Parsed device, e.g. "iPhone 15", "Windows PC", "MacBook" */
  @Column({ type: 'varchar', length: 150, nullable: true })
  device: string | null;

  /** Parsed browser, e.g. "Safari 17", "Chrome 124", "Zalo In-App Browser" */
  @Column({ type: 'varchar', length: 150, nullable: true })
  browser: string | null;

  /** Operating System, e.g. "iOS 17.5", "Windows 11", "macOS" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  os: string | null;

  /** Approximate geo location from IP, e.g. "Ho Chi Minh City, Vietnam" */
  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string | null;

  /** Internet Service Provider, e.g. "Viettel", "VNPT", "FPT Telecom" */
  @Column({ type: 'varchar', length: 150, nullable: true })
  isp: string | null;

  /** Additional technical metadata (screen resolution, timezone, language, viewport) */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
