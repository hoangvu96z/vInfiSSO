import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, MoreThan, type EntityManager } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Plan } from '../plans/plan.entity';
import { User } from '../users/user.entity';
import { UserSubscription } from '../plans/user-subscription.entity';
import { AuditLog } from '../users/audit-log.entity';
import { PaymentOrder } from './payment-order.entity';
import { PaymentSettings } from './payment-settings.entity';
import { PaymentWebhookEvent } from './payment-webhook-event.entity';
import { SePayWebhookDto } from './dto/sepay-webhook.dto';
import { extractSePayPaymentReference } from './sepay-webhook.util';
import { createVietQrQuickLink } from './vietqr-link.util';
import type { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';
import { parseAdminDateRange } from '../common/admin-date-range.util';

const PURCHASE_DURATION_DAYS = 30;
const ORDER_VALIDITY_HOURS = 24;
// VietQR Quick Link supports transfer amounts up to 13 digits.
const MAX_VIETQR_AMOUNT = 9_999_999_999_999;

interface AdminPaymentOrderRow {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  planName: string;
  planLabel: string;
  amount: string;
  currency: string;
  reference: string;
  status: PaymentOrder['status'];
  expiresAt: Date | string;
  paidAt: Date | string | null;
  reviewedBy: string | null;
  createdAt: Date | string;
}

function safePrice(plan: Plan): number {
  const amount = Number(plan.price);
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > MAX_VIETQR_AMOUNT
  ) {
    throw new BadRequestException('Gói này chưa có giá thanh toán hợp lệ');
  }
  return amount;
}

