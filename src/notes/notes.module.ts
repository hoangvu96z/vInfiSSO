import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { Note } from './note.entity';
import { NoteInvite } from './note-invite.entity';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { MailModule } from '../mail/mail.module';
import { SsoModule } from '../sso/sso.module';
import { UsersModule } from '../users/users.module';
import { OBJECT_STORAGE } from '../storage/object-storage';
import { createObjectStorage } from '../storage/object-storage.factory';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Note, NoteInvite]),
    MulterModule.register({}),
    MailModule,
    SsoModule,
    UsersModule,
  ],
  controllers: [NotesController],
  providers: [
    NotesService,
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      useFactory: createObjectStorage,
    },
  ],
  exports: [NotesService],
})
export class NotesModule {}
