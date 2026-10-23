import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactMessage } from './contact-message.entity';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { MailModule } from '../mail/mail.module';
import { SsoModule } from '../sso/sso.module';
import { LocalUploadStorageModule } from '../storage/local-upload-storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContactMessage]),
    MailModule,
    SsoModule,
    LocalUploadStorageModule,
  ],
  controllers: [ContactController],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule {}
