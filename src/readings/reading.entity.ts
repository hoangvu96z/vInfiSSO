import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('readings')
@Index(['userId', 'app'])
export class Reading {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 20 })
  app: string; // 'iching' | 'tarot'

  @Column({ type: 'varchar', length: 50 })
  type: string; // 'luc-hao' | 'mai-hoa' | spread name

  @Column({ type: 'varchar', length: 500, nullable: true })
  question: string | null;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'jsonb' })
  data: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
