import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditLog } from '../users/audit-log.entity';
import { Plan } from '../plans/plan.entity';
import { User } from '../users/user.entity';
import { UserSubscription } from '../plans/user-subscription.entity';
import { PaymentOrder } from './payment-order.entity';
import { PaymentSettings } from './payment-settings.entity';
import { PaymentsService } from './payments.service';
import type { DataSource } from 'typeorm';

function transactionHarness(repositories: Map<unknown, unknown>) {
  const manager = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  };
  const dataSource = {
    transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  };
  return { manager, dataSource };
}

function configuredSettings() {
  return {
    id: 1,
    bankBin: '970436',
    bankName: 'Bank Example',
    accountNumber: '001234567890',
    accountName: 'NGUYEN VAN A',
    updatedBy: 'admin-id',
    updatedAt: new Date(),
  };
}

describe('PaymentsService', () => {
  it('server-paginates, searches, and date-filters admin orders', async () => {
    const pageQuery = {
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'order-1',
          userId: 'user-1',
          email: 'member@example.test',
          displayName: 'Member',
          planName: 'premium',
          planLabel: 'Premium',
          amount: '99000',
          currency: 'VND',
          reference: 'VINF123',
          status: 'pending',
          expiresAt: new Date(Date.now() + 60_000),
          paidAt: null,
          reviewedBy: null,
          createdAt: new Date('2026-10-05T12:00:00Z'),
        },
      ]),
    };
    const countQuery = { getCount: jest.fn().mockResolvedValue(31) };
    const query = {
      innerJoin: jest.fn(),
      select: jest.fn(),
      addSelect: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      andWhere: jest.fn(),
      clone: jest
        .fn()
        .mockReturnValueOnce(pageQuery)
        .mockReturnValueOnce(countQuery),
    };
    query.innerJoin.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.addSelect.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.addOrderBy.mockReturnValue(query);
    query.andWhere.mockReturnValue(query);
    const orderRepo = { createQueryBuilder: jest.fn().mockReturnValue(query) };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(orderRepo),
    };

    const result = await new PaymentsService(
      dataSource as unknown as DataSource,
    ).getAdminOrdersPage(
      3,
      10,
      'pending',
      'member',
      '2026-10-01',
      '2026-10-10',
    );

    expect(pageQuery.skip).toHaveBeenCalledWith(20);
    expect(pageQuery.take).toHaveBeenCalledWith(10);
    expect(query.addOrderBy).toHaveBeenCalledWith('paymentOrder.id', 'ASC');
    expect(countQuery.getCount).toHaveBeenCalledTimes(1);
    expect(query.andWhere).toHaveBeenCalledWith(
      'paymentOrder.status = :status',
      { status: 'pending' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'paymentOrder.expiresAt > :now',
      { now: expect.any(Date) as unknown },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      '(paymentUser.email ILIKE :search OR paymentOrder.reference ILIKE :search)',
      { search: '%member%' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'paymentOrder.createdAt >= :dateFrom',
      { dateFrom: new Date('2026-10-01T00:00:00.000Z') },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'paymentOrder.createdAt < :dateTo',
      { dateTo: new Date('2026-10-11T00:00:00.000Z') },
    );
    expect(result).toMatchObject({
      total: 31,
      page: 3,
      limit: 10,
      totalPages: 4,
      orders: [{ id: 'order-1', amount: 99000, status: 'pending' }],
    });
  });

  it('creates a pending order using the active server plan price and configured bank snapshot', async () => {
    const plan = {
      name: 'premium',
      label: 'Gói Premium',
      price: 99000,
      isActive: true,
    } as Plan;
    const planRepo = { findOne: jest.fn().mockResolvedValue(plan) };
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(configuredSettings()),
    };
    const savedAudit = jest.fn().mockResolvedValue(undefined);
    const auditRepo = { save: savedAudit };
    const savedOrder = jest.fn((order: Partial<PaymentOrder>) =>
      Promise.resolve({
        ...order,
        id: 'order-id',
        createdAt: new Date(),
        paidAt: null,
        reviewedBy: null,
      }),
    );
    const orderRepo = {
      create: jest.fn((order: Partial<PaymentOrder>) => order),
      save: savedOrder,
    };
    const { dataSource } = transactionHarness(
      new Map<unknown, unknown>([
        [Plan, planRepo],
        [PaymentSettings, settingsRepo],
        [PaymentOrder, orderRepo],
        [AuditLog, auditRepo],
      ]),
    );

    const result = await new PaymentsService(
      dataSource as unknown as DataSource,
    ).createOrder('customer-id', 'premium', '203.0.113.1', 'test-agent');

    const inserted = savedOrder.mock.calls[0][0];
    expect(inserted).toMatchObject({
      userId: 'customer-id',
      planName: 'premium',
      planLabel: 'Gói Premium',
      amount: '99000',
      currency: 'VND',
      durationDays: 30,
      status: 'pending',
      bankBin: '970436',
      accountNumber: '001234567890',
      accountName: 'NGUYEN VAN A',
    });
    expect(inserted.reference).toMatch(/^VINF[A-F0-9]{16}$/);
    expect(new Date(inserted.expiresAt!).getTime()).toBeGreaterThan(Date.now());
    expect(result).toMatchObject({
      id: 'order-id',
      amount: 99000,
      status: 'pending',
      bankName: 'Bank Example',
      reference: inserted.reference,
    });
    expect(result.qrImageUrl).toContain('amount=99000');
    expect(result.qrImageUrl).toContain(
      encodeURIComponent(inserted.reference!),
    );
    expect(savedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment_order_created' }),
    );
  });

  it('does not create an order until an administrator has configured a bank account', async () => {
    const planRepo = {
      findOne: jest.fn().mockResolvedValue({
        name: 'lite',
        label: 'Gói Lite',
        price: 49000,
        isActive: true,
      }),
    };
    const orderRepo = { create: jest.fn(), save: jest.fn() };
    const { dataSource } = transactionHarness(
      new Map<unknown, unknown>([
        [Plan, planRepo],
        [PaymentSettings, { findOne: jest.fn().mockResolvedValue(null) }],
        [PaymentOrder, orderRepo],
      ]),
    );

    await expect(
      new PaymentsService(dataSource as unknown as DataSource).createOrder(
        'customer-id',
        'lite',
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('rejects inactive and free plans without trusting a client supplied amount', async () => {
    const planRepo = {
      findOne: jest.fn().mockResolvedValue({
        name: 'lite',
        label: 'Gói Lite',
        price: 49000,
        isActive: false,
      }),
    };
    const orderRepo = { create: jest.fn(), save: jest.fn() };
    const { dataSource } = transactionHarness(
      new Map<unknown, unknown>([
        [Plan, planRepo],
        [PaymentOrder, orderRepo],
      ]),
    );

    await expect(
      new PaymentsService(dataSource as unknown as DataSource).createOrder(
        'customer-id',
        'lite',
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('rejects prices that VietQR cannot encode in its 13-digit amount field', async () => {
    const planRepo = {
      findOne: jest.fn().mockResolvedValue({
        name: 'premium',
        label: 'Gói Premium',
        price: 10_000_000_000_000,
        isActive: true,
      }),
    };
    const orderRepo = { create: jest.fn(), save: jest.fn() };
    const { dataSource } = transactionHarness(
      new Map<unknown, unknown>([
        [Plan, planRepo],
        [
          PaymentSettings,
          { findOne: jest.fn().mockResolvedValue(configuredSettings()) },
        ],
        [PaymentOrder, orderRepo],
      ]),
    );

    await expect(
      new PaymentsService(dataSource as unknown as DataSource).createOrder(
        'customer-id',
        'premium',
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('marks an order paid atomically with a subscription and audit record after review', async () => {
    const now = new Date();
    const order = {
      id: 'order-id',
      userId: 'customer-id',
      planName: 'premium',
      planLabel: 'Gói Premium',
      amount: '99000',
      currency: 'VND',
      reference: 'VINF0123456789ABCDEF',
      durationDays: 30,
      status: 'pending',
      bankBin: '970436',
      bankName: 'Bank Example',
      accountNumber: '001234567890',
      accountName: 'NGUYEN VAN A',
      expiresAt: new Date(now.getTime() - 1000),
      paidAt: null,
      reviewedBy: null,
      createdAt: now,
    } as PaymentOrder;
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn((value: PaymentOrder) => Promise.resolve(value)),
    };
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'customer-id' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const subscriptionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<UserSubscription>) => value),
      save: jest.fn((value: UserSubscription) =>
        Promise.resolve({ ...value, id: 'subscription-id' }),
      ),
    };
    const auditRepo = { save: jest.fn().mockResolvedValue(undefined) };
    const { dataSource } = transactionHarness(
      new Map<unknown, unknown>([
        [PaymentOrder, orderRepo],
        [User, userRepo],
        [UserSubscription, subscriptionRepo],
        [AuditLog, auditRepo],
      ]),
    );

    const result = await new PaymentsService(
      dataSource as unknown as DataSource,
    ).markOrderPaid('order-id', 'admin-id', '203.0.113.2', 'admin-agent');

    expect(order.status).toBe('paid');
    expect(order.reviewedBy).toBe('admin-id');
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(userRepo.update).toHaveBeenCalledWith('customer-id', {
      planName: 'premium',
    });
    expect(subscriptionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'customer-id',
        planName: 'premium',
        grantedByAdmin: false,
      }),
    );
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment_order_marked_paid',
        userId: 'admin-id',
      }),
    );
    expect(result).toMatchObject({
      alreadyPaid: false,
      order: { status: 'paid', reference: 'VINF0123456789ABCDEF' },
      subscription: { id: 'subscription-id', planName: 'premium' },
    });
  });

  it('makes repeated admin review idempotent and does not create a second subscription', async () => {
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'order-id',
        userId: 'customer-id',
        planName: 'premium',
        planLabel: 'Gói Premium',
        amount: '99000',
        currency: 'VND',
        reference: 'VINF0123456789ABCDEF',
        durationDays: 30,
        status: 'paid',
        expiresAt: new Date(),
        paidAt: new Date(),
        reviewedBy: 'admin-id',
        createdAt: new Date(),
      }),
      save: jest.fn(),
    };
    const subscriptionRepo = { save: jest.fn() };
    const { dataSource } = transactionHarness(
      new Map<unknown, unknown>([
        [PaymentOrder, orderRepo],
        [User, { findOne: jest.fn() }],
        [UserSubscription, subscriptionRepo],
      ]),
    );

    const result = await new PaymentsService(
      dataSource as unknown as DataSource,
    ).markOrderPaid('order-id', 'admin-id', null, null);

    expect(result.alreadyPaid).toBe(true);
    expect(result.order.status).toBe('paid');
    expect(subscriptionRepo.save).not.toHaveBeenCalled();
  });
});
