import { AuditLog } from '../users/audit-log.entity';
import { BadRequestException } from '@nestjs/common';
import { Plan } from '../plans/plan.entity';
import { User } from '../users/user.entity';
import { UserSubscription } from '../plans/user-subscription.entity';
import { PaymentOrder } from './payment-order.entity';
import { PaymentWebhookEvent } from './payment-webhook-event.entity';
import { SePayWebhookDto } from './dto/sepay-webhook.dto';
import { PaymentsService } from './payments.service';
import type { DataSource } from 'typeorm';

const REFERENCE = 'VINF0123456789ABCDEF';
const ACCOUNT_NUMBER = '001234567890';
const MISMATCH_CASES: Array<[string, Partial<SePayWebhookDto>, string]> = [
  ['amount mismatch', { transferAmount: 99001 }, 'amount_mismatch'],
  [
    'reference mismatch',
    {
      code: 'VINF1111111111111111',
      content: 'VINF1111111111111111',
    },
    'order_not_found',
  ],
  [
    'recipient account mismatch',
    { accountNumber: '009999999999' },
    'account_mismatch',
  ],
  ['outgoing transfer', { transferType: 'out' }, 'transfer_not_incoming'],
];
const NONPAYABLE_ORDER_CASES: Array<[string, PaymentOrder, string]> = [
  [
    'expired',
    makeOrder({ expiresAt: new Date(Date.now() - 1) }),
    'order_expired',
  ],
  [
    'already paid',
    makeOrder({ status: 'paid', paidAt: new Date() }),
    'order_already_paid',
  ],
];

function makeOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-id',
    userId: 'customer-id',
    planName: 'premium',
    planLabel: 'Gói Premium',
    amount: '99000',
    currency: 'VND',
    reference: REFERENCE,
    durationDays: 30,
    status: 'pending',
    bankBin: '970436',
    bankName: 'Bank Example',
    accountNumber: ACCOUNT_NUMBER,
    accountName: 'NGUYEN VAN A',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    paidAt: null,
    reviewedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePayload(
  overrides: Partial<SePayWebhookDto> = {},
): SePayWebhookDto {
  return {
    id: 725341,
    gateway: 'Vietcombank',
    transactionDate: '2026-10-23 12:00:00',
    accountNumber: ACCOUNT_NUMBER,
    code: REFERENCE,
    content: `Thanh toan ${REFERENCE}`,
    transferType: 'in',
    transferAmount: 99000,
    ...overrides,
  };
}

function createHarness(order = makeOrder()) {
  const seenTransactionIds = new Set<string>();
  const eventUpdates: Array<{
    id: string;
    values: Partial<PaymentWebhookEvent>;
  }> = [];
  const orderRepo = {
    findOne: jest.fn((options: { where: { reference: string } }) =>
      Promise.resolve(
        options.where.reference === order.reference ? order : null,
      ),
    ),
    save: jest.fn((value: PaymentOrder) => Promise.resolve(value)),
  };
  const userRepo = {
    findOne: jest.fn(() => Promise.resolve({ id: 'customer-id' })),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  const subscriptionRepo = {
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((value: Partial<UserSubscription>) => value),
    save: jest.fn((value: Partial<UserSubscription>) =>
      Promise.resolve({ ...value, id: 'subscription-id' }),
    ),
  };
  const auditEvents: Partial<AuditLog>[] = [];
  const auditRepo = {
    save: jest.fn((event: Partial<AuditLog>) => {
      auditEvents.push(event);
      return Promise.resolve(undefined);
    }),
  };
  const eventRepo = {
    create: jest.fn((value: Partial<PaymentWebhookEvent>) => value),
    createQueryBuilder: jest.fn(() => {
      let values: Partial<PaymentWebhookEvent> | undefined;
      interface InsertBuilder {
        insert(): InsertBuilder;
        into(entity: typeof PaymentWebhookEvent): InsertBuilder;
        values(value: Partial<PaymentWebhookEvent>): InsertBuilder;
        orIgnore(): InsertBuilder;
        returning(columns: string[]): InsertBuilder;
        execute(): Promise<{ raw: Array<{ id: string }> }>;
      }
      const builder: InsertBuilder = {
        insert: () => builder,
        into: () => builder,
        values: (value: Partial<PaymentWebhookEvent>) => {
          values = value;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => {
          const transactionId = String(values?.providerTransactionId);
          if (seenTransactionIds.has(transactionId)) {
            return Promise.resolve({ raw: [] });
          }
          seenTransactionIds.add(transactionId);
          return Promise.resolve({
            raw: [{ id: `event-${transactionId}` }],
          });
        },
      };
      return builder;
    }),
    update: jest.fn((id: string, values: Partial<PaymentWebhookEvent>) => {
      eventUpdates.push({ id, values });
      return Promise.resolve({ affected: 1 });
    }),
  };
  const repositories = new Map<unknown, unknown>([
    [PaymentOrder, orderRepo],
    [User, userRepo],
    [UserSubscription, subscriptionRepo],
    [AuditLog, auditRepo],
    [PaymentWebhookEvent, eventRepo],
    [Plan, {}],
  ]);
  const manager = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (transactionManager: typeof manager) => unknown) =>
        callback(manager),
    ),
  };

  return {
    service: new PaymentsService(dataSource as unknown as DataSource),
    order,
    orderRepo,
    userRepo,
    subscriptionRepo,
    auditRepo,
    auditEvents,
    eventRepo,
    eventUpdates,
  };
}

