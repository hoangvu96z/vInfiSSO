import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateLoginDto } from './dto/create-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  createLogin(@Body() dto: CreateLoginDto) {
    return this.authService.createLogin(dto);
  }

  @Get('logins')
  listLogins() {
    return this.authService.listLogins();
  }
}
