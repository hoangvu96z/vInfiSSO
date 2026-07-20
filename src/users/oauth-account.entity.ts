import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('oauth_accounts')
@Unique(['provider', 'providerId'])
export class OAuthAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.oauthAccounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  provider: string; // 'google' | 'facebook'

  @Column({ name: 'provider_id' })
  providerId: string;

  @Column({ type: 'text', nullable: true })
  accessToken: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
