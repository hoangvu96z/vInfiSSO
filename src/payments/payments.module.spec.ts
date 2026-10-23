import { MODULE_METADATA } from '@nestjs/common/constants';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsModule } from './payments.module';

describe('PaymentsModule controllers', () => {
  it('keeps VietQR and admin payment routes without mounting the SePay webhook', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PaymentsModule,
    ) as Array<{ name: string }>;
    const controllerNames = controllers.map(({ name }) => name);

    expect(controllerNames).toEqual(
      expect.arrayContaining([
        PaymentsController.name,
        AdminPaymentsController.name,
      ]),
    );
    expect(controllerNames).not.toContain('SePayWebhookController');
  });
});
