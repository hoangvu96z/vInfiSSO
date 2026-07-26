import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_subscriptions')
@Index(['userId'])
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 50, default: 'free' })
  planName: string; // 'free' | 'lite' | 'premium'

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  /** null = vĩnh viễn (admin tặng hoặc Free mặc định) */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  /** Mã coupon đã dùng để kích hoạt gói này */
  @Column({ type: 'varchar', length: 100, nullable: true })
  grantedByCoupon: string | null;

  /** Admin tặng tay */
  @Column({ default: false })
  grantedByAdmin: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
