import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PaymentWebhookEventOutcome = 'received' | 'paid' | 'ignored';

@Entity('payment_webhook_events')
@Index(
  'UQ_payment_webhook_events_provider_transaction',
  ['provider', 'providerTransactionId'],
  { unique: true },
)
@Index('IDX_payment_webhook_events_order_received', [
  'paymentOrderId',
  'receivedAt',
])
export class PaymentWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ name: 'provider_transaction_id', type: 'varchar', length: 100 })
  providerTransactionId: string;

  @Column({ name: 'payment_order_id', type: 'uuid', nullable: true })
  paymentOrderId: string | null;

  @Column({ name: 'transfer_type', type: 'varchar', length: 8 })
  transferType: string;

  @Column({ type: 'varchar', length: 100 })
  gateway: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  reference: string | null;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ name: 'account_last4', type: 'varchar', length: 4 })
  accountLast4: string;

  @Column({ name: 'signature_timestamp', type: 'bigint' })
  signatureTimestamp: string;

  @Column({ name: 'payload_sha256', type: 'varchar', length: 64 })
  payloadSha256: string;

  @Column({ type: 'varchar', length: 12, default: 'received' })
  outcome: PaymentWebhookEventOutcome;

  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  rejectionReason: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamp' })
  receivedAt: Date;
}
