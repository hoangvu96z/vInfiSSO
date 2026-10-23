import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_SAFE_TRANSFER_AMOUNT = Number.MAX_SAFE_INTEGER;

export class SePayWebhookDto {
  @IsInt()
  @Min(0)
  @Max(MAX_SAFE_TRANSFER_AMOUNT)
  id: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  gateway: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  transactionDate: string;

  @IsString()
  @MinLength(6)
  @MaxLength(19)
  @Matches(/^[A-Za-z0-9]+$/)
  accountNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subAccount?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string | null;

  @IsString()
  @MaxLength(4000)
  content: string;

  @IsIn(['in', 'out'])
  transferType: 'in' | 'out';

  @IsInt()
  @Min(1)
  @Max(MAX_SAFE_TRANSFER_AMOUNT)
  transferAmount: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SAFE_TRANSFER_AMOUNT)
  accumulateAmount?: number;
}
