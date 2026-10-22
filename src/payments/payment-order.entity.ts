import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentOrderStatus = 'pending' | 'paid';

@Entity('payment_orders')
@Check('CHK_payment_orders_amount', '"amount" BETWEEN 1 AND 9999999999999')
@Index('IDX_payment_orders_user_created', ['userId', 'createdAt'])
@Index('IDX_payment_orders_status_created', ['status', 'createdAt'])
@Index('UQ_payment_orders_reference', ['reference'], { unique: true })
export class PaymentOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 50, name: 'plan_name' })
  planName: string;

  @Column({ type: 'varchar', length: 100, name: 'plan_label' })
  planLabel: string;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency: string;

  @Column({ type: 'varchar', length: 24 })
  reference: string;

  @Column({ type: 'smallint', name: 'duration_days' })
  durationDays: number;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: PaymentOrderStatus;

  // Bank details are snapshotted so an administrator changing Settings does
  // not silently change the destination shown for an already-created order.
  @Column({ type: 'varchar', length: 6, name: 'bank_bin' })
  bankBin: string;

  @Column({ type: 'varchar', length: 100, name: 'bank_name' })
  bankName: string;

  @Column({ type: 'varchar', length: 19, name: 'account_number' })
  accountNumber: string;

  @Column({ type: 'varchar', length: 100, name: 'account_name' })
  accountName: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamp', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'uuid', name: 'reviewed_by', nullable: true })
  reviewedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
