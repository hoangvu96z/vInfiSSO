import { createVietQrQuickLink } from './vietqr-link.util';

describe('createVietQrQuickLink', () => {
  it('builds a documented image quick link with the server amount and reference', () => {
    const result = createVietQrQuickLink({
      bankBin: '970436',
      accountNumber: '001234567890',
      amount: 99000,
      reference: 'VINF0123456789ABCDEF',
      accountName: 'NGUYEN VAN A',
    });
    const url = new URL(result);

    expect(url.origin).toBe('https://img.vietqr.io');
    expect(url.pathname).toBe('/image/970436-001234567890-qr_only.svg');
    expect(url.searchParams.get('amount')).toBe('99000');
    expect(url.searchParams.get('addInfo')).toBe('VINF0123456789ABCDEF');
    expect(url.searchParams.get('accountName')).toBe('NGUYEN VAN A');
  });

  it.each([
    {
      bankBin: '97043',
      accountNumber: '12345678',
      amount: 1000,
      reference: 'VINF12345678',
      accountName: 'A B',
    },
    {
      bankBin: '970436',
      accountNumber: '12/345678',
      amount: 1000,
      reference: 'VINF12345678',
      accountName: 'A B',
    },
    {
      bankBin: '970436',
      accountNumber: '12345678',
      amount: 1.5,
      reference: 'VINF12345678',
      accountName: 'A B',
    },
    {
      bankBin: '970436',
      accountNumber: '12345678',
      amount: 1000,
      reference: 'BAD REF',
      accountName: 'A B',
    },
  ])('rejects malformed transfer input %#', (input) => {
    expect(() => createVietQrQuickLink(input)).toThrow();
  });
});
