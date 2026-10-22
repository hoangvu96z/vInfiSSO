import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { SsoAuthGuard } from '../auth/auth.guard';
import type { User } from '../users/user.entity';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { PaymentOriginGuard } from './payment-origin.guard';
import { PaymentsService } from './payments.service';

@Controller('plans/orders')
@UseGuards(SsoAuthGuard, PaymentOriginGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  createOrder(
    @CurrentUser() user: User,
    @Body() body: CreatePaymentOrderDto,
    @Req() request: Request,
  ) {
    return this.paymentsService.createOrder(
      user.id,
      body.planName,
      request.ip || null,
      request.headers['user-agent'] || null,
    );
  }

  @Get()
  getMyOrders(@CurrentUser() user: User) {
    return this.paymentsService.getMyOrders(user.id);
  }

  @Get(':id')
  getMyOrder(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentsService.getMyOrder(user.id, id);
  }
}
