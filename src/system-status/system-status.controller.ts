import { Controller, Get, Header } from '@nestjs/common';
import { AdminOnly } from '../auth/roles.decorator';
import { SystemStatusService } from './system-status.service';

@Controller('admin/system-status')
@AdminOnly()
export class SystemStatusController {
  constructor(private readonly systemStatusService: SystemStatusService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  getSystemStatus() {
    return this.systemStatusService.getSystemStatus();
  }
}
