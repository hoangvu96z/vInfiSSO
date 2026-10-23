import { getEnvFiles } from './config/env-files';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SsoModule } from './sso/sso.module';
import { UsersModule } from './users/users.module';
import { ReadingsModule } from './readings/readings.module';
import { AdminModule } from './admin/admin.module';
import { User } from './users/user.entity';
import { OAuthAccount } from './users/oauth-account.entity';
import { Session } from './users/session.entity';
import { AuditLog } from './users/audit-log.entity';
import { Reading } from './readings/reading.entity';
import { PlansModule } from './plans/plans.module';
import { Plan } from './plans/plan.entity';
import { UserSubscription } from './plans/user-subscription.entity';
import { AiUsage } from './plans/ai-usage.entity';
import { ContactModule } from './contact/contact.module';
import { ContactMessage } from './contact/contact-message.entity';
import { Coupon } from './plans/coupon.entity';
import { CouponRedemption } from './plans/coupon-redemption.entity';
import { AnalyticsModule } from './analytics/analytics.module';
import { PageVisit } from './analytics/page-visit.entity';
import { NotesModule } from './notes/notes.module';
import { Note } from './notes/note.entity';
import { NoteInvite } from './notes/note-invite.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateApplicationEnvironment } from './config/environment';
import { PaymentsModule } from './payments/payments.module';
import { PaymentOrder } from './payments/payment-order.entity';
import { PaymentSettings } from './payments/payment-settings.entity';
import { JournalEntry } from './journal/journal-entry.entity';
import { JournalModule } from './journal/journal.module';

@Module({
  imports: [
    // Load .env file
    ConfigModule.forRoot({
      isGlobal: true,
      // Preserve existing .env settings; fill missing production settings from the deployment file.
      envFilePath: getEnvFiles(),
      validate: validateApplicationEnvironment,
    }),

    // PostgreSQL via TypeORM (local on VPS)
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get<string>('DATABASE_USER', 'postgres'),
        password: config.get<string>('DATABASE_PASSWORD', ''),
        database: config.get<string>('DATABASE_NAME', 'vinfi_sso'),
        entities: [
          User,
          OAuthAccount,
          Session,
          AuditLog,
          Reading,
          Plan,
          UserSubscription,
          AiUsage,
          Coupon,
          CouponRedemption,
          ContactMessage,
          PageVisit,
          Note,
          NoteInvite,
          PaymentOrder,
          PaymentSettings,
          JournalEntry,
        ],
        // Production schema changes must be applied through explicit migrations.
        synchronize: false,
        // Migrations are run explicitly by an operator before deploying code.
        migrationsRun: false,
        logging: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),

    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    UsersModule,
    SsoModule,
    ReadingsModule,
    AdminModule,
    PlansModule,
    ContactModule,
    AnalyticsModule,
    NotesModule,
    PaymentsModule,
    JournalModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
