import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SsoModule } from '../sso/sso.module';
import { Plan } from '../plans/plan.entity';
import { UserSubscription } from '../plans/user-subscription.entity';
import { User } from '../users/user.entity';
import { AuditLog } from '../users/audit-log.entity';
import { PaymentOrder } from './payment-order.entity';
import { PaymentSettings } from './payment-settings.entity';
import { PaymentWebhookEvent } from './payment-webhook-event.entity';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsController } from './payments.controller';
import { SePayWebhookController } from './sepay-webhook.controller';
import { PaymentOriginGuard } from './payment-origin.guard';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentOrder,
      PaymentSettings,
      PaymentWebhookEvent,
      Plan,
      UserSubscription,
      User,
      AuditLog,
    ]),
    SsoModule,
  ],
  controllers: [
    PaymentsController,
    AdminPaymentsController,
    SePayWebhookController,
  ],
  providers: [PaymentsService, PaymentOriginGuard],
})
export class PaymentsModule {}
