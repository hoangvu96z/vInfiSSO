import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export class ContactImageDto {
  @IsString()
  @MaxLength(2 * 1024 * 1024)
  data: string;

  @IsIn(IMAGE_MIMES)
  mime: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10 * 1024 * 1024)
  size?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  height?: number;
}

export class CreateContactMessageDto {
  @IsString()
  @MaxLength(64)
  sessionId: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsString()
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(2 * 1024 * 1024)
  imageData?: string;

  @IsOptional()
  @IsIn(IMAGE_MIMES)
  imageMime?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ContactImageDto)
  images?: ContactImageDto[];

  @IsOptional()
  @IsObject()
  clientMeta?: Record<string, unknown>;
}