async function process(
  service: PaymentsService,
  payload = makePayload(),
  rawBody = Buffer.from(JSON.stringify(payload)),
) {
  return service.processSePayWebhook(
    payload,
    rawBody,
    Math.floor(Date.now() / 1000),
    '203.0.113.10',
    'SePay webhook test',
  );
}

describe('PaymentsService SePay webhook', () => {
  it('grants the plan once for a matching incoming transfer', async () => {
    const harness = createHarness();

    await expect(process(harness.service)).resolves.toEqual({ success: true });

    expect(harness.order.status).toBe('paid');
    expect(harness.order.reviewedBy).toBeNull();
    expect(harness.orderRepo.findOne).toHaveBeenCalledWith({
      where: { reference: REFERENCE },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.subscriptionRepo.save).toHaveBeenCalledTimes(1);
    expect(harness.userRepo.update).toHaveBeenCalledWith('customer-id', {
      planName: 'premium',
    });
    expect(harness.eventUpdates).toContainEqual({
      id: 'event-725341',
      values: {
        paymentOrderId: 'order-id',
        outcome: 'paid',
        rejectionReason: null,
      },
    });
    expect(harness.auditEvents[0]).toMatchObject({
      action: 'payment_sepay_event_paid',
      userId: 'customer-id',
    });
    expect(harness.auditEvents[0]?.metadata).toMatchObject({
      provider: 'sepay',
      providerTransactionId: '725341',
      orderId: 'order-id',
    });
  });

  it.each(MISMATCH_CASES)(
    'does not grant for %s',
    async (
      _label: string,
      payloadOverrides: Partial<SePayWebhookDto>,
      rejectionReason: string,
    ) => {
      const harness = createHarness();

      await process(harness.service, makePayload(payloadOverrides));

      expect(harness.order.status).toBe('pending');
      expect(harness.subscriptionRepo.save).not.toHaveBeenCalled();
      expect(harness.userRepo.update).not.toHaveBeenCalled();
      expect(
        harness.eventUpdates.some(
          ({ values }) =>
            values.outcome === 'ignored' &&
            values.rejectionReason === rejectionReason,
        ),
      ).toBe(true);
      expect(harness.auditEvents[0]?.action).toBe(
        'payment_sepay_event_ignored',
      );
      expect(harness.auditEvents[0]?.metadata?.reason).toBe(rejectionReason);
    },
  );

  it('does not grant when a transfer memo contains only a partial reference', async () => {
    const harness = createHarness();

    await process(
      harness.service,
      makePayload({ code: null, content: `prefix ${REFERENCE.slice(0, 10)}` }),
    );

    expect(harness.orderRepo.findOne).not.toHaveBeenCalled();
    expect(harness.subscriptionRepo.save).not.toHaveBeenCalled();
    expect(harness.eventUpdates[0]?.values).toMatchObject({
      outcome: 'ignored',
      rejectionReason: 'invalid_reference',
    });
  });

  it.each(NONPAYABLE_ORDER_CASES)(
    'does not grant an %s order again',
    async (_label: string, order: PaymentOrder, reason: string) => {
      const harness = createHarness(order);

      await process(harness.service);

      expect(harness.subscriptionRepo.save).not.toHaveBeenCalled();
      expect(harness.userRepo.update).not.toHaveBeenCalled();
      expect(harness.eventUpdates[0]?.values).toMatchObject({
        outcome: 'ignored',
        rejectionReason: reason,
      });
    },
  );

  it('acknowledges a previously processed provider transaction without regranting', async () => {
    const harness = createHarness();
    await process(harness.service);

    await expect(process(harness.service)).resolves.toEqual({ success: true });

    expect(harness.subscriptionRepo.save).toHaveBeenCalledTimes(1);
    expect(harness.orderRepo.findOne).toHaveBeenCalledTimes(1);
    expect(harness.auditRepo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects non-positive provider IDs if payment processing is called directly', async () => {
    const harness = createHarness();

    await expect(
      process(harness.service, makePayload({ id: 0 })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(harness.eventRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(harness.subscriptionRepo.save).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent deliveries atomically before granting', async () => {
    const harness = createHarness();

    await Promise.all([process(harness.service), process(harness.service)]);

    expect(harness.subscriptionRepo.save).toHaveBeenCalledTimes(1);
    expect(harness.order.status).toBe('paid');
    expect(harness.eventRepo.update).toHaveBeenCalledTimes(1);
    expect(harness.auditRepo.save).toHaveBeenCalledTimes(1);
  });
});
