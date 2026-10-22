import { validate } from 'class-validator';
import { UpdateProfileDto } from './sso-write.dto';

describe('UpdateProfileDto', () => {
  it('rejects javascript avatar URLs and accepts http(s) URLs', async () => {
    const unsafe = Object.assign(new UpdateProfileDto(), {
      avatarUrl: 'javascript:alert(1)',
    });
    const safe = Object.assign(new UpdateProfileDto(), {
      avatarUrl: 'https://cdn.example.test/avatar.png',
    });

    expect(await validate(unsafe)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'avatarUrl' }),
      ]),
    );
    expect(await validate(safe)).toHaveLength(0);
  });
});
