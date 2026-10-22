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
import { AnalyticsModule } from './analytics/analytics.module';
import { PageVisit } from './analytics/page-visit.entity';
import { NotesModule } from './notes/notes.module';
import { Note } from './notes/note.entity';
import { NoteInvite } from './notes/note-invite.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateReadingEncryptionEnvironment } from './readings/reading-encryption';

@Module({
  imports: [
    // Load .env file
    ConfigModule.forRoot({
      isGlobal: true,
      // Preserve existing .env settings; fill missing production settings from the deployment file.
      envFilePath: getEnvFiles(),
      validate: validateReadingEncryptionEnvironment,
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
          ContactMessage,
          PageVisit,
          Note,
          NoteInvite,
        ],
        synchronize: true,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
