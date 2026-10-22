import { validate } from 'class-validator';
import { RecordVisitDto } from './record-visit.dto';

describe('RecordVisitDto', () => {
  it('rejects script URLs as referrers while accepting web URLs', async () => {
    const unsafe = Object.assign(new RecordVisitDto(), {
      app: 'talkwithme',
      referrer: 'javascript:alert(1)',
    });
    const safe = Object.assign(new RecordVisitDto(), {
      app: 'talkwithme',
      referrer: 'https://example.test/article',
    });

    expect(await validate(unsafe)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'referrer' }),
      ]),
    );
    expect(await validate(safe)).toHaveLength(0);
  });
});
