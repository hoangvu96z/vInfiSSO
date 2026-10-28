import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  IsEmail,
} from 'class-validator';

export class CreateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bgColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bgPattern?: string;
}

export class UpdateNoteDto extends CreateNoteDto {
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class ShareSettingsDto {
  @IsIn(['none', 'view', 'edit'])
  shareMode: 'none' | 'view' | 'edit';
}

export class CreateNoteInviteDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsIn(['view', 'edit'])
  permission?: 'view' | 'edit';
}

export class SetNotePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string | null;
}

export class VerifyNotePasswordDto {
  @IsString()
  @MaxLength(128)
  password: string;
}
