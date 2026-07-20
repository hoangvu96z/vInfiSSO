import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { MemberAppModule } from './member-app/member-app.module';
import { SsoModule } from './sso/sso.module';
import { UsersModule } from './users/users.module';
import { User } from './users/user.entity';
import { OAuthAccount } from './users/oauth-account.entity';
import { Session } from './users/session.entity';

@Module({
  imports: [
    // Load .env file
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // MySQL via TypeORM
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 3306),
        username: config.get<string>('DATABASE_USER', 'root'),
        password: config.get<string>('DATABASE_PASSWORD', ''),
        database: config.get<string>('DATABASE_NAME', 'vinfi_sso'),
        entities: [User, OAuthAccount, Session],
        synchronize: true, // Auto-create tables (disable in prod via env!)
        logging: config.get<string>('NODE_ENV') !== 'production',
        charset: 'utf8mb4',
        timezone: '+07:00',
      }),
    }),

    UsersModule,
    AuthModule,
    MemberAppModule,
    SsoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
