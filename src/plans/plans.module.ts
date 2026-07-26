import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { Plan } from './plan.entity';
import { UserSubscription } from './user-subscription.entity';
import { AiUsage } from './ai-usage.entity';
import { Coupon } from './coupon.entity';
import { User } from '../users/user.entity';
import { SsoModule } from '../sso/sso.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, UserSubscription, AiUsage, Coupon, User]),
    SsoModule,
  ],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule implements OnModuleInit {
  constructor(private readonly plansService: PlansService) {}

  /** Seed các gói mặc định nếu chưa có */
  async onModuleInit() {
    await this.plansService.upsertDefaultPlans();
  }
}
