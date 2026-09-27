import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

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

  /** Base64-encoded image data (optional, max ~2MB in base64) */
  @Column({ type: 'text', nullable: true, name: 'image_data' })
  imageData: string | null;

  /** MIME type of the attached image */
  @Column({ type: 'varchar', length: 50, nullable: true, name: 'image_mime' })
  imageMime: string | null;

  /** Whether the admin has read this message */
  @Column({ type: 'boolean', default: false, name: 'is_read' })
  isRead: boolean;

  /** IP address of the sender (for rate limiting / spam) */
  @Column({ type: 'varchar', length: 45, nullable: true, name: 'sender_ip' })
  senderIp: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
