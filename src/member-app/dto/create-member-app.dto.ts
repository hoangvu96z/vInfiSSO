import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMemberAppDto {
  @IsString()
  @IsNotEmpty()
  appName: string;

  @IsOptional()
  @IsString()
  appId?: string;

  @IsString()
  @IsNotEmpty()
  memberName: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
