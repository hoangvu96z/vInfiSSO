import {
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

@Entity('coupon_redemptions')
@Index('UQ_coupon_redemptions_coupon_user', ['couponId', 'userId'], {
  unique: true,
})
export class CouponRedemption {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'coupon_id', type: 'uuid' })
  couponId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'redeemed_at', type: 'timestamp' })
  redeemedAt: Date;
}
