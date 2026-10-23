import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { SsoAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import {
  CreateJournalEntryDto,
  JournalListQueryDto,
  JournalReadingsQueryDto,
  UpdateJournalEntryDto,
} from './dto/journal-write.dto';
import { JournalService } from './journal.service';

@Controller('journal')
@UseGuards(SsoAuthGuard)
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Get('readings')
  listAvailableReadings(
    @CurrentUser() user: User,
    @Query() query: JournalReadingsQueryDto,
  ) {
    return this.journalService.listAvailableReadings(user.id, query);
  }

  @Get()
  listEntries(
    @CurrentUser() user: User,
    @Query() query: JournalListQueryDto,
  ) {
    return this.journalService.listEntries(user.id, query);
  }

  @Post()
  createEntry(
    @CurrentUser() user: User,
    @Body() body: CreateJournalEntryDto,
  ) {
    return this.journalService.createEntry(user.id, body);
  }

  @Patch(':id')
  updateEntry(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateJournalEntryDto,
  ) {
    return this.journalService.updateEntry(user.id, id, body);
  }

  @Delete(':id')
  async deleteEntry(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    await this.journalService.deleteEntry(user.id, id);
    return { success: true };
  }
}
