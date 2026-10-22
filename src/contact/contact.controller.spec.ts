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
