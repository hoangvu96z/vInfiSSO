import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ReadingsService } from './readings.service';
import { SsoAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { CreateReadingDto, UpdateReadingDto } from './dto/reading-write.dto';

@Controller('readings')
@UseGuards(SsoAuthGuard)
export class ReadingsController {
  constructor(private readonly readingsService: ReadingsService) {}

  // GET /readings?app=iching
  @Get()
  async list(@CurrentUser() user: User, @Query('app') app?: string) {
    const readings = await this.readingsService.getReadings(user.id, app);
    return { readings };
  }

  // GET /readings/:id
  @Get(':id')
  async getOne(@CurrentUser() user: User, @Param('id') id: string) {
    const reading = await this.readingsService.getReadingById(user.id, id);
    return { reading };
  }

  // POST /readings
  @Post()
  async create(
    @CurrentUser() user: User,
    @Body() body: CreateReadingDto,
  ) {
    if (!body.app || !body.type || !body.title || !body.data) {
      throw new BadRequestException('Thiếu trường bắt buộc: app, type, title, data');
    }
    const reading = await this.readingsService.createReading(user.id, body);
    return { reading };
  }

  // PATCH /readings/:id  (cập nhật data — dùng để lưu AI conversation)
  @Patch(':id')
  async updateData(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateReadingDto,
  ) {
    if (!body.data) {
      throw new BadRequestException('Thiếu trường bắt buộc: data');
    }
    const reading = await this.readingsService.updateReadingData(user.id, id, body.data);
    return { reading };
  }

  // DELETE /readings/all?app=iching  (xoá hết)
  @Delete('all')
  async deleteAll(@CurrentUser() user: User, @Query('app') app?: string) {
    await this.readingsService.deleteAllReadings(user.id, app);
    return { success: true };
  }

  // DELETE /readings/:id  (xoá 1)
  @Delete(':id')
  async deleteOne(@CurrentUser() user: User, @Param('id') id: string) {
    await this.readingsService.deleteReading(user.id, id);
    return { success: true };
  }
}