function createPaymentReference(): string {
  return `VINF${randomBytes(8).toString('hex').toUpperCase()}`;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly dataSource: DataSource) {}

  async createOrder(
    userId: string,
    planName: string,
    ipAddress: string | null,
    userAgent: string | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const plan = await manager.getRepository(Plan).findOne({
        where: { name: planName },
      });
      if (!plan || !plan.isActive || plan.name === 'free') {
        throw new BadRequestException('Gói dịch vụ không thể thanh toán');
      }

      const settings = await manager.getRepository(PaymentSettings).findOne({
        where: { id: 1 },
      });
      if (!settings) {
        throw new ServiceUnavailableException({
          code: 'PAYMENT_NOT_CONFIGURED',
          message: 'Thanh toán VietQR chưa được cấu hình bởi quản trị viên.',
        });
      }

      const amount = safePrice(plan);
      const orderRepo = manager.getRepository(PaymentOrder);
      const order = await orderRepo.save(
        orderRepo.create({
          userId,
          planName: plan.name,
          planLabel: plan.label,
          amount: String(amount),
          currency: 'VND',
          reference: createPaymentReference(),
          durationDays: PURCHASE_DURATION_DAYS,
          status: 'pending',
          bankBin: settings.bankBin,
          bankName: settings.bankName,
          accountNumber: settings.accountNumber,
          accountName: settings.accountName,
          expiresAt: new Date(
            Date.now() + ORDER_VALIDITY_HOURS * 60 * 60 * 1000,
          ),
        }),
      );

      await manager.getRepository(AuditLog).save({
        userId,
        action: 'payment_order_created',
        app: 'sso',
        ipAddress,
        userAgent,
        metadata: {
          orderId: order.id,
          reference: order.reference,
          planName: order.planName,
          amount,
          currency: order.currency,
        },
      });

      return this.toUserOrder(order);
    });
  }

  async getMyOrders(userId: string) {
    const orders = await this.dataSource.getRepository(PaymentOrder).find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return orders.map((order) => this.toUserOrder(order));
  }

  async getMyOrder(userId: string, id: string) {
    const order = await this.dataSource.getRepository(PaymentOrder).findOne({
      where: { id, userId },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn thanh toán');
    return this.toUserOrder(order);
  }

  async getPaymentSettings() {
    const settings = await this.dataSource
      .getRepository(PaymentSettings)
      .findOne({ where: { id: 1 } });
    if (!settings) return { configured: false, settings: null };
    return {
      configured: true,
      settings: {
        bankBin: settings.bankBin,
        bankName: settings.bankName,
        accountNumber: settings.accountNumber,
        accountName: settings.accountName,
        updatedBy: settings.updatedBy,
        updatedAt: settings.updatedAt,
      },
    };
  }

  async updatePaymentSettings(
    dto: UpdatePaymentSettingsDto,
    adminId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ) {
    const settings = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PaymentSettings);
      const current = await repo.findOne({ where: { id: 1 } });
      const saved = await repo.save(
        repo.create({
          ...current,
          id: 1,
          bankBin: dto.bankBin,
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          accountName: dto.accountName,
          updatedBy: adminId,
        }),
      );
      await manager.getRepository(AuditLog).save({
        userId: adminId,
        action: 'payment_settings_updated',
        app: 'sso',
        ipAddress,
        userAgent,
        metadata: {
          bankBin: saved.bankBin,
          bankName: saved.bankName,
          accountLast4: saved.accountNumber.slice(-4),
        },
      });
      return saved;
    });
    return {
      configured: true,
      settings: {
        bankBin: settings.bankBin,
        bankName: settings.bankName,
        accountNumber: settings.accountNumber,
        accountName: settings.accountName,
        updatedBy: settings.updatedBy,
        updatedAt: settings.updatedAt,
      },
    };
  }

  async getAdminOrders() {
    const rows = await this.createAdminOrdersQuery()
      .take(100)
      .getRawMany<AdminPaymentOrderRow>();

    return this.mapAdminOrderRows(rows);
  }

  async getAdminOrdersPage(
    page = 1,
    limit = 20,
    status = '',
    search = '',
    dateFrom?: string,
    dateTo?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const { start, end } = parseAdminDateRange(dateFrom, dateTo);
    const query = this.createAdminOrdersQuery();

    if (status === 'paid') {
      query.andWhere('paymentOrder.status = :status', { status: 'paid' });
    } else if (status === 'pending') {
      query
        .andWhere('paymentOrder.status = :status', { status: 'pending' })
        .andWhere('paymentOrder.expiresAt > :now', { now: new Date() });
    } else if (status === 'expired') {
      query
        .andWhere('paymentOrder.status = :status', { status: 'pending' })
        .andWhere('paymentOrder.expiresAt <= :now', { now: new Date() });
    }

    if (search.trim()) {
      query.andWhere(
        '(paymentUser.email ILIKE :search OR paymentOrder.reference ILIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }
    if (start) {
      query.andWhere('paymentOrder.createdAt >= :dateFrom', {
        dateFrom: start,
      });
    }
    if (end) {
      query.andWhere('paymentOrder.createdAt < :dateTo', { dateTo: end });
    }

    const [rows, total] = await Promise.all([
      query
        .clone()
        .skip((safePage - 1) * safeLimit)
        .take(safeLimit)
        .getRawMany<AdminPaymentOrderRow>(),
      query.clone().getCount(),
    ]);

    return {
      orders: this.mapAdminOrderRows(rows),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  private createAdminOrdersQuery() {
    return this.dataSource
      .getRepository(PaymentOrder)
      .createQueryBuilder('paymentOrder')
      .innerJoin(User, 'paymentUser', 'paymentUser.id = paymentOrder.userId')
      .select('paymentOrder.id', 'id')
      .addSelect('paymentOrder.userId', 'userId')
      .addSelect('paymentUser.email', 'email')
      .addSelect('paymentUser.displayName', 'displayName')
      .addSelect('paymentOrder.planName', 'planName')
      .addSelect('paymentOrder.planLabel', 'planLabel')
      .addSelect('paymentOrder.amount', 'amount')
      .addSelect('paymentOrder.currency', 'currency')
      .addSelect('paymentOrder.reference', 'reference')
      .addSelect('paymentOrder.status', 'status')
      .addSelect('paymentOrder.expiresAt', 'expiresAt')
      .addSelect('paymentOrder.paidAt', 'paidAt')
      .addSelect('paymentOrder.reviewedBy', 'reviewedBy')
      .addSelect('paymentOrder.createdAt', 'createdAt')
      .orderBy('paymentOrder.createdAt', 'DESC')
      .addOrderBy('paymentOrder.id', 'ASC');
  }

  private mapAdminOrderRows(rows: AdminPaymentOrderRow[]) {
    const now = new Date();
    return rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      status:
        row.status === 'pending' && new Date(row.expiresAt) <= now
          ? 'expired'
          : row.status,
    }));
  }

  async markOrderPaid(
    id: string,
    adminId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(PaymentOrder);
      const order = await orderRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Không tìm thấy đơn thanh toán');
      if (order.status === 'paid') {
        return { order: this.toAdminOrder(order), alreadyPaid: true };
      }

      const { savedOrder, subscription } = await this.fulfillPaymentOrder(
        manager,
        order,
        adminId,
      );
      await manager.getRepository(AuditLog).save({
        userId: adminId,
        action: 'payment_order_marked_paid',
        app: 'sso',
        ipAddress,
        userAgent,
        metadata: {
          orderId: order.id,
          userId: order.userId,
          reference: order.reference,
          planName: order.planName,
          amount: Number(order.amount),
          subscriptionId: subscription.id,
        },
      });

      return {
        order: this.toAdminOrder(savedOrder),
        alreadyPaid: false,
        subscription: {
          id: subscription.id,
          planName: subscription.planName,
          startedAt: subscription.startedAt,
          expiresAt: subscription.expiresAt,
        },
      };
    });
  }

  async processSePayWebhook(
    payload: SePayWebhookDto,
    rawBody: Buffer,
    signatureTimestamp: number,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<{ success: true }> {
    if (!Number.isSafeInteger(payload.id) || payload.id <= 0) {
      throw new BadRequestException('SePay transaction ID must be positive');
    }

    const reference = extractSePayPaymentReference(
      payload.code,
      payload.content,
    );
    const payloadSha256 = createHash('sha256').update(rawBody).digest('hex');

    return this.dataSource.transaction(async (manager) => {
      const eventRepo = manager.getRepository(PaymentWebhookEvent);
      const insertResult = await eventRepo
        .createQueryBuilder()
        .insert()
        .into(PaymentWebhookEvent)
        .values(
          eventRepo.create({
            provider: 'sepay',
            providerTransactionId: String(payload.id),
            paymentOrderId: null,
            transferType: payload.transferType,
            gateway: payload.gateway,
            reference,
            amount: String(payload.transferAmount),
            accountLast4: payload.accountNumber.slice(-4),
            signatureTimestamp: String(signatureTimestamp),
            payloadSha256,
            outcome: 'received',
            rejectionReason: null,
          }),
        )
        .orIgnore()
        .returning(['id'])
        .execute();

      const insertedEvent = (
        insertResult.raw as Array<{ id?: string }> | undefined
      )?.[0];
      if (!insertedEvent?.id) {
        // A unique (provider, transaction ID) constraint makes simultaneous
        // deliveries converge here after the first transaction commits.
        return { success: true };
      }

      const orderRepo = manager.getRepository(PaymentOrder);
      let order: PaymentOrder | null = null;
      let rejectionReason: string | null = null;

      if (payload.transferType !== 'in') {
        rejectionReason = 'transfer_not_incoming';
      } else if (!reference) {
        rejectionReason = 'invalid_reference';
      } else {
        order = await orderRepo.findOne({
          where: { reference },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) {
          rejectionReason = 'order_not_found';
        } else if (order.status !== 'pending') {
          rejectionReason =
            order.status === 'paid'
              ? 'order_already_paid'
              : 'order_not_pending';
        } else if (order.expiresAt.getTime() <= Date.now()) {
          rejectionReason = 'order_expired';
        } else if (payload.accountNumber !== order.accountNumber) {
          rejectionReason = 'account_mismatch';
        } else if (
          !Number.isSafeInteger(Number(order.amount)) ||
          payload.transferAmount !== Number(order.amount)
        ) {
          rejectionReason = 'amount_mismatch';
        }
      }

      const auditRepo = manager.getRepository(AuditLog);
      if (rejectionReason || !order) {
        await eventRepo.update(insertedEvent.id, {
          paymentOrderId: order?.id ?? null,
          outcome: 'ignored',
          rejectionReason: rejectionReason ?? 'order_not_found',
        });
        await auditRepo.save({
          userId: order?.userId ?? null,
          action: 'payment_sepay_event_ignored',
          app: 'sso',
          ipAddress,
          userAgent,
          metadata: {
            provider: 'sepay',
            providerEventId: insertedEvent.id,
            providerTransactionId: String(payload.id),
            orderId: order?.id ?? null,
            reference,
            amount: payload.transferAmount,
            outcome: 'ignored',
            reason: rejectionReason ?? 'order_not_found',
            payloadSha256,
          },
        });
        return { success: true };
      }

      const { savedOrder, subscription } = await this.fulfillPaymentOrder(
        manager,
        order,
        null,
      );
      await eventRepo.update(insertedEvent.id, {
        paymentOrderId: order.id,
        outcome: 'paid',
        rejectionReason: null,
      });
      await auditRepo.save({
        userId: order.userId,
        action: 'payment_sepay_event_paid',
        app: 'sso',
        ipAddress,
        userAgent,
        metadata: {
          provider: 'sepay',
          providerEventId: insertedEvent.id,
          providerTransactionId: String(payload.id),
          orderId: savedOrder.id,
          reference: savedOrder.reference,
          amount: payload.transferAmount,
          planName: savedOrder.planName,
          subscriptionId: subscription.id,
          payloadSha256,
        },
      });

      return { success: true };
    });
  }

  private async fulfillPaymentOrder(
    manager: EntityManager,
    order: PaymentOrder,
    reviewedBy: string | null,
  ) {
    const now = new Date();
    const userRepo = manager.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: order.userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng của đơn');

    const subscriptions = manager.getRepository(UserSubscription);
    const current = await subscriptions.findOne({
      where: {
        userId: order.userId,
        planName: order.planName,
        expiresAt: MoreThan(now),
      },
      order: { expiresAt: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
    const startsAt =
      current?.expiresAt && current.expiresAt > now ? current.expiresAt : now;
    const expiresAt = new Date(
      startsAt.getTime() + order.durationDays * 24 * 60 * 60 * 1000,
    );
    const subscription = await subscriptions.save(
      subscriptions.create({
        userId: order.userId,
        planName: order.planName,
        startedAt: startsAt,
        expiresAt,
        grantedByAdmin: false,
        grantedByCoupon: null,
      }),
    );
    await userRepo.update(order.userId, { planName: order.planName });

    order.status = 'paid';
    order.paidAt = now;
    order.reviewedBy = reviewedBy;
    const savedOrder = await manager.getRepository(PaymentOrder).save(order);
    return { savedOrder, subscription };
  }

  private toUserOrder(order: PaymentOrder) {
    const expired =
      order.status === 'pending' && order.expiresAt.getTime() <= Date.now();
    const status = expired ? 'expired' : order.status;
    const amount = Number(order.amount);
    return {
      id: order.id,
      planName: order.planName,
      planLabel: order.planLabel,
      amount,
      currency: order.currency,
      reference: order.reference,
      status,
      bankBin: order.bankBin,
      bankName: order.bankName,
      accountNumber: order.accountNumber,
      accountName: order.accountName,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      qrImageUrl:
        status === 'pending'
          ? createVietQrQuickLink({
              bankBin: order.bankBin,
              accountNumber: order.accountNumber,
              amount,
              reference: order.reference,
              accountName: order.accountName,
            })
          : null,
    };
  }

  private toAdminOrder(order: PaymentOrder) {
    return {
      id: order.id,
      userId: order.userId,
      planName: order.planName,
      planLabel: order.planLabel,
      amount: Number(order.amount),
      currency: order.currency,
      reference: order.reference,
      status:
        order.status === 'pending' && order.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : order.status,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      reviewedBy: order.reviewedBy,
      createdAt: order.createdAt,
    };
  }
}
