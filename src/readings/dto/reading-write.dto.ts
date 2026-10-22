import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReadingDto {
  @IsString()
  @MaxLength(50)
  app: string;

  @IsString()
  @MaxLength(100)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  question?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsObject()
  data: Record<string, unknown>;
}

export class UpdateReadingDto {
  @IsObject()
  data: Record<string, unknown>;
}
