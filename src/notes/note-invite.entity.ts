import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Note } from './note.entity';
import { User } from '../users/user.entity';

@Entity('note_invites')
@Index(['token'], { unique: true })
@Index(['noteId'])
export class NoteInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'note_id' })
  noteId: string;

  @ManyToOne(() => Note, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_id' })
  note: Note;

  @Column({ name: 'inviter_user_id' })
  inviterUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviter_user_id' })
  inviter: User;

  @Column({ name: 'invitee_email', type: 'varchar', length: 255 })
  inviteeEmail: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 10, default: 'view' })
  permission: 'view' | 'edit';

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
