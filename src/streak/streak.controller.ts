import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SsoAuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import {
  RecordStreakActivityDto,
  UpsertStreakDto,
} from './dto/streak-write.dto';
import { StreakService } from './streak.service';

@Controller('streaks')
@UseGuards(SsoAuthGuard)
export class StreakController {
  constructor(private readonly streakService: StreakService) {}

  @Get(':appId')
  get(@CurrentUser() user: User, @Param('appId') appId: string) {
    return this.streakService.get(user.id, appId);
  }

  @Put(':appId')
  upsert(
    @CurrentUser() user: User,
    @Param('appId') appId: string,
    @Body() body: UpsertStreakDto,
  ) {
    return this.streakService.upsert(user.id, appId, body);
  }

  @Post(':appId/activity')
  recordActivity(
    @CurrentUser() user: User,
    @Param('appId') appId: string,
    @Body() body: RecordStreakActivityDto,
  ) {
    return this.streakService.recordActivity(user.id, appId, body);
  }
}
