import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  /**
   * grant_plan: Tặng gói (planName + durationDays)
   * trial_days: Thêm N ngày vào gói hiện tại
   * discount_percent: Giảm % giá (dành cho tương lai khi có payment)
   */
  @Column({ type: 'varchar', length: 50 })
  type: 'grant_plan' | 'trial_days' | 'discount_percent';

  /** Tên gói được tặng (grant_plan) */
  @Column({ type: 'varchar', length: 50, nullable: true })
  planName: string | null;

  /** Số ngày được tặng */
  @Column({ type: 'int', default: 0 })
  durationDays: number;

  /** Phần trăm giảm giá (0-100) */
  @Column({ type: 'int', default: 0 })
  discountPercent: number;

  /** Tối đa bao nhiêu user được dùng. -1 = không giới hạn */
  @Column({ type: 'int', default: -1 })
  maxUses: number;

  @Column({ type: 'int', default: 0 })
  usedCount: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
