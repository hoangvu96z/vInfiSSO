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

@Module({
  imports: [
    TypeOrmModule.forFeature([Note, NoteInvite]),
    MulterModule.register({}),
    MailModule,
    SsoModule,
    UsersModule,
  ],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
