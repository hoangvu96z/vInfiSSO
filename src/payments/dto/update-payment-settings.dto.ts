import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

function transformString(
  value: unknown,
  transform: (value: string) => string,
): unknown {
  return typeof value === 'string' ? transform(value) : value;
}

export class UpdatePaymentSettingsDto {
  @Transform(({ value }) => transformString(value, (text) => text.trim()))
  @IsString()
  @Matches(/^\d{6}$/)
  bankBin: string;

  @Transform(({ value }) =>
    transformString(value, (text) => text.trim().replace(/\s+/g, ' ')),
  )
  @IsString()
  @Length(2, 100)
  @Matches(/^[\p{L}\p{N} .&'()/-]+$/u)
  bankName: string;

  @Transform(({ value }) => transformString(value, (text) => text.trim()))
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,19}$/)
  accountNumber: string;

  @Transform(({ value }) =>
    transformString(value, (text) =>
      text.trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi-VN'),
    ),
  )
  @IsString()
  @Length(2, 100)
  @Matches(/^[\p{L}\p{N} .'-]+$/u)
  accountName: string;
}
