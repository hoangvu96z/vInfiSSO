import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePaymentSettingsDto } from './update-payment-settings.dto';

describe('UpdatePaymentSettingsDto', () => {
  it('normalizes whitespace and uppercases the account holder', async () => {
    const dto = plainToInstance(UpdatePaymentSettingsDto, {
      bankBin: '970436',
      bankName: '  Ngân   hàng A  ',
      accountNumber: ' 001234567890 ',
      accountName: '  Nguyen  Van   A ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.bankName).toBe('Ngân hàng A');
    expect(dto.accountNumber).toBe('001234567890');
    expect(dto.accountName).toBe('NGUYEN VAN A');
  });

  it('rejects invalid BINs, account numbers, and markup', async () => {
    const dto = plainToInstance(UpdatePaymentSettingsDto, {
      bankBin: '97043',
      bankName: '<script>alert(1)</script>',
      accountNumber: '12-34',
      accountName: '<b>ADMIN</b>',
    });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
