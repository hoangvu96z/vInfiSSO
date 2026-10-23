import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SsoAuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { StreakService } from './streak.service';

const APP_OVERVIEW = [
  { id: 'iching', label: 'IChingNow', href: '/kinhdich/' },
  { id: 'tarot', label: 'TarotNow', href: '/tarot/' },
  { id: 'tuvi', label: 'TuViNow', href: '/tuvi/' },
  { id: 'talk', label: 'TalkWithMe', href: '/talk/' },
  { id: 'note', label: 'NoteNow', href: '/note/' },
] as const;

@Controller('me')
@UseGuards(SsoAuthGuard)
export class MeOverviewController {
  constructor(private readonly streakService: StreakService) {}

  @Get('overview')
  async getOverview(@CurrentUser() user: User) {
    const streaks = await Promise.all(
      APP_OVERVIEW.map(async (app) => {
        if (app.id === 'talk' || app.id === 'note') return null;
        const result = await this.streakService.get(user.id, app.id);
        return result.streak;
      }),
    );

    return {
      apps: APP_OVERVIEW.map((app, index) => ({
        ...app,
        streak: streaks[index],
      })),
    };
  }
}
