jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_DAY_AT_3AM: '0 3 * * *',
  },
}));

import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { OptionalSsoAuthGuard } from '../auth/auth.guard';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

describe('NotesController image upload throttling', () => {
  const getUploadHandler = (
    methodName:
      | 'uploadImage'
      | 'uploadImageByShareToken'
      | 'getImage'
      | 'getImageByShareToken',
  ): object => {
    const descriptor = Object.getOwnPropertyDescriptor(
      NotesController.prototype,
      methodName,
    );
    if (typeof descriptor?.value !== 'function') {
      throw new Error(`Missing handler: ${methodName}`);
    }
    return descriptor.value as object;
  };

  const uploadHandlers = [
    getUploadHandler('uploadImage'),
    getUploadHandler('uploadImageByShareToken'),
  ];

  const imageDownloadHandlers = [
    getUploadHandler('getImage'),
    getUploadHandler('getImageByShareToken'),
  ];

  it('applies a 10-per-minute ThrottlerGuard to every image upload route', () => {
    for (const handler of uploadHandlers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        ThrottlerGuard,
      );
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(
        10,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(
        60_000,
      );
    }
  });

  it('keeps the SSO-or-guest authentication guard on the owner upload route', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, getUploadHandler('uploadImage')),
    ).toContain(OptionalSsoAuthGuard);
  });

  it('throttles both protected image download routes', () => {
    for (const handler of imageDownloadHandlers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        ThrottlerGuard,
      );
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(
        60,
      );
    }
  });
});

describe('NotesController protected image responses', () => {
  const imageBytes = Buffer.from('image-bytes');

  function createResponseMock() {
    return {
      setHeader: jest.fn(),
      send: jest.fn(),
    };
  }

  it('passes the guest token to the private image authorization path', async () => {
    const getImage = jest.fn().mockResolvedValue(imageBytes);
    const notesService = {
      getImage,
    } as unknown as NotesService;
    const controller = new NotesController(notesService);
    const response = createResponseMock();

    await controller.getImage(
      { headers: { 'x-guest-token': 'guest-secret' } } as unknown as Request,
      'note-1',
      '0123456789abcdef01234567.webp',
      response as unknown as Response,
    );

    expect(getImage).toHaveBeenCalledWith(
      'note-1',
      '0123456789abcdef01234567.webp',
      undefined,
      'guest-secret',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/webp',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(response.send).toHaveBeenCalledWith(imageBytes);
  });

  it('passes authenticated users through and serves share images via share token', async () => {
    const getImage = jest.fn().mockResolvedValue(imageBytes);
    const getImageByShareToken = jest.fn().mockResolvedValue(imageBytes);
    const notesService = {
      getImage,
      getImageByShareToken,
    } as unknown as NotesService;
    const controller = new NotesController(notesService);
    const response = createResponseMock();

    await controller.getImage(
      {
        headers: {},
        user: { id: 'invitee-1' },
      } as unknown as Request,
      'note-1',
      '0123456789abcdef01234567.webp',
      response as unknown as Response,
    );
    expect(getImage).toHaveBeenCalledWith(
      'note-1',
      '0123456789abcdef01234567.webp',
      'invitee-1',
      undefined,
    );

    await controller.getImageByShareToken(
      'share-token',
      '0123456789abcdef01234567.webp',
      response as unknown as Response,
    );
    expect(getImageByShareToken).toHaveBeenCalledWith(
      'share-token',
      '0123456789abcdef01234567.webp',
    );
  });
});
