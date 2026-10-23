import { Module } from '@nestjs/common';
import * as path from 'node:path';
import { LocalObjectStorage } from './local-object-storage';

export const LOCAL_UPLOAD_STORAGE = Symbol('LOCAL_UPLOAD_STORAGE');

@Module({
  providers: [
    {
      provide: LOCAL_UPLOAD_STORAGE,
      useFactory: () =>
        new LocalObjectStorage(path.join(process.cwd(), 'uploads')),
    },
  ],
  exports: [LOCAL_UPLOAD_STORAGE],
})
export class LocalUploadStorageModule {}
