import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { CreateContactMessageDto } from './dto/contact-write.dto';

describe('ContactController guest session access', () => {
  it('requires a guest token before returning messages for a session', async () => {
    const contactService = {
      isValidGuestSessionToken: jest.fn().mockReturnValue(false),
      getMessagesBySession: jest.fn(),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    await expect(
      controller.getSessionMessages('session-1', {
        headers: {},
      } as unknown as Request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(contactService.isValidGuestSessionToken).toHaveBeenCalledWith(
      'session-1',
      undefined,
    );
    expect(contactService.getMessagesBySession).not.toHaveBeenCalled();
  });

  it('rejects forged tokens before loading history', async () => {
    const contactService = {
      isValidGuestSessionToken: jest.fn().mockReturnValue(false),
      getMessagesBySession: jest.fn(),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    await expect(
      controller.getSessionMessages('session-1', {
        headers: { 'x-guest-token': 'forged-token' },
      } as unknown as Request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(contactService.isValidGuestSessionToken).toHaveBeenCalledWith(
      'session-1',
      'forged-token',
    );
    expect(contactService.getMessagesBySession).not.toHaveBeenCalled();
  });

  it('allows a signed token to read only its session history fields', async () => {
    const createdAt = new Date('2026-10-20T10:00:00.000Z');
    const contactService = {
      isValidGuestSessionToken: jest.fn().mockReturnValue(true),
      getMessagesBySession: jest.fn().mockResolvedValue([
        {
          id: 'message-1',
          sessionId: 'session-1',
          name: 'Visitor',
          email: 'visitor@example.test',
          title: 'Question',
          message: 'Private message content',
          images: [{ data: 'private-base64-image', mime: 'image/png' }],
          imageData: 'legacy-private-base64-image',
          imageMime: 'image/png',
          senderIp: '192.0.2.1',
          metadata: { timezone: 'Asia/Ho_Chi_Minh' },
          createdAt,
        },
      ]),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    await expect(
      controller.getSessionMessages('session-1', {
        headers: { 'x-guest-token': 'signed-guest-token' },
      } as unknown as Request),
    ).resolves.toEqual({
      messages: [
        {
          id: 'message-1',
          sessionId: 'session-1',
          name: 'Visitor',
          email: 'visitor@example.test',
          title: 'Question',
          message: 'Private message content',
          hasImage: true,
          imageCount: 1,
          createdAt,
        },
      ],
    });
    expect(contactService.isValidGuestSessionToken).toHaveBeenCalledWith(
      'session-1',
      'signed-guest-token',
    );
    expect(contactService.getMessagesBySession).toHaveBeenCalledWith(
      'session-1',
    );
  });

  it('supports x-guest-token supplied as an array header', async () => {
    const contactService = {
      isValidGuestSessionToken: jest.fn().mockReturnValue(true),
      getMessagesBySession: jest.fn().mockResolvedValue([]),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    await expect(
      controller.getSessionMessages('session-1', {
        headers: { 'x-guest-token': ['signed-guest-token', 'other'] },
      } as unknown as Request),
    ).resolves.toEqual({ messages: [] });
    expect(contactService.isValidGuestSessionToken).toHaveBeenCalledWith(
      'session-1',
      'signed-guest-token',
    );
  });

  it('rejects invalid or blank sessionId parameters', async () => {
    const contactService = {
      isValidGuestSessionToken: jest.fn(),
      getMessagesBySession: jest.fn(),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    await expect(
      controller.getSessionMessages('', {
        headers: { 'x-guest-token': 'token' },
      } as unknown as Request),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.getSessionMessages('   ', {
        headers: { 'x-guest-token': 'token' },
      } as unknown as Request),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.getSessionMessages('a'.repeat(65), {
        headers: { 'x-guest-token': 'token' },
      } as unknown as Request),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(contactService.isValidGuestSessionToken).not.toHaveBeenCalled();
    expect(contactService.getMessagesBySession).not.toHaveBeenCalled();
  });

  it('prevents anonymous callers from appending to existing sessions in createMessage', async () => {
    const contactService = {
      isValidGuestSessionToken: jest.fn().mockReturnValue(false),
      hasMessagesBySession: jest.fn().mockResolvedValue(true),
      createMessage: jest.fn(),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    await expect(
      controller.createMessage({ headers: {} } as unknown as Request, {
        sessionId: 'session-1',
        name: 'Attacker',
        message: 'Appending to existing session without token',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(contactService.hasMessagesBySession).toHaveBeenCalledWith(
      'session-1',
    );
    expect(contactService.createMessage).not.toHaveBeenCalled();
  });

  it('allows anonymous callers to start a new session and returns a guest token', async () => {
    const createdAt = new Date('2026-10-24T00:00:00.000Z');
    const contactService = {
      isValidGuestSessionToken: jest.fn().mockReturnValue(false),
      hasMessagesBySession: jest.fn().mockResolvedValue(false),
      createMessage: jest.fn().mockResolvedValue({
        id: 'msg-1',
        sessionId: 'session-new',
        name: 'New Visitor',
        email: 'visitor@example.test',
        title: 'Inquiry',
        message: 'Hello',
        images: [],
        createdAt,
      }),
      createGuestSessionToken: jest.fn().mockReturnValue('new-guest-token'),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    const result = await controller.createMessage(
      { headers: {} } as unknown as Request,
      {
        sessionId: 'session-new',
        name: 'New Visitor',
        email: 'visitor@example.test',
        title: 'Inquiry',
        message: 'Hello',
      },
    );

    expect(result).toEqual({
      message: {
        id: 'msg-1',
        sessionId: 'session-new',
        name: 'New Visitor',
        email: 'visitor@example.test',
        title: 'Inquiry',
        message: 'Hello',
        hasImage: false,
        imageCount: 0,
        createdAt,
      },
      guestToken: 'new-guest-token',
    });
    expect(contactService.createGuestSessionToken).toHaveBeenCalledWith(
      'session-new',
    );
  });

  it('rejects contact images whose combined encoded size exceeds the body budget', async () => {
    const contactService = {
      isValidGuestSessionToken: jest.fn(),
      hasMessagesBySession: jest.fn(),
      createMessage: jest.fn(),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );
    const imageLimit = 2 * 1024 * 1024;
    const body = {
      sessionId: 'session-1',
      name: 'Visitor',
      message: 'Help',
      images: [
        { data: 'a'.repeat(imageLimit), mime: 'image/jpeg' },
        { data: 'b'.repeat(imageLimit), mime: 'image/jpeg' },
        { data: 'c', mime: 'image/jpeg' },
      ],
    };

    await expect(
      controller.createMessage(
        { headers: {} } as unknown as Request,
        body as unknown as CreateContactMessageDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(contactService.createMessage).not.toHaveBeenCalled();
  });

  it('provides legacy imageData to admin clients when it is stored in images only', async () => {
    const image = { data: 'base64-image', mime: 'image/png' };
    const contactService = {
      getMessageById: jest.fn().mockResolvedValue({
        id: 'message-1',
        images: [image],
        imageData: null,
      }),
    };
    const controller = new ContactController(
      contactService as unknown as ContactService,
    );

    await expect(controller.adminGetMessage('message-1')).resolves.toEqual({
      message: {
        id: 'message-1',
        images: [image],
        imageData: image.data,
      },
    });
  });
});
