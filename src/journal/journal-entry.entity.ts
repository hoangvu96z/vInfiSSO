import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Reading } from '../readings/reading.entity';
import { User } from '../users/user.entity';

@Entity('journal_entries')
@Index('IDX_journal_entries_user_created', ['userId', 'createdAt'])
@Index('UQ_journal_entries_reading', ['readingId'], { unique: true })
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'reading_id', type: 'uuid' })
  readingId: string;

  @ManyToOne(() => Reading, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reading_id' })
  reading: Reading;

  @Column({ name: 'encrypted_payload', type: 'jsonb' })
  encryptedPayload: { _enc: string };

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
