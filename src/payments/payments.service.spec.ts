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

function transactionHarness(repositories: Map<unknown, any>) {
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
    const savedOrder = jest.fn(async (order: Partial<PaymentOrder>) => ({
      ...order,
      id: 'order-id',
      createdAt: new Date(),
      paidAt: null,
      reviewedBy: null,
    }));
    const orderRepo = {
      create: jest.fn((order) => order),
      save: savedOrder,
    };
    const { dataSource } = transactionHarness(
      new Map([
        [Plan, planRepo],
        [PaymentSettings, settingsRepo],
        [PaymentOrder, orderRepo],
        [AuditLog, auditRepo],
      ]),
    );

    const result = await new PaymentsService(dataSource as any).createOrder(
      'customer-id',
      'premium',
      '203.0.113.1',
      'test-agent',
    );

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
    expect(new Date(inserted.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(result).toMatchObject({
      id: 'order-id',
      amount: 99000,
      status: 'pending',
      bankName: 'Bank Example',
      reference: inserted.reference,
    });
    expect(result.qrImageUrl).toContain('amount=99000');
    expect(result.qrImageUrl).toContain(encodeURIComponent(inserted.reference));
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
      new Map([
        [Plan, planRepo],
        [PaymentSettings, { findOne: jest.fn().mockResolvedValue(null) }],
        [PaymentOrder, orderRepo],
      ]),
    );

    await expect(
      new PaymentsService(dataSource as any).createOrder(
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
      new Map([
        [Plan, planRepo],
        [PaymentOrder, orderRepo],
      ]),
    );

    await expect(
      new PaymentsService(dataSource as any).createOrder(
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
      new Map([
        [Plan, planRepo],
        [
          PaymentSettings,
          { findOne: jest.fn().mockResolvedValue(configuredSettings()) },
        ],
        [PaymentOrder, orderRepo],
      ]),
    );

    await expect(
      new PaymentsService(dataSource as any).createOrder(
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
      save: jest.fn(async (value) => value),
    };
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'customer-id' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const subscriptionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 'subscription-id' })),
    };
    const auditRepo = { save: jest.fn().mockResolvedValue(undefined) };
    const { dataSource } = transactionHarness(
      new Map([
        [PaymentOrder, orderRepo],
        [User, userRepo],
        [UserSubscription, subscriptionRepo],
        [AuditLog, auditRepo],
      ]),
    );

    const result = await new PaymentsService(dataSource as any).markOrderPaid(
      'order-id',
      'admin-id',
      '203.0.113.2',
      'admin-agent',
    );

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
      new Map([
        [PaymentOrder, orderRepo],
        [User, { findOne: jest.fn() }],
        [UserSubscription, subscriptionRepo],
      ]),
    );

    const result = await new PaymentsService(dataSource as any).markOrderPaid(
      'order-id',
      'admin-id',
      null,
      null,
    );

    expect(result.alreadyPaid).toBe(true);
    expect(result.order.status).toBe('paid');
    expect(subscriptionRepo.save).not.toHaveBeenCalled();
  });
});
