import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('payment_settings')
export class PaymentSettings {
  @PrimaryColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 6, name: 'bank_bin' })
  bankBin: string;

  @Column({ type: 'varchar', length: 100, name: 'bank_name' })
  bankName: string;

  @Column({ type: 'varchar', length: 19, name: 'account_number' })
  accountNumber: string;

  @Column({ type: 'varchar', length: 100, name: 'account_name' })
  accountName: string;

  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
