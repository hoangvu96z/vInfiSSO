import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('plans')
export class Plan {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  name: string; // 'free' | 'lite' | 'premium'

  @Column({ type: 'varchar', length: 100 })
  label: string; // "Gói Miễn Phí"

  /** Số lần hỏi AI tối đa mỗi ngày. -1 = không giới hạn */
  @Column({ type: 'int', default: 1 })
  dailyLimit: number;

  /** Số lần hỏi AI tối đa mỗi tháng. -1 = không giới hạn */
  @Column({ type: 'int', default: 30 })
  monthlyLimit: number;

  /** Có được bấm "Hỏi thêm 5 câu" không */
  @Column({ default: false })
  canBonus: boolean;

  /** Số câu bonus mỗi lần bấm */
  @Column({ type: 'int', default: 5 })
  bonusAmount: number;

  /** Tối đa bao nhiêu lần bấm bonus mỗi ngày */
  @Column({ type: 'int', default: 1 })
  bonusMaxPerDay: number;

  /** Admin bật/tắt gói này (tắt = không ai đăng ký mới được) */
  @Column({ default: true })
  isActive: boolean;

  /** Khi true: user Free được dùng giới hạn của Lite */
  @Column({ default: false })
  overrideFreeToLite: boolean;

  /** Khi true: user Free được dùng giới hạn của Premium */
  @Column({ default: false })
  overrideFreeToPremium: boolean;

  /** Giá gói (VND). 0 = miễn phí */
  @Column({ type: 'bigint', default: 0 })
  price: number;

  /** Mô tả ngắn hiển thị trong UI */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
