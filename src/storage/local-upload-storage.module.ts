import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createObjectStorage } from './object-storage.factory';

export const LOCAL_UPLOAD_STORAGE = Symbol('LOCAL_UPLOAD_STORAGE');

@Module({
  providers: [
    {
      provide: LOCAL_UPLOAD_STORAGE,
      inject: [ConfigService],
      useFactory: createObjectStorage,
    },
  ],
  exports: [LOCAL_UPLOAD_STORAGE],
})
export class LocalUploadStorageModule {}
