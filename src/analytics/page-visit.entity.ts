import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('page_visits')
export class PageVisit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'talkwithme' })
  app: string;

  @Column({ type: 'varchar', length: 255, default: '/' })
  path: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  isp: string | null;

  @Column({ type: 'varchar', length: 100, default: 'Desktop' })
  device: string;

  @Column({ type: 'varchar', length: 100, default: 'Unknown Browser' })
  browser: string;

  @Column({ type: 'varchar', length: 80, default: 'Unknown OS' })
  os: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  referrer: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  screen: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @Column({ type: 'boolean', default: false })
  isBot: boolean;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
