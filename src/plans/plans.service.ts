import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Plan } from './plan.entity';
import { UserSubscription } from './user-subscription.entity';
import { AiUsage } from './ai-usage.entity';
import { Coupon } from './coupon.entity';
import { User } from '../users/user.entity';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(UserSubscription)
    private readonly subRepo: Repository<UserSubscription>,
    @InjectRepository(AiUsage)
    private readonly usageRepo: Repository<AiUsage>,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Lấy ngày hôm nay dạng YYYY-MM-DD */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Lấy tháng hiện tại dạng YYYY-MM */
  private currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  /** Lấy config gói active cho user (có thể bị override bởi admin) */
  async getEffectivePlan(userId: string): Promise<Plan> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Admin được dùng tất cả không giới hạn
    if (user.role === 'admin') {
      return {
        name: 'admin',
        label: 'Admin',
        dailyLimit: -1,
        monthlyLimit: -1,
        canBonus: true,
        bonusAmount: 999,
        bonusMaxPerDay: 999,
        isActive: true,
        overrideFreeToLite: false,
        overrideFreeToPremium: false,
        price: 0,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Plan;
    }

    // Lấy subscription hiện tại của user
    const sub = await this.subRepo.findOne({
      where: [
        { userId, expiresAt: MoreThan(new Date()) },
        { userId, expiresAt: null as any },
      ],
      order: { createdAt: 'DESC' },
    });

    const planName = sub?.planName ?? user.planName ?? 'free';

    // Lấy cấu hình gói
    const plan = await this.planRepo.findOne({ where: { name: planName } });

    if (!plan) {
      // Fallback: trả Free plan mặc định
      return this.getDefaultFreePlan();
    }

    // Nếu user Free nhưng admin override toàn bộ Free lên Premium
    if (planName === 'free' && plan.overrideFreeToPremium) {
      const premiumPlan = await this.planRepo.findOne({ where: { name: 'premium' } });
      if (premiumPlan) return premiumPlan;
    }

    // Nếu user Free nhưng admin override lên Lite
    if (planName === 'free' && plan.overrideFreeToLite) {
      const litePlan = await this.planRepo.findOne({ where: { name: 'lite' } });
      if (litePlan) return litePlan;
    }

    return plan;
  }

  private getDefaultFreePlan(): Plan {
    const p = new Plan();
    p.name = 'free';
    p.label = 'Gói Miễn Phí';
    p.dailyLimit = 1;
    p.monthlyLimit = 30;
    p.canBonus = false;
    p.bonusAmount = 5;
    p.bonusMaxPerDay = 0;
    p.isActive = true;
    p.overrideFreeToLite = false;
    p.overrideFreeToPremium = false;
    p.price = 0;
    p.description = null;
    return p;
  }

  /** Lấy hoặc tạo AI usage record cho user hôm nay */
  private async getOrCreateUsage(userId: string): Promise<AiUsage> {
    const today = this.today();
    const month = this.currentMonth();

    let usage = await this.usageRepo.findOne({ where: { userId, date: today } });
    if (!usage) {
      usage = this.usageRepo.create({
        userId,
        date: today,
        month,
        dailyCount: 0,
        monthlyCount: 0,
        bonusUsedToday: 0,
        bonusRemaining: 0,
      });
      await this.usageRepo.save(usage);
    }
    return usage;
  }

  /** Kiểm tra quota còn lại của user */
  async checkQuota(userId: string): Promise<{
    plan: string;
    planLabel: string;
    dailyLimit: number;
    monthlyLimit: number;
    dailyUsed: number;
    monthlyUsed: number;
    bonusRemaining: number;
    canAsk: boolean;
    canBonus: boolean;
    bonusUsedToday: number;
    bonusMaxPerDay: number;
    remaining: number; // câu còn lại hôm nay (dailyLimit - dailyUsed + bonusRemaining)
    expiresAt: string | null;
    daysRemaining: number | null;
    isExpiringSoon: boolean;
    isOverride: boolean;
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const usage = await this.getOrCreateUsage(userId);
    const month = this.currentMonth();

    // TÍNH NĂNG ĐẶC QUYỀN ADMIN: Luôn luôn có quyền hỏi không giới hạn
    if (user.role === 'admin') {
      return {
        plan: 'admin',
        planLabel: 'Gói Admin (Vĩnh viễn)',
        dailyLimit: -1,
        monthlyLimit: -1,
        dailyUsed: usage.dailyCount,
        monthlyUsed: 0,
        bonusRemaining: 999,
        canAsk: true,
        canBonus: true,
        bonusUsedToday: 0,
        bonusMaxPerDay: 999,
        remaining: 9999,
        expiresAt: null,
        daysRemaining: null,
        isExpiringSoon: false,
        isOverride: false,
      };
    }

    const sub = await this.subRepo.findOne({
      where: [
        { userId, expiresAt: MoreThan(new Date()) },
        { userId, expiresAt: null as any },
      ],
      order: { createdAt: 'DESC' },
    });

    const plan = await this.getEffectivePlan(userId);
    const baseFreePlan = await this.planRepo.findOne({ where: { name: 'free' } });
    const isOverride = user?.planName === 'free' && (baseFreePlan?.overrideFreeToLite || baseFreePlan?.overrideFreeToPremium);

    let expiresAt: string | null = sub?.expiresAt ? new Date(sub.expiresAt).toISOString() : null;
    let daysRemaining: number | null = null;
    let isExpiringSoon = false;

    if (sub?.expiresAt) {
      const now = new Date();
      const exp = new Date(sub.expiresAt);
      const diffMs = exp.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      if (daysRemaining <= 5) {
        isExpiringSoon = true;
      }
    }

    // Tính monthly count tháng này
    const monthlyUsage = await this.usageRepo
      .createQueryBuilder('u')
      .select('SUM(u.dailyCount)', 'total')
      .where('u.userId = :userId AND u.month = :month', { userId, month })
      .getRawOne();
    const monthlyCount = parseInt(monthlyUsage?.total ?? '0', 10);

    const dailyLimit = plan.dailyLimit;
    const monthlyLimit = plan.monthlyLimit;

    const dailyExceeded = dailyLimit !== -1 && usage.dailyCount >= dailyLimit + usage.bonusRemaining;
    const monthlyExceeded = monthlyLimit !== -1 && monthlyCount >= monthlyLimit;

    const canAsk = !dailyExceeded && !monthlyExceeded;

    let remaining: number;
    if (dailyLimit === -1) {
      remaining = monthlyLimit === -1 ? 9999 : Math.max(0, monthlyLimit - monthlyCount);
    } else {
      remaining = Math.max(0, dailyLimit + usage.bonusRemaining - usage.dailyCount);
    }

    return {
      plan: plan.name,
      planLabel: plan.label,
      dailyLimit,
      monthlyLimit,
      dailyUsed: usage.dailyCount,
      monthlyUsed: monthlyCount,
      bonusRemaining: usage.bonusRemaining,
      canAsk,
      canBonus: plan.canBonus,
      bonusUsedToday: usage.bonusUsedToday,
      bonusMaxPerDay: plan.bonusMaxPerDay,
      remaining,
      expiresAt,
      daysRemaining,
      isExpiringSoon,
      isOverride: !!isOverride,
    };
  }

  /** Trừ 1 lượt AI. Throw ForbiddenException nếu hết quota */
  async consumeQuota(userId: string): Promise<void> {
    const quota = await this.checkQuota(userId);

    if (!quota.canAsk) {
      const msg =
        quota.monthlyUsed >= quota.monthlyLimit && quota.monthlyLimit !== -1
          ? `Bạn đã đạt giới hạn ${quota.monthlyLimit} lượt AI trong tháng này`
          : `Bạn đã dùng hết ${quota.dailyLimit} lượt AI hôm nay`;
      throw new ForbiddenException({
        statusCode: 429,
        error: 'Quota Exceeded',
        message: msg,
        plan: quota.plan,
        canBonus: quota.canBonus,
      });
    }

    const usage = await this.getOrCreateUsage(userId);

    // Nếu còn bonus thì tiêu bonus trước
    if (usage.bonusRemaining > 0 && usage.dailyCount >= (await this.getEffectivePlan(userId)).dailyLimit) {
      usage.bonusRemaining = Math.max(0, usage.bonusRemaining - 1);
    }

    usage.dailyCount += 1;
    usage.monthlyCount += 1;
    await this.usageRepo.save(usage);
  }

  /** Xin thêm bonus câu hỏi (Premium only) */
  async requestBonus(userId: string): Promise<{ bonusAdded: number; bonusRemaining: number }> {
    const plan = await this.getEffectivePlan(userId);

    if (!plan.canBonus) {
      throw new ForbiddenException('Chức năng "Hỏi thêm" chỉ dành cho gói Premium');
    }

    const usage = await this.getOrCreateUsage(userId);

    if (plan.bonusMaxPerDay !== -1 && usage.bonusUsedToday >= plan.bonusMaxPerDay) {
      throw new ForbiddenException(
        `Bạn đã dùng tối đa ${plan.bonusMaxPerDay} lần "Hỏi thêm" hôm nay`,
      );
    }

    usage.bonusUsedToday += 1;
    usage.bonusRemaining += plan.bonusAmount;
    await this.usageRepo.save(usage);

    return { bonusAdded: plan.bonusAmount, bonusRemaining: usage.bonusRemaining };
  }

  /** Lấy subscription info của user */
  async getMySubscription(userId: string): Promise<{
    planName: string;
    planLabel: string;
    expiresAt: Date | null;
    grantedByCoupon: string | null;
    grantedByAdmin: boolean;
    isExpired: boolean;
  }> {
    const plan = await this.getEffectivePlan(userId);
    const sub = await this.subRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const isExpired = sub?.expiresAt ? sub.expiresAt < new Date() : false;

    return {
      planName: plan.name,
      planLabel: plan.label,
      expiresAt: sub?.expiresAt ?? null,
      grantedByCoupon: sub?.grantedByCoupon ?? null,
      grantedByAdmin: sub?.grantedByAdmin ?? false,
      isExpired,
    };
  }

  /** Áp mã khuyến mãi */
  async applyCoupon(userId: string, code: string): Promise<{ message: string; planName: string }> {
    const coupon = await this.couponRepo.findOne({ where: { code: code.toUpperCase(), isActive: true } });

    if (!coupon) {
      throw new NotFoundException('Mã khuyến mãi không tồn tại hoặc đã hết hạn');
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      throw new BadRequestException('Mã khuyến mãi đã hết hạn');
    }

    if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('Mã khuyến mãi đã được sử dụng hết');
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + coupon.durationDays);

    if (coupon.type === 'grant_plan' && coupon.planName) {
      // Tặng gói
      const newSub = this.subRepo.create({
        userId,
        planName: coupon.planName,
        startedAt: now,
        expiresAt,
        grantedByCoupon: code.toUpperCase(),
        grantedByAdmin: false,
      });
      await this.subRepo.save(newSub);

      // Cập nhật planName trên user để cache
      await this.userRepo.update(userId, { planName: coupon.planName });

      coupon.usedCount += 1;
      await this.couponRepo.save(coupon);

      return { message: `Kích hoạt thành công gói ${coupon.planName}!`, planName: coupon.planName };
    }

    if (coupon.type === 'trial_days') {
      // Thêm ngày vào gói hiện tại
      const currentSub = await this.subRepo.findOne({
        where: { userId },
        order: { createdAt: 'DESC' },
      });

      const baseDate = currentSub?.expiresAt && currentSub.expiresAt > now ? currentSub.expiresAt : now;
      const newExpires = new Date(baseDate);
      newExpires.setDate(newExpires.getDate() + coupon.durationDays);

      const newSub = this.subRepo.create({
        userId,
        planName: currentSub?.planName ?? 'free',
        startedAt: now,
        expiresAt: newExpires,
        grantedByCoupon: code.toUpperCase(),
        grantedByAdmin: false,
      });
      await this.subRepo.save(newSub);

      coupon.usedCount += 1;
      await this.couponRepo.save(coupon);

      return {
        message: `Đã thêm ${coupon.durationDays} ngày vào gói của bạn!`,
        planName: currentSub?.planName ?? 'free',
      };
    }

    throw new BadRequestException('Loại mã khuyến mãi không hỗ trợ');
  }

  // ─── Admin methods ────────────────────────────────────────────────────────

  async getAllPlans(): Promise<Plan[]> {
    return this.planRepo.find();
  }

  async updatePlan(name: string, data: Partial<Plan>): Promise<Plan> {
    const plan = await this.planRepo.findOne({ where: { name } });
    if (!plan) throw new NotFoundException(`Plan "${name}" not found`);
    Object.assign(plan, data);
    return this.planRepo.save(plan);
  }

  async upsertDefaultPlans(): Promise<void> {
    const defaults: Partial<Plan>[] = [
      {
        name: 'free',
        label: 'Gói Miễn Phí',
        dailyLimit: 1,
        monthlyLimit: 30,
        canBonus: false,
        bonusAmount: 5,
        bonusMaxPerDay: 0,
        isActive: true,
        overrideFreeToLite: false,
        overrideFreeToPremium: false,
        price: 0,
        description: 'Dành cho tất cả người dùng mới',
      },
      {
        name: 'lite',
        label: 'Gói Lite',
        dailyLimit: 5,
        monthlyLimit: 60,
        canBonus: false,
        bonusAmount: 5,
        bonusMaxPerDay: 0,
        isActive: true,
        overrideFreeToLite: false,
        overrideFreeToPremium: false,
        price: 49000,
        description: 'Hỏi AI tối đa 5 lần/ngày, 60 lần/tháng',
      },
      {
        name: 'premium',
        label: 'Gói Premium',
        dailyLimit: -1,
        monthlyLimit: 180,
        canBonus: true,
        bonusAmount: 5,
        bonusMaxPerDay: 1,
        isActive: true,
        overrideFreeToLite: false,
        overrideFreeToPremium: false,
        price: 99000,
        description: 'Không giới hạn ngày, 180 lần/tháng, hỏi thêm 5 câu mỗi ngày',
      },
    ];

    for (const d of defaults) {
      const exists = await this.planRepo.findOne({ where: { name: d.name } });
      if (!exists) {
        await this.planRepo.save(this.planRepo.create(d));
      }
    }
  }

  async getAllCoupons(): Promise<Coupon[]> {
    return this.couponRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createCoupon(data: Partial<Coupon>): Promise<Coupon> {
    if (!data.code) throw new BadRequestException('Mã coupon là bắt buộc');
    data.code = data.code.toUpperCase();
    const existing = await this.couponRepo.findOne({ where: { code: data.code } });
    if (existing) throw new BadRequestException('Mã này đã tồn tại');
    const coupon = this.couponRepo.create(data);
    return this.couponRepo.save(coupon);
  }

  async updateCoupon(id: string, data: Partial<Coupon>): Promise<Coupon> {
    const coupon = await this.couponRepo.findOne({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    Object.assign(coupon, data);
    return this.couponRepo.save(coupon);
  }

  async deleteCoupon(id: string): Promise<void> {
    const coupon = await this.couponRepo.findOne({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    await this.couponRepo.remove(coupon);
  }

  async adminGrantPlan(
    userId: string,
    planName: string,
    durationDays: number,
  ): Promise<UserSubscription> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const expiresAt = durationDays > 0 ? new Date(now.getTime() + durationDays * 86400000) : null;

    const sub = this.subRepo.create({
      userId,
      planName,
      startedAt: now,
      expiresAt,
      grantedByAdmin: true,
      grantedByCoupon: null,
    });
    await this.subRepo.save(sub);
    await this.userRepo.update(userId, { planName });

    return sub;
  }

  async adminRevokePlan(userId: string): Promise<void> {
    await this.subRepo.update({ userId }, { expiresAt: new Date() });
    await this.userRepo.update(userId, { planName: 'free' });
  }

  async getQuotaStats(): Promise<any> {
    const today = this.today();
    const month = this.currentMonth();

    const dailyStats = await this.usageRepo
      .createQueryBuilder('u')
      .select('SUM(u.dailyCount)', 'total')
      .where('u.date = :today', { today })
      .getRawOne();

    const monthlyStats = await this.usageRepo
      .createQueryBuilder('u')
      .select('SUM(u.dailyCount)', 'total')
      .where('u.month = :month', { month })
      .getRawOne();

    const planCounts = await this.userRepo
      .createQueryBuilder('u')
      .select('u.planName', 'plan')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.planName')
      .getRawMany();

    const topUsers = await this.usageRepo
      .createQueryBuilder('u')
      .select(['u.userId', 'u.dailyCount', 'u.bonusUsedToday'])
      .where('u.date = :today', { today })
      .orderBy('u.dailyCount', 'DESC')
      .limit(10)
      .getMany();

    return {
      today: parseInt(dailyStats?.total ?? '0', 10),
      thisMonth: parseInt(monthlyStats?.total ?? '0', 10),
      planDistribution: planCounts,
      topUsers,
    };
  }
}
