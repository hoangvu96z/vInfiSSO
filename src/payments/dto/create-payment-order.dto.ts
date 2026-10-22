import { IsString, Length, Matches } from 'class-validator';

export class CreatePaymentOrderDto {
  @IsString()
  @Length(1, 50)
  @Matches(/^[a-z][a-z0-9_-]*$/i)
  planName: string;
}
