import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../users/user.entity';
import { PaymentOriginGuard } from './payment-origin.guard';
import { PaymentsService } from './payments.service';
import { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';

@Controller('admin')
@AdminOnly()
@UseGuards(PaymentOriginGuard)
export class AdminPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('payment-settings')
  getPaymentSettings() {
    return this.paymentsService.getPaymentSettings();
  }

  @Patch('payment-settings')
  updatePaymentSettings(
    @Body() body: UpdatePaymentSettingsDto,
    @CurrentUser() admin: User,
    @Req() request: Request,
  ) {
    return this.paymentsService.updatePaymentSettings(
      body,
      admin.id,
      request.ip || null,
      request.headers['user-agent'] || null,
    );
  }

  @Get('payment-orders')
  getPaymentOrders() {
    return this.paymentsService.getAdminOrders();
  }

  @Post('payment-orders/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  markOrderPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
    @Req() request: Request,
  ) {
    return this.paymentsService.markOrderPaid(
      id,
      admin.id,
      request.ip || null,
      request.headers['user-agent'] || null,
    );
  }
}
