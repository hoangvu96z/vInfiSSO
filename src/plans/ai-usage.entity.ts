import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('ai_usage')
@Index(['userId', 'date'], { unique: true })
@Index(['userId', 'month'])
export class AiUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** Format: YYYY-MM-DD */
  @Column({ type: 'varchar', length: 10 })
  date: string;

  /** Format: YYYY-MM */
  @Column({ type: 'varchar', length: 7 })
  month: string;

  /** Số lần hỏi AI trong ngày hôm nay */
  @Column({ type: 'int', default: 0 })
  dailyCount: number;

  /** Số lần hỏi AI trong tháng này */
  @Column({ type: 'int', default: 0 })
  monthlyCount: number;

  /** Số lần đã bấm "Hỏi thêm" hôm nay */
  @Column({ type: 'int', default: 0 })
  bonusUsedToday: number;

  /** Tổng bonus câu còn lại hôm nay (từ các lần bấm "Hỏi thêm") */
  @Column({ type: 'int', default: 0 })
  bonusRemaining: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
